// Device model: this PC, linked PCs, phones and browsers.
// Owns: the device registry shapes shared by runtime and UI, phone/browser access state, and the app version order (compareAppVersions).
// Never: carries private keys or one-time pairing secrets to the UI.

export type DeviceKind = 'pc' | 'phone' | 'browser';
// Every PC is home of its own data and linked PCs are peers ('home'); 'node' is only read from older
// pairings and means nothing else; phones and browsers are 'client'.
export type DeviceRole = 'home' | 'node' | 'client';

export interface DeviceCaps {
  engines?: string[]; // engines with logged-in accounts on that device
  computerUse?: boolean;
  browser?: boolean;
  shell?: boolean;
  screens?: number;
  adbPhones?: string[]; // phones reachable via ADB from this PC
  os?: string;
  /** F25 (16.11.2026): the Autark version that PC runs (Settings › Devices; a newer one on my own PC checks for the update here). Older PCs send none. */
  version?: string;
}

/**
 * Orders two app versions ("0.3.8", "0.3.6-local.3"): negative when `a` is older, 0 when equal, positive when newer. The
 * numbers count first; a pre-release ("-local.3") is older than its plain version; unreadable parts count as 0.
 */
export function compareAppVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [core = '', pre = ''] = value.trim().replace(/^v/, '').split('-', 2);
    return { nums: core.split('.').map((part) => Number.parseInt(part, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length, 3); i++) {
    const diff = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (diff) return diff;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, 'en', { numeric: true });
}

export interface Device {
  id: string;
  name: string; // "Laptop Küche"
  kind: DeviceKind;
  role: DeviceRole;
  fingerprint: string; // sha256 of the device public key
  addresses: string[]; // base URLs it was reached on (LAN, tailnet, the address the meeting server saw)
  caps: DeviceCaps;
  /** Linked PCs: 'connecting' until the first dial ends, 'offline' after a failed dial or a closed link. */
  status: 'online' | 'connecting' | 'offline' | 'pairing' | 'revoked';
  self: boolean; // this installation
  pairedAt?: number;
  lastSeenAt?: number;
  revokedAt?: number;
  /**
   * A linked PC that joined as an employee: the person (people/*) it belongs to. Absent = the CEO's
   * own device (everything the same). An employee's PC may not run tools on this PC.
   */
  personId?: string;
  /** B-081: this PC joined that PC – as its CEO (everything the same) or as an employee there (files stay there). */
  joinedAs?: 'ceo' | 'employee';
}

export interface PwaState {
  enabled: boolean;
  urls: string[]; // reachable URLs (localhost, LAN, tailnet)
  secure: boolean; // https available (needed for install/mic/push on phones)
  /** Paired phones/browsers; `notifications` = the PC holds a push subscription from it. */
  devices: Array<{ id: string; name: string; createdAt: number; lastSeenAt?: number; notifications?: boolean }>;
  /** The PC can send Web Push: its VAPID key is available. */
  pushReady: boolean;
  vapidPublicKey?: string; // base64url VAPID public key for PushManager.subscribe (when pushReady)
}

/**
 * What a phone/browser needs to turn notifications on (pwa.pushConfig, open to every paired
 * device): whether the PC can push, the key to subscribe with, and whether this very browser's
 * subscription is stored on the PC (the "On" state – a granted browser permission alone is not).
 */
export interface PushConfig {
  pushReady: boolean;
  vapidPublicKey?: string;
  subscribed: boolean;
  /** Why push is not ready ("The PC could not prepare notifications." …), when it is not. */
  reason?: string;
}
