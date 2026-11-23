// Named pointers on this PC's screen (B-055 Q8, surface 'screen:local'): every agent pointer move
// of computer use (click, move, drag, wheel – with its path, so viewers and the pointer badge animate
// the same motion) and the person's pointer when computer use saw them active (a refused step, or
// their input newer than ours when the pointer was read). Agents read the others in one to three lines
// under their computer.* results (pointersLine: "Lukas (person) is moving at 812,430" / "rests on window
// "Figma – Landing", last move 40 s ago"). B-081: the person's point is stamped with the helper's idle time
// (last move = now - idleMs) and names the window under it when the helper says.
// Owns: what computer use reports to s.pointers and the result line. Never: polls the cursor (it is
// read once per computer.* result and when a step needs it anyway), stores anything, or decides what an agent may do.

import type { RuntimeServices } from '../contracts.ts';
import '../contracts/pointers.ts'; // RuntimeServices.pointers
import type { PointerAction } from '../../shared/model/pointers.ts';
import type { MotionStep } from '../../shared/model/pointer-motion.ts';
import { HUMAN_ID } from '../../shared/ids.ts';
import type { ComputerCaller } from './lease.ts';

export const SCREEN_SURFACE = 'screen:local';
/** At most this many lines about others under one result. */
const MAX_LINES = 3;

export class ScreenPointers {
  private readonly services: () => RuntimeServices | undefined;
  private readonly now: () => number;

  constructor(deps: { services?: () => RuntimeServices; now?: () => number }) {
    this.services = () => { try { return deps.services?.(); } catch { return undefined; } };
    this.now = () => deps.now?.() ?? Date.now(); // ComputerService's: the runtime clock, as the hub's
  }

  /** An agent's pointer arrived at (x, y) – after a move, click, drag or wheel step. */
  agent(caller: ComputerCaller | undefined, at: { x: number; y: number }, action: PointerAction, path?: readonly MotionStep[]): void {
    if (!caller) return;
    this.hub()?.point({
      surface: SCREEN_SURFACE, actor: { kind: 'agent', id: caller.key, name: caller.name }, x: at.x, y: at.y, action,
      ...(path && path.length > 1 ? { path: [...path] } : {}),
    });
  }

  /** The person's pointer is at (x, y), last moved `idleMs` ago, over the top-level window titled `window` (computer use saw them use this PC). */
  person(at: { x: number; y: number }, idleMs?: number, window?: string): void {
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return;
    const since = typeof idleMs === 'number' && Number.isFinite(idleMs) && idleMs >= 0 ? idleMs : 0;
    const title = typeof window === 'string' ? window.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    this.hub()?.point({
      surface: SCREEN_SURFACE, actor: { kind: 'person', id: HUMAN_ID, name: this.personName() }, x: at.x, y: at.y, action: 'move',
      at: this.now() - since, ...(title ? { target: { role: 'window', name: title } } : {}),
    });
  }

  /** The lines about everybody else on this screen for `caller`'s result ('' when nobody is there). */
  line(caller: ComputerCaller | undefined): string {
    const hub = this.hub();
    if (!hub || !caller) return '';
    try { return hub.line(SCREEN_SURFACE, caller.key).split('\n').filter(Boolean).slice(0, MAX_LINES).join('\n'); } catch { return ''; }
  }

  /** Named pointers are wired in this runtime (fakes and tests without services: nothing is reported). */
  wired(): boolean {
    return this.hub() !== undefined;
  }

  private hub() {
    return this.services()?.pointers;
  }

  private personName(): string {
    try { return this.services()?.settings.get().profile.name?.trim() || 'Someone'; } catch { return 'Someone'; }
  }
}
