// Native engine session bindings: (agent, thread, engine) → Codex thread / Claude session id.
// The key's second part is the turn's thread (TurnPlan.thread, threadKey in shared/model/origin.ts) – stored in the column
// conversation_id: 13.11.2026 'main' for every turn of the agent (one context per agent), `split:<id>` for a part. Rows under
// the older per-chat, task or source keys are no longer read; a new main session starts.
// Owns: the `engine_sessions` rows (ref, generation, account, model, context size, the context
// window the engine reported for that model, the wake chat's seq of its last input, and – SES2 – the
// prompt key and mode the session was started with); B-080: the window an engine last reported for a model on any thread
// (reportedWindow – the window rule of turn-prepare.ts and splits/fork.ts).
// B-048 E2: a ref replaced by another (renewal, rebuild, account switch) or removed is recorded as superseded
// (kv 'superseded-sessions': who, which engine/account/ref, when) – only refs of rows the app wrote, i.e. sessions
// it created; agents/session-sweep.ts deletes them later. A newly bound ref tells the db's bind listeners.
// Never: treats a session as the agent's identity – it is disposable; when missing or
// mismatched the turn sends the full projection and a new session starts. Never deletes a provider session.

import type { Db } from '../db/database.ts';
import type { EngineId } from '../../shared/model/providers.ts';
import { KvRepo } from '../store/kv.ts';

/** kv namespace of superseded sessions (agents/session-sweep.ts deletes them). */
export const SUPERSEDED_NS = 'superseded-sessions';

export interface SupersededSession {
  agentId: string; conversationId: string; engine: EngineId; accountId?: string; ref: string;
  /** When it was superseded. */
  at: number;
  /** Failed deletion attempts so far. */
  attempts?: number;
}

/** The kv key of a superseded session. */
export function supersededKey(session: Pick<SupersededSession, 'engine' | 'accountId' | 'ref'>): string {
  return `${session.engine}:${session.accountId ?? ''}:${session.ref}`;
}

type BindListener = (binding: SessionBinding) => void;
const bindListeners = new WeakMap<Db, Set<BindListener>>();

/** Calls `listener` whenever a new ref is bound in this database (not on a save of the same ref); returns the unsubscribe. */
export function onSessionBound(db: Db, listener: BindListener): () => void {
  let set = bindListeners.get(db);
  if (!set) bindListeners.set(db, set = new Set());
  set.add(listener);
  return () => { set!.delete(listener); };
}

export interface SessionBinding {
  agentId: string;
  /** The thread: 'main' (the agent's one context) or `split:<id>`. */
  conversationId: string;
  engine: EngineId;
  accountId?: string;
  ref: string;
  generation: number;
  /** The wake chat's seq of the session's last input (kept for the record; nothing reads it back for a catch-up). */
  cursorSeq: number;
  contextTokens?: number;
  /** Context window the engine reported for `model` (used when the catalog has none). */
  contextWindow?: number;
  model?: string;
  /** sha256 of the stable prompt + sorted offered tool names (session-key.ts); none for rows before SES2. */
  promptKey?: string;
  /** Mode key of that prompt. */
  mode?: string;
  updatedAt: number;
}

interface Row {
  agent_id: string; conversation_id: string; engine: string; account_id: string | null; session_ref: string;
  cursor_seq: number; generation: number; context_tokens: number | null; context_window: number | null; model: string | null;
  prompt_key: string | null; mode: string | null; updated_at: number;
}

export class SessionStore {
  private db: Db;
  constructor(db: Db) { this.db = db; }

  get(agentId: string, thread: string | undefined, engine: EngineId): SessionBinding | undefined {
    const row = this.db.get<Row>('SELECT * FROM engine_sessions WHERE agent_id = ? AND conversation_id = ? AND engine = ?', [agentId, thread ?? '', engine]);
    if (!row) return undefined;
    return {
      agentId: row.agent_id, conversationId: row.conversation_id, engine: row.engine as EngineId, accountId: row.account_id ?? undefined,
      ref: row.session_ref, generation: Number(row.generation), cursorSeq: Number(row.cursor_seq),
      contextTokens: row.context_tokens ?? undefined, contextWindow: row.context_window ?? undefined,
      model: row.model ?? undefined, promptKey: row.prompt_key ?? undefined, mode: row.mode ?? undefined, updatedAt: Number(row.updated_at),
    };
  }

