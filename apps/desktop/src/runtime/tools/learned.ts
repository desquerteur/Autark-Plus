// Learned from use: a tool an agent ran successfully through tools.call joins its direct tools whenever its session
// starts anew – a fresh one or a rebuilt one (agents/turn-prepare.ts promotes there), never mid-session, so a resumed
// session keeps the offer and prompt key it started with. Per agent (one context per agent).
// State: kv ns 'tools.learned', key `<agentId>`, value { core, used }: `core` is offered with the core set (at most
// MAX_LEARNED, the newest kept), `used` ran through tools.call since the last promotion (at most MAX_USED).
// Also the engine offer the turn (agents/session-key.ts), the MCP hub and the prompt's tool list use (engineOffer).
// Owns: that state, its bounds, the promotion and the engine offer. Never: offers a tool that cannot work here.

import type { RuntimeServices } from '../contracts.ts';
import type { Db } from '../db/database.ts';
import type { Agent } from '../../shared/model/org.ts';
import type { ModeInfo } from '../../shared/model/knowledge.ts';
import type { ToolSpec } from './types.ts';
import { KvRepo } from '../store/kv.ts';

export const LEARNED_NS = 'tools.learned';
export const MAX_LEARNED = 8;
export const MAX_USED = 8;

interface Learned { core: string[]; used: string[] }

const names = (value: unknown): string[] => (Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string' && name.length > 0 && name.length <= 64) : []);

function read(db: Db, agentId: string): Learned {
  const value = new KvRepo(db).get<Partial<Learned>>(LEARNED_NS, agentId);
  return { core: names(value?.core).slice(-MAX_LEARNED), used: names(value?.used).slice(-MAX_USED) };
}

/** The tools this agent learned (offered with its core set); [] when none or unreadable. */
export function learnedTools(db: Db, agentId: string): string[] {
  try { return read(db, agentId).core; } catch { return []; }
}

/** Records a tools.call target that succeeded (it joins at the next promotion); a known name changes nothing. Best effort. */
export function noteLearned(services: Pick<RuntimeServices, 'db' | 'clock'>, agentId: string, name: string): void {
  try {
    const state = read(services.db, agentId);
    if (state.core.includes(name) || state.used.includes(name)) return;
    new KvRepo(services.db).set(LEARNED_NS, agentId, { core: state.core, used: [...state.used, name].slice(-MAX_USED) }, services.clock.now());
  } catch { /* learning is an optimisation: the tool stays reachable through tools.call */ }
}

/** Moves `used` into `core` (newest kept); true when the learned list changed. Called where a session starts anew. */
export function promoteLearned(services: Pick<RuntimeServices, 'db' | 'clock'>, agentId: string): boolean {
  try {
    const db = services.db;
    const state = read(db, agentId);
    if (!state.used.length) return false;
    const core = [...state.core.filter((name) => !state.used.includes(name)), ...state.used].slice(-MAX_LEARNED);
    new KvRepo(db).set(LEARNED_NS, agentId, { core, used: [] }, services.clock.now());
    return core.length !== state.core.length || core.some((name, index) => name !== state.core[index]);
  } catch {
    return false;
  }
}

/** What an engine is offered directly: the mode's core set, the learned tools and the meta tools (registry offerFor). */
export function engineOffer(services: RuntimeServices, agent: Agent, mode: ModeInfo, engine: { ownTools: boolean; via: 'mcp' | 'native' }): ToolSpec[] {
  const tools = services.tools;
  if (!tools.offerFor) return tools.specsFor(agent, mode, engine);
  let learned: string[] = [];
  try { learned = learnedTools(services.db, agent.id); } catch { /* no db: the core set alone */ }
  return tools.offerFor(agent, mode, engine, learned);
}
