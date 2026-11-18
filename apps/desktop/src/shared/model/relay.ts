// The meeting server (settings.devices.relay; services/remote-relay, also bundled as app/meet.mjs):
// PCs in different networks find each other there by Remote ID for "Connect", exchange their
// addresses and then talk directly; a tunnel through it carries the (end-to-end encrypted) link
// only when no direct path answers.
// F29 (16.11.2026): the state also counts each phone's bytes direct and through the server (PhoneLink).
// Owns: the address rule of settings.devices.relay, the state Settings › Devices shows and the
// remote.relay method / relay.updated event (augmenting Methods / EventMap).
// Never: carries keys, tickets or anything the server could use to read traffic.

/** The meeting server every install uses unless settings.devices.relay names another ("" = off): Autark's own, mounted
 * on the TeleCoding relay host under /autark (B-072, 04.11.2026; one Render process, behind Cloudflare). */
export const DEFAULT_RELAY = 'wss://telecoding-relay.onrender.com/autark';

/** What Settings › Devices shows about the meeting server (remote.relay; `relay.updated` carries changes). */
export interface RelayState {
  /** Off: no address set (devices.relay empty); a Remote ID then reaches only PCs on this network. */
  status: 'off' | 'connecting' | 'connected' | 'error';
  /** The configured server origin (wss://… or ws://… on this network). */
  url?: string;
  /** Short reason while not connected ("not reachable", "refused" …). */
  error?: string;
  /** Linked PCs that are online at the server right now (both PCs pinned each other). */
  peersOnline: number;
  /** 18.11.2026: the server's fallback tunnel is not available today – its daily byte budget is used up ('quota') or
   * the operator switched tunnels off ('off'). Meeting and direct links go on. */
  held?: 'quota' | 'off';
  /** Linked PCs whose current link runs through a tunnel there (the last fallback). */
  relayed: string[];
  /** F29: my phone apps with traffic with this PC today or a channel now (absent: none). */
  phones?: PhoneLink[];
  /** 18.11.2026: the meeting server that ships with this app (app/meet.mjs) and the program that runs it, for
   * Settings › Devices › "Your own meeting server" (absent: not in this build, e.g. a run from source). */
  meet?: { program: string; file: string };
}

/**
 * One phone's way to this PC (F29 stage 1): the bytes its channels carried straight to this PC (`direct`), over a WebRTC
 * data channel (`rtc`, F25 stage 2: also across mobile networks and NATs) and through the meeting server (`relay`, sealed
 * end to end) since `since` (ms: midnight, or this PC's start today), and the way its channel runs now (absent: not
 * connected).
 */
export interface PhoneLink {
  deviceId: string;
  name: string;
  via?: 'direct' | 'rtc' | 'relay';
  direct: number;
  rtc: number;
  relay: number;
  since: number;
}

/** F25 (Konrad 16.11.2026): the STUN server a new install offers phones for the WebRTC way (settings.devices.stun) –
 * Cloudflare, which already stands in front of the meeting server, so no new party sees the devices' addresses. */
export const DEFAULT_STUN = ['stun:stun.cloudflare.com:3478'];

const PRIVATE_HOST = /^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[::1\]|[a-z0-9-]+\.local)$/;
const ADDRESS = /^(wss?):\/\/(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::([0-9]{1,5}))?(\/[A-Za-z0-9._~\/-]*)?$/;

/**
 * A server address as stored: `wss://host[:port][/path]`, or `ws://` only for this PC or a private
 * network. Returns the normalised URL or undefined.
 */
export function relayAddress(value: string): string | undefined {
  const match = ADDRESS.exec(value.trim());
  if (!match || value.trim().length > 300) return undefined;
  const [, scheme, rawHost, port, rawPath] = match;
  const host = rawHost.toLowerCase();
  if (!host.startsWith('[') && host.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return undefined;
  if (port && (Number(port) < 1 || Number(port) > 65535)) return undefined;
  if (scheme === 'ws' && !PRIVATE_HOST.test(host)) return undefined;
  const defaultPort = scheme === 'wss' ? '443' : '80';
  const path = rawPath && rawPath !== '/' ? rawPath.replace(/\/+$/, '') : '';
  return `${scheme}://${host}${port && port !== defaultPort ? `:${port}` : ''}${path}`;
}

declare module '../api/methods.ts' {
  interface Methods {
    /** Owner: the meeting server's state (address in settings.devices.relay). */
    'remote.relay': { params: void; result: RelayState };
  }
}

declare module '../api/events.ts' {
  interface EventMap {
    /** The meeting server connected, disconnected, or a linked PC came online / went offline there (topic: system, owner). */
    'relay.updated': RelayState;
  }
}
