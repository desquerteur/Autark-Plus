// Repository for `runs` and `run_items` (the audit of what agents actually did).
// B-054: a run's origin (what started it) is stored in runs.source / source_label (migration 082) – written with the
// first save and kept by later ones (a finish never drops it).
// B-057: runs.split_id (migration 084) names the split a run worked for – kept like the origin; listByAgent's
// `topLevel` leaves split runs out (the agent's own turns), listBySplit reads the runs of splits.
// B-089 (11.11.2026: what a run costs, written down): runs.cached_tokens and runs.model_calls (migration 100) are written
// with the finish like the token counts; NULL reads as absent (an older row, an engine without a count). Package C
// (17.11.2026): runs.cache_write_tokens (migration 107) the same way. A run read back carries cost_basis and notional_usd
// (written by store/run-cost.ts after the finish), so agents.runs and splits.list show a plan turn's notional cost.
// Owns: SQL and row↔Run/RunItem mapping. Never: lifecycle rules or events (runs/journal.ts).

import { json, toJson, type Db, type Row } from '../db/database.ts';
import type { Run, RunItem } from '../../shared/model/runs.ts';
import { cleanOrigin, type Origin } from '../../shared/model/origin.ts';
import { compact, nul, opt, optNumber } from './rows.ts';

function toRun(row: Row): Run {
  return compact({
    id: String(row.id),
    agentId: String(row.agent_id),
    conversationId: opt<string>(row.conversation_id),
    taskId: opt<string>(row.task_id),
    trigger: row.trigger as Run['trigger'],
    engine: opt<Run['engine']>(row.engine),
    model: opt<string>(row.model),
    effort: opt<Run['effort']>(row.effort),
    accountId: opt<string>(row.account_id),
    deviceId: opt<string>(row.device_id),
    status: row.status as Run['status'],
    startedAt: optNumber(row.started_at),
    endedAt: optNumber(row.ended_at),
    inputTokens: optNumber(row.input_tokens),
    outputTokens: optNumber(row.output_tokens),
    cachedTokens: optNumber(row.cached_tokens), // B-089: undefined on a row before migration 100 or without a report
    modelCalls: optNumber(row.model_calls),
    cacheWriteTokens: optNumber(row.cache_write_tokens), // package C: undefined before migration 107 or without a report
    costUsd: optNumber(row.cost_usd),
    // first real run 18.11.2026: the basis and a plan's notional cost (run-cost.ts writes them) reach every reader of a run
    costBasis: opt<Run['costBasis']>(row.cost_basis),
    notionalUsd: optNumber(row.notional_usd),
    error: opt<string>(row.error),
    summary: opt<string>(row.summary),
    route: json<Run['route']>(row.route, undefined),
    origin: originOf(row),
    splitId: opt<string>(row.split_id), // B-057
  });
}

/** The stored origin (B-054; the label falls back to the source), or undefined. */
function originOf(row: Row): Origin | undefined {
  const source = opt<string>(row.source);
  if (!source) return undefined;
  const mail = json<Pick<Origin, 'mailProvenance' | 'mailScope'>>(row.mail_origin, {});
  return cleanOrigin({ source, label: opt<string>(row.source_label) ?? source,
    ...(mail && typeof mail === 'object' ? mail : {}) });
}

function toItem(row: Row): RunItem {
  return compact({
    id: String(row.id),
    runId: String(row.run_id),
    seq: Number(row.seq),
    kind: row.kind as RunItem['kind'],
    name: opt<string>(row.name),
    data: json<Record<string, unknown>>(row.data, {}),
    effectStatus: opt<RunItem['effectStatus']>(row.effect_status),
    idemKey: opt<string>(row.idem_key),
    createdAt: Number(row.created_at),
  });
}

/** B-059 #16: the error of a run a crashed or killed process left 'running' (interruptRunning; tasks/crash-repeat.ts counts these). */
export const CRASH_ERROR = 'The app stopped before this run finished.';

export class RunRepo {
  private readonly db: Db;
  constructor(db: Db) { this.db = db; }

  get(id: string): Run | undefined {
    const row = this.db.get('SELECT * FROM runs WHERE id = ?', [id]);
    return row ? toRun(row) : undefined;
  }

  /** Newest first; `topLevel` (B-057): without the runs of splits (the agent's own turns only). */
  /** Newest first; `before`: only runs that started earlier (the activity log's next page). */
  listByAgent(agentId: string, limit: number, opts: { topLevel?: boolean; before?: number } = {}): Run[] {
    const split = opts.topLevel ? ' AND split_id IS NULL' : '';
    const before = opts.before === undefined ? '' : ' AND started_at < ?';
    const params = opts.before === undefined ? [agentId, limit] : [agentId, opts.before, limit];
    return this.db.all(`SELECT * FROM runs WHERE agent_id = ?${split}${before} ORDER BY started_at DESC, rowid DESC LIMIT ?`, params).map(toRun);
  }

  /** B-057: the runs of these splits, oldest first (index runs_split). */
  listBySplit(splitIds: readonly string[]): Run[] {
    if (!splitIds.length) return [];
    const marks = splitIds.map(() => '?').join(', ');
    return this.db.all(`SELECT * FROM runs WHERE split_id IN (${marks}) ORDER BY started_at, rowid`, [...splitIds]).map(toRun);
  }

  listByStatus(status: Run['status']): Run[] {
    return this.db.all('SELECT * FROM runs WHERE status = ?', [status]).map(toRun);
  }

