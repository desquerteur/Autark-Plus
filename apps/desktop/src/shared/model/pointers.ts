// Named pointers (B-055): who points where on a shared surface – the person's and every agent's
// cursor in a browser tab (side browser, chat browser, an agent's own browser) or on a PC's screen.
// Viewers draw them as named cursors; agents read them as one short line in their tool results
// ("Lukas (person) is pointing at button "Pay" [ref=e31], 2 s ago"), so they notice each other
// and can split the work. Kept in memory only (runtime/pointers/hub.ts), never stored.
// B-081: a person's pointer stays in the agents' lines for 5 minutes (liveFor), so an agent sees whether the person
// is moving ("is moving over X", under 2 s since the last report) or resting ("rests on X (selector), last move
// 40 s ago" – minutes from 90 s on; also after a scroll), a click and typing in the past tense ("clicked", "typed");
// viewers still draw every pointer for POINTER_TTL_MS only.
// Owns: the shapes, the surface keys and the text line for agents. Never: behaviour or storage.

import type { MotionStep } from './pointer-motion.ts';

/** A pointer older than this is gone (no event needed to remove it); viewers draw every pointer this long. */
export const POINTER_TTL_MS = 15_000;
/** A person's pointer stays this long for the agents' lines (resting or idle is worth knowing). */
export const POINTER_PERSON_TTL_MS = 300_000;
/** A person's pointer reported within this time is moving. */
const MOVING_MS = 2000;
/** At most this many path steps travel with a pointer (viewers animate them). */
export const POINTER_PATH_MAX = 40;

export type PointerAction = 'move' | 'click' | 'type' | 'scroll' | 'select' | 'drag';

export interface PointerActor {
  kind: 'person' | 'agent';
  id: string;
  /** Display name ("Lukas", "Ada"); a person's role may follow in brackets ("Lukas (CEO)"). */
  name: string;
}

export interface PointerPoint {
  /** Surface key (see surfaceKey). */
  surface: string;
  actor: PointerActor;
  /** CSS px in the tab's viewport (browsers) or physical px of the virtual screen (screen). */
  x: number;
  y: number;
  /** What is under the pointer when known: role and accessible name (≤ 80 chars), the agent's ref, a short selector (≤ 100, B-081). */
  target?: { role?: string; name?: string; ref?: string; selector?: string };
  action?: PointerAction;
  /** An agent's move as steps (thinned to POINTER_PATH_MAX) so viewers animate the same path. */
  path?: MotionStep[];
  /** Epoch ms. */
  at: number;
}

/** Event payload 'pointers.changed': every live pointer of one surface. */
export interface PointerState {
  surface: string;
  points: PointerPoint[];
}

export type SurfaceKind = 'side' | 'chat' | 'agent' | 'screen';

/**
 * side:<tabId> – a tab of the person's side browser; chat:<chatId>/<tab> – a chat's shared browser;
 * agent:<agentId>/<tab> – an agent's own browser; screen:<deviceId|local> – a PC's screen.
 */
export function surfaceKey(kind: SurfaceKind, id: string, tab?: string): string {
  return tab ? `${kind}:${id}/${tab}` : `${kind}:${id}`;
}

export function parseSurface(key: string): { kind: SurfaceKind; id: string; tab?: string } | null {
  const match = /^(side|chat|agent|screen):([^/]+)(?:\/(.+))?$/.exec(key);
  if (!match) return null;
  return { kind: match[1] as SurfaceKind, id: match[2]!, ...(match[3] ? { tab: match[3] } : {}) };
}

/** Is this pointer still worth a line (a person's for 5 minutes, an agent's for POINTER_TTL_MS)? */
export function liveFor(point: PointerPoint, now: number): boolean {
  return now - point.at < (point.actor.kind === 'person' ? POINTER_PERSON_TTL_MS : POINTER_TTL_MS);
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 2 ? 'just now' : s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** What the pointer is over: 'button "Pay" [ref=e31] (div.card > button.pay)', a selector alone, or undefined. */
function over(target: PointerPoint['target']): string | undefined {
  if (target?.name || target?.role) {
    return `${target.role ?? 'element'}${target.name ? ` "${clip(target.name, 60)}"` : ''}${target.ref ? ` [ref=${target.ref}]` : ''}${target.selector ? ` (${clip(target.selector, 100)})` : ''}`;
  }
  return target?.selector ? clip(target.selector, 100) : undefined;
}

/** One line per other pointer on a surface, for an agent's tool result; '' when nobody else is there. */
export function pointersLine(points: readonly PointerPoint[], selfId: string, now: number): string {
  const others = points.filter((p) => p.actor.id !== selfId && liveFor(p, now));
  if (others.length === 0) return '';
  return others.map((p) => {
    const who = `${p.actor.name} (${p.actor.kind === 'person' ? 'person' : 'agent'})`;
    const thing = over(p.target);
    const at = `${Math.round(p.x)},${Math.round(p.y)}`;
    const person = p.actor.kind === 'person', still = now - p.at >= MOVING_MS;
    // a person: moving, or resting after any input but a click or typing (a scroll minutes ago is no "is scrolling")
    if (person && (!p.action || p.action === 'move' || (still && p.action !== 'click' && p.action !== 'type'))) {
      return still ? `${who} rests ${thing ? `on ${thing}` : `at ${at}`}, last move ${ago(now - p.at)}` : `${who} is moving ${thing ? `over ${thing}` : `at ${at}`}`;
    }
    const verb = p.action === 'click' ? 'clicked' : p.action === 'type' ? (person ? 'typed' : 'is typing') : p.action === 'scroll' ? 'is scrolling' : 'is pointing';
    return `${who} ${verb} at ${thing ?? at}, ${ago(now - p.at)}`;
  }).join('\n');
}
