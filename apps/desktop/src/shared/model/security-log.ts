// The change log of Settings › Security (owner 16.11.2026: the agents may change these settings like any other, so every
// change is written down – who, when, old → new – and can be read in the tab).
// Owns: the shape of one entry and the limits. Never: logic (runtime/settings/security-log.ts).

/** The settings the Security tab shows: the access level, the line every agent gets and (17.11.2026) sharing in the public library ('on' | 'off'). */
export type SecurityField = 'pcAccess' | 'forEveryAgent' | 'libraryPublish';

/** Who changed it, as far as the runtime knows: the person at the PC, their phone, an agent, a colleague, or no caller (an edit of settings.json, a linked PC). */
export interface SecurityActor {
  kind: 'person' | 'phone' | 'agent' | 'colleague' | 'other';
  /** A name to show: the person's, the agent's; for 'other' what is known. */
  name: string;
  id?: string;
}

export interface SecurityChange {
  at: number;
  field: SecurityField;
  by: SecurityActor;
  /** The old and the new value, cut to SECURITY_LOG_TEXT characters. */
  from: string;
  to: string;
}

/** The newest entries kept on a PC. */
export const SECURITY_LOG_MAX = 50;
/** Longest value kept per entry (the text for every agent can be long). */
export const SECURITY_LOG_TEXT = 600;