  save(run: Run): void {
    this.db.run(
      `INSERT INTO runs (id, agent_id, conversation_id, task_id, trigger, engine, model, effort, account_id, device_id, status,
         started_at, ended_at, input_tokens, output_tokens, cost_usd, error, summary, route, source, source_label, split_id, mail_origin,
         cached_tokens, model_calls, cache_write_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id, task_id = excluded.task_id,
         engine = excluded.engine, model = excluded.model, effort = excluded.effort, account_id = excluded.account_id,
         device_id = excluded.device_id, status = excluded.status, started_at = excluded.started_at,
         ended_at = excluded.ended_at, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
         cached_tokens = excluded.cached_tokens, model_calls = excluded.model_calls, cache_write_tokens = excluded.cache_write_tokens,
         cost_usd = excluded.cost_usd, error = excluded.error, summary = excluded.summary, route = excluded.route,
         mail_origin = CASE WHEN runs.source IS NULL THEN excluded.mail_origin ELSE runs.mail_origin END,
         source = COALESCE(runs.source, excluded.source), source_label = CASE WHEN runs.source IS NULL THEN excluded.source_label ELSE runs.source_label END,
         split_id = COALESCE(runs.split_id, excluded.split_id)`,
      [
        run.id, run.agentId, nul(run.conversationId), nul(run.taskId), run.trigger, nul(run.engine), nul(run.model),
        nul(run.effort), nul(run.accountId), nul(run.deviceId), run.status, nul(run.startedAt), nul(run.endedAt),
        nul(run.inputTokens), nul(run.outputTokens), nul(run.costUsd), nul(run.error), nul(run.summary),
        run.route ? toJson(run.route) : null, nul(run.origin?.source), nul(run.origin?.label), nul(run.splitId),
        run.origin?.mailProvenance || run.origin?.mailScope ? toJson({ mailProvenance: run.origin.mailProvenance, mailScope: run.origin.mailScope }) : null,
        nul(run.cachedTokens), nul(run.modelCalls), nul(run.cacheWriteTokens), // B-089, package C
      ],
    );
  }

  /** running → interrupted for runs a crashed process left behind. Returns the affected ids. */
  interruptRunning(at: number): string[] {
    const ids = this.db.all<{ id: string }>(`SELECT id FROM runs WHERE status = 'running'`).map((row) => row.id);
    if (ids.length) {
      this.db.run(
        `UPDATE runs SET status = 'interrupted', ended_at = COALESCE(ended_at, ?),
           error = COALESCE(error, ?) WHERE status = 'running'`,
        [at, CRASH_ERROR],
      );
    }
    return ids;
  }
}

export class RunItemRepo {
  private readonly db: Db;
  constructor(db: Db) { this.db = db; }

  get(id: string): RunItem | undefined {
    const row = this.db.get('SELECT * FROM run_items WHERE id = ?', [id]);
    return row ? toItem(row) : undefined;
  }

  byIdemKey(key: string): RunItem | undefined {
    const row = this.db.get('SELECT * FROM run_items WHERE idem_key = ?', [key]);
    return row ? toItem(row) : undefined;
  }

  list(runId: string): RunItem[] {
    return this.db.all('SELECT * FROM run_items WHERE run_id = ? ORDER BY seq', [runId]).map(toItem);
  }

  nextSeq(runId: string): number {
    return Number(this.db.get<{ value: number | null }>('SELECT MAX(seq) AS value FROM run_items WHERE run_id = ?', [runId])?.value ?? 0) + 1;
  }

  insert(item: RunItem): void {
    this.db.run(
      `INSERT INTO run_items (id, run_id, seq, kind, name, data, effect_status, idem_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.runId, item.seq, item.kind, nul(item.name), toJson(item.data), nul(item.effectStatus), nul(item.idemKey), item.createdAt],
    );
  }

  update(id: string, patch: { data?: Record<string, unknown>; effectStatus?: RunItem['effectStatus'] }): void {
    if (patch.data !== undefined) this.db.run('UPDATE run_items SET data = ? WHERE id = ?', [toJson(patch.data), id]);
    if (patch.effectStatus !== undefined) this.db.run('UPDATE run_items SET effect_status = ? WHERE id = ?', [patch.effectStatus, id]);
  }

  /** pending effects → unknown (we cannot know whether the external action happened). */
  markPendingUnknown(): RunItem[] {
    const rows = this.db.all(`SELECT * FROM run_items WHERE effect_status = 'pending'`).map(toItem);
    if (rows.length) this.db.run(`UPDATE run_items SET effect_status = 'unknown' WHERE effect_status = 'pending'`);
    return rows.map((item) => ({ ...item, effectStatus: 'unknown' as const }));
  }

  /**
   * RC1: engine-native tool calls (data.own) of these runs that never got their result – the
   * engine stopped mid-call, so whether the command ran is unknown.
   */
  markOwnUnknown(runIds: readonly string[]): RunItem[] {
    if (!runIds.length) return [];
    const marks = runIds.map(() => '?').join(', ');
    const rows = this.db.all(
      `SELECT * FROM run_items i WHERE i.run_id IN (${marks}) AND i.kind = 'tool_call' AND json_extract(i.data, '$.own') = 1
         AND COALESCE(i.effect_status, 'none') = 'none'
         AND NOT EXISTS (SELECT 1 FROM run_items r WHERE r.run_id = i.run_id AND r.kind = 'tool_result'
           AND json_extract(r.data, '$.callId') = json_extract(i.data, '$.callId'))`,
      [...runIds],
    ).map(toItem);
    for (const item of rows) this.db.run(`UPDATE run_items SET effect_status = 'unknown' WHERE id = ?`, [item.id]);
    return rows.map((item) => ({ ...item, effectStatus: 'unknown' as const }));
  }
}
