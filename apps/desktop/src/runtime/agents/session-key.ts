// Session prompt key (SES2) and what a native session started with (S2 17.11.2026). A session keeps the system prompt and
// tool offer of its start until it starts anew (a rebuild, a renewal, no session): a changed key no longer renews it.
// Both engines hold the start anyway – Claude Code records a session's first system prompt and uses it on every resume,
// a Codex thread keeps its base instructions and dynamic tools – and a new prompt or tool list in front of the history
// would make the model read the whole context again. So a resumed turn passes the session's own system text and offers
// its own tool names (those still registered); what changed in the stable prompt since reaches it as changed lines in
// its live block (volatile-delta.ts stableDelta).
// State: kv 'session-start', key `<agentId>|<thread>|<engine>`, value { key, native, hub, sections } – the prompt key,
// the tool names offered natively and through the MCP hub, and each stable section's text the session started with;
// it belongs to the binding whose promptKey equals `key` (sessions.ts), and a new start replaces it. It is written where
// the binding is saved (turn-finish.ts, and turn-attempt.ts when the engine names a new session mid-turn), so only a session
// that exists has a record; a Codex revert keeps the thread, its key and its record; a native fork part starts from its
// parent session's record (split-turn.ts). A session bound before this record existed, whose key differs from today's, gets every current section once:
// its start is recorded (and its key moves) only when a turn of it ran through, and a fold turn records none.
// Owns: the tools offered to an engine for a turn (native dynamic tools; the hub's list the turn hands to its lease), the
// key (sha256 of the stable prompt + sorted offered tool names), the start record, a resumed session's own offer and the
// "Mode changed from X to Y" note.
// Never: reads or writes session rows, renews sessions (turn-prepare.ts) or starts engines.

import { createHash } from 'node:crypto';
import type { RuntimeServices } from '../contracts.ts';
import type { Db } from '../db/database.ts';
import type { EngineCaps } from '../engines/types.ts';
import type { ToolSpec } from '../tools/types.ts';
import type { ModeInfo } from '../../shared/model/knowledge.ts';
import type { EngineId } from '../../shared/model/providers.ts';
import type { StableSection } from '../context/prompt-stable.ts';
import type { TurnPlan } from './turn-types.ts';
import { KvRepo } from '../store/kv.ts';
import { engineOffer } from '../tools/learned.ts'; // B-049 F4

export const SESSION_START_NS = 'session-start';

export interface ToolOffer {
  /** Passed to engine.run as dynamic tools (engines with caps.dynamicTools). */
  native: ToolSpec[];
  /** The tool names the MCP hub serves this turn (its lease, mcp/hub.ts). */
  hub: string[];
  /** Every tool name the engine is offered (native and via the MCP hub), sorted and unique. */
  names: string[];
}

/** What a native session started with. */
export interface SessionStart { key: string; native: string[]; hub: string[]; sections: StableSection[] }
export interface StartKey { agentId: string; thread: string; engine: EngineId }

const keyOf = (key: StartKey) => `${key.agentId}|${key.thread}|${key.engine}`;
const sorted = (names: readonly string[]) => [...new Set(names)].sort();

/** The tools this turn offers, natively and through the MCP hub lease: B-049 F4 – the core set, the tools it learned and
 *  tools.find / tools.call (tools/learned.ts engineOffer). */
export function offeredTools(services: RuntimeServices, plan: Pick<TurnPlan, 'agent' | 'mode'>, caps: Pick<EngineCaps, 'dynamicTools' | 'mcp' | 'ownTools'>): ToolOffer {
  const native = caps.dynamicTools ? engineOffer(services, plan.agent, plan.mode, { ownTools: caps.ownTools, via: 'native' }) : [];
  const hub = caps.mcp ? engineOffer(services, plan.agent, plan.mode, { ownTools: true, via: 'mcp' }).map((tool) => tool.name) : [];
  return { native, hub, names: sorted([...native.map((tool) => tool.name), ...hub]) };
}

/** A resumed session's own offer: the names it started with that are still registered, natively and through the hub. */
export function sessionOffer(services: Pick<RuntimeServices, 'tools'>, start: Pick<SessionStart, 'native' | 'hub'>): ToolOffer {
  const registered = (name: string) => Boolean(services.tools.get(name));
  const native = start.native.flatMap((name) => {
    const tool = services.tools.get(name);
    return tool ? [{ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }] : [];
  });
  const hub = start.hub.filter(registered);
  return { native, hub, names: sorted([...native.map((tool) => tool.name), ...hub]) };
}

/** sha256 over the stable prompt and the sorted offered tool names. */
export function promptKey(stable: string, toolNames: readonly string[]): string {
  return createHash('sha256').update(stable).update('\u0000').update([...toolNames].sort().join('\n')).digest('hex');
}

/** What the session bound under prompt key `key` started with; undefined when no record belongs to that key. */
export function startOf(db: Db, at: StartKey, key: string | undefined): SessionStart | undefined {
  if (!key) return undefined;
  try {
    const start = new KvRepo(db).get<SessionStart>(SESSION_START_NS, keyOf(at));
    return start && start.key === key && Array.isArray(start.sections) && Array.isArray(start.native) && Array.isArray(start.hub) ? start : undefined;
  } catch { return undefined; }
}

/** A session that now exists started with this prompt and offer (turn-finish.ts, beside its binding). Never throws: without
 *  it a resume takes the prompt of its turn and the changed sections come whole. */
export function recordStart(db: Db, at: StartKey, start: SessionStart, now: number): void {
  try { new KvRepo(db).set(SESSION_START_NS, keyOf(at), start, now); } catch { /* bookkeeping only */ }
}

function modeName(services: RuntimeServices, key: string): string {
  try { return services.modes.get(key).name || key; } catch { return key; }
}

/** Told to the agent in the first turn after its mode changed. */
export function modeChangeNote(services: RuntimeServices, from: string, to: ModeInfo): string {
  return `My mode is now ${to.name || to.key} (was ${modeName(services, from)}).`;
}