  /** Upsert. Without `contextWindow` the stored window is kept while the model stays the same. A replaced ref is recorded as superseded (B-048). */
  save(binding: SessionBinding): void {
    const before = this.get(binding.agentId, binding.conversationId, binding.engine);
    if (before && before.ref !== binding.ref) this.supersede(before, binding.updatedAt);
    this.db.run(
      `INSERT INTO engine_sessions (agent_id, conversation_id, engine, account_id, session_ref, cursor_seq, generation, context_tokens, context_window, model, prompt_key, mode, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_id, conversation_id, engine) DO UPDATE SET account_id = excluded.account_id, session_ref = excluded.session_ref,
         cursor_seq = excluded.cursor_seq, generation = excluded.generation, context_tokens = excluded.context_tokens,
         context_window = CASE WHEN excluded.context_window IS NOT NULL THEN excluded.context_window
           WHEN engine_sessions.model IS excluded.model THEN engine_sessions.context_window END,
         model = excluded.model, prompt_key = excluded.prompt_key, mode = excluded.mode, updated_at = excluded.updated_at`,
      [binding.agentId, binding.conversationId, binding.engine, binding.accountId ?? null, binding.ref, binding.cursorSeq,
        binding.generation, binding.contextTokens ?? null, binding.contextWindow ?? null, binding.model ?? null,
        binding.promptKey ?? null, binding.mode ?? null, binding.updatedAt],
    );
    if (before?.ref === binding.ref) return;
    for (const listener of [...(bindListeners.get(this.db) ?? [])]) { try { listener(binding); } catch { /* a listener never breaks a save */ } }
  }

  /** B-048: records a ref the app created that no row binds any more (the sweep deletes it after the successor's first finished turn and 24 h). */
  private supersede(binding: SessionBinding, at: number): void {
    try {
      const record: SupersededSession = {
        agentId: binding.agentId, conversationId: binding.conversationId, engine: binding.engine, ref: binding.ref, at,
        ...(binding.accountId ? { accountId: binding.accountId } : {}),
      };
      new KvRepo(this.db).set(SUPERSEDED_NS, supersededKey(record), record, at);
    } catch { /* bookkeeping only: the binding change goes on */ }
  }

  /** Stamps a row from before SES2 (no key yet) with the key of the turn that accepts it – it is accepted once. */
  stamp(agentId: string, thread: string | undefined, engine: EngineId, promptKey: string, mode: string): void {
    this.db.run('UPDATE engine_sessions SET prompt_key = ?, mode = ? WHERE agent_id = ? AND conversation_id = ? AND engine = ? AND prompt_key IS NULL',
      [promptKey, mode, agentId, thread ?? '', engine]);
  }

  /**
   * B-080: the context window this engine last reported for `model` on any agent's thread – the window it really runs with
   * (Codex runs a model with another window than its API's); undefined when it never reported one.
   */
  reportedWindow(engine: EngineId, model: string): number | undefined {
    const row = this.db.get<{ context_window: number }>(
      'SELECT context_window FROM engine_sessions WHERE engine = ? AND model = ? AND context_window IS NOT NULL ORDER BY updated_at DESC LIMIT 1', [engine, model]);
    return row ? Number(row.context_window) : undefined;
  }

  /** Records the context window an engine reported for the bound session's model. */
  setContextWindow(agentId: string, thread: string | undefined, engine: EngineId, contextWindow: number): void {
    this.db.run('UPDATE engine_sessions SET context_window = ? WHERE agent_id = ? AND conversation_id = ? AND engine = ?',
      [Math.round(contextWindow), agentId, thread ?? '', engine]);
  }

  /** Drops the binding; its ref is recorded as superseded (B-048; `at`: when, default the row's last update). */
  remove(agentId: string, thread: string | undefined, engine: EngineId, at?: number): void {
    const before = this.get(agentId, thread, engine);
    if (before) this.supersede(before, at ?? before.updatedAt);
    this.db.run('DELETE FROM engine_sessions WHERE agent_id = ? AND conversation_id = ? AND engine = ?', [agentId, thread ?? '', engine]);
  }
}
