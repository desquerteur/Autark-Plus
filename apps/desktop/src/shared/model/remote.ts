// Connecting devices (Settings › Devices): PCs on this network are listed directly; a PC further
// away is found by its Remote ID (over the meeting server) or a typed address. Both screens show the
// same 4-digit code; the person on the other PC accepts. The requester joins as the CEO (the same
// person – everything the same) or as an employee (a person of the organisation, people/*).
// Phones scan the pwa.link QR code (CEO) or a person's invite (people.invite, employee).
// F17 (16.11.2026): a request waiting on one of my other PCs shows here too (`via`, remote/mirror.ts); Accept there goes
// to that PC. F13: Accept may name a new person (`newPerson`) – the person is made when the device links, in one step.
// F09: a PC on this network names its company (`company`), so Settings › Devices lists a PC's companies under it.
// Owns: the shapes shared by runtime and UI for this flow, the remote.* methods and the
// remote.updated event (augmenting Methods / EventMap).
// Never: carries keys, tickets, session secrets or tokens.

import type { PersonRole } from './people.ts';

/** How a device joins: as the CEO (same person, everything the same) or as an employee (a person). */
export type JoinRole = 'ceo' | 'employee';

/** This installation as other PCs find it. */
export interface RemoteSelf {
  deviceId: string;
  name: string;
  /** 9 digits, derived from this PC's public key (shown "482 913 071"). */
  remoteId: string;
  fingerprint: string;
  /** Other PCs can find this PC and ask to connect (settings.devices.findable). */
  findable: boolean;
}

/** A PC asking this PC to connect, waiting for this PC's person; role 'phone' (B-078) is the owner's phone app. */
export interface RemoteIncoming {
  id: string;
  role: JoinRole | 'phone';
  deviceId: string;
  name: string;
  /** Its Remote ID (derived from its key) and fingerprint – public values. */
  remoteId: string;
  fingerprint: string;
  /** The code both screens show; accept only when they are the same. */
  code: string;
  /** Where the request came from (empty when it came through this PC's own loopback). */
  address?: string;
  expiresAt: number;
  /** F17: the request waits on this other PC of mine (Accept here answers there); absent = it waits on this PC. */
  via?: { deviceId: string; name: string };
}

/** F13: the person Accept makes for an employee's PC or phone (people.save) – made when that device links, as them. */
export interface NewPerson {
  name: string;
  title?: string;
  /** Their manager: an agent or a person (people/manager.ts). */
  managerId?: string;
  /** F13: 'ceo' – a second CEO beside the owner (shared/model/people.ts); absent = a member. */
  role?: PersonRole;
}

/** This PC's own request to another PC (one at a time). */
export interface RemoteOutgoing {
  id: string;
  role: JoinRole;
  deviceId: string;
  name: string;
  remoteId: string;
  fingerprint: string;
  code: string;
  status: 'waiting' | 'accepted' | 'declined' | 'expired' | 'failed' | 'cancelled';
  /** Why it ended (declined, expired, the other PC unreachable …). */
  reason?: string;
  expiresAt: number;
}

/** What Settings › Devices shows (remote.state; `remote.updated` carries changes). */
export interface RemoteState {
  self: RemoteSelf;
  incoming: RemoteIncoming[];
  outgoing?: RemoteOutgoing;
}

/** A PC on this network that accepts requests (LAN hello answer). */
export interface NearbyPc {
  deviceId: string;
  name: string;
  /** Its 9-digit Remote ID. */
  remoteId: string;
  fingerprint: string;
  /** Base URLs it answered on (http://<ip>:<port>). */
  addresses: string[];
  /** F09: the company this answer is (one PC holds several; each has its own key and Remote ID); absent from older PCs. */
  company?: string;
  /** 'new' not linked yet, 'linked' already linked, 'waiting' this PC's request to it is open. */
  state: 'new' | 'linked' | 'waiting';
}

declare module '../api/methods.ts' {
  interface Methods {
    /** Owner: this PC (name, Remote ID, fingerprint, findable), PCs asking here, and this PC's own request. */
    'remote.state': { params: void; result: RemoteState };
    /** Owner: connect to a PC by Remote ID or address ("203.0.113.5", "pc.example.org:47812"), as the CEO (default) or an employee. */
    'remote.connect': { params: { target: string; role?: JoinRole }; result: RemoteOutgoing };
    /** Owner: cancels this PC's open request, or closes its last outcome. */
    'remote.cancel': { params: void; result: { ok: true } };
    /**
     * Owner: accept or decline a request waiting on this PC or (F17) on another of my PCs (`via`); an employee's PC needs
     * the person it belongs to – `personId`, or `newPerson` to make them (F13); a phone takes either too (none = mine).
     */
    'remote.decide': { params: { id: string; accept: boolean; personId?: string; newPerson?: NewPerson }; result: { ok: true } };
    /** Owner: PCs on this network that accept requests (self excluded); `refresh` asks the network again. */
    'remote.nearby': { params: { refresh?: boolean } | void; result: NearbyPc[] };
  }
}

declare module '../api/events.ts' {
  interface EventMap {
    /** A PC asks this PC to connect, a request was decided, or this PC's own request changed (topic: system, owner). */
    'remote.updated': RemoteState;
  }
}
