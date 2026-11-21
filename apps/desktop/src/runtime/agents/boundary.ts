// The boundary of an agent's session (KI-Runde 17.11.2026): the moments its session starts anew anyway – no session yet, a
// cache gone cold, a fold waiting to be replayed. Only there a turn reads its whole context uncached whatever it runs on, so
// only there another model costs nothing extra (measured 15.–17.11.2026: 147 of 177 model switches came on a live one-hour
// cache and re-wrote 357k tokens at the median). Routing asks here whether the turn stands at such a moment and which model
// the session is on.
// Owns: that answer, read from the session bindings alone. Never: decides a route, rebuilds or changes a session.

import type { RuntimeServices } from '../contracts.ts';
import type { EngineId } from '../../shared/model/providers.ts';
import { CACHE_COLD_MS } from './compaction-policy.ts';
import { rebuildBlocked } from './rebuild.ts';
import { SessionStore } from './sessions.ts';

/** The moments a session starts anew anyway – only there the model may change at no extra cost. */
export interface Boundary { at: boolean; why?: 'no_session' | 'cold' | 'fold'; on?: { engine: EngineId; modelId: string; accountId?: string } }

/**
 * Where the agent's session of `thread` stands now. `on`: the route of its newest session there (the model it is on; none
 * without a session or while that session names no model). `at`: true without a session, when a fold waits to be replayed
 * (SessionBinding.foldedAt), or when the session rested past CACHE_COLD_MS – and false while that thread's rebuilds are
 * blocked, because then nothing starts the session anew.
 */
export function boundaryOf(services: Pick<RuntimeServices, 'db' | 'clock'>, agentId: string, thread: string): Boundary {
  const session = new SessionStore(services.db).newest(agentId, thread);
  if (!session) return { at: true, why: 'no_session' };
  const on = session.model ? { on: { engine: session.engine, modelId: session.model, ...(session.accountId ? { accountId: session.accountId } : {}) } } : {};
  // While rebuilds of this thread and engine are blocked (a refusal, a failed first turn) no session starts anew there: the
  // turn resumes what it has, so it stands at no boundary (agents/rebuild.ts rebuildBlocked).
  if (rebuildBlocked(services, agentId, thread, session.engine)) return { at: false, ...on };
  if (session.foldedAt !== undefined) return { at: true, why: 'fold', ...on };
  if (services.clock.now() - session.updatedAt > CACHE_COLD_MS) return { at: true, why: 'cold', ...on };
  return { at: false, ...on };
}
