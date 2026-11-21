// An agent's activity log, read from the run journal: its latest turns with every item (`splits`: its splits' runs too –
// the agents.log tool; the agent's page shows them under the parent's "Split" line instead), as one page (shared/api/methods-log.ts AgentLogPage). Nothing is written for it: every turn is journaled anyway
// (runs/journal.ts), so the log is there for everyone who looks – the person on the agent's page (agents.log RPC, rpc/handlers/org.ts) and any
// agent (the agents.log tool). A page holds whole turns, as many as fit about MAX_ITEMS items (at least one).
// Owns: the paging. Never: writes, filters by viewer (the callers check access), or reshapes items.

import type { Db } from '../db/database.ts';
import type { AgentLogPage } from '../../shared/api/methods-log.ts';
import type { RunItem } from '../../shared/model/runs.ts';
import { RunItemRepo, RunRepo } from '../store/runs.ts';

const MAX_RUNS = 15;
const MAX_ITEMS = 400;

/** The turns before `before` (absent: the latest), oldest first, with their items. */
export function readAgentLog(db: Db, agentId: string, options: { before?: number; maxRuns?: number; maxItems?: number; splits?: boolean } = {}): AgentLogPage {
  const maxRuns = options.maxRuns ?? MAX_RUNS;
  const maxItems = options.maxItems ?? MAX_ITEMS;
  const listed = new RunRepo(db).listByAgent(agentId, maxRuns + 1, { topLevel: options.splits !== true, ...(options.before === undefined ? {} : { before: options.before }) });
  const itemsRepo = new RunItemRepo(db);
  const runs = [];
  const parts: RunItem[][] = [];
  let count = 0;
  for (const run of listed.slice(0, maxRuns)) {
    const own = itemsRepo.list(run.id);
    if (runs.length && count + own.length > maxItems) break;
    runs.push(run);
    parts.push(own);
    count += own.length;
  }
  const more = runs.length < listed.length;
  const oldest = runs[runs.length - 1]?.startedAt;
  return { runs: runs.reverse(), items: parts.reverse().flat(), ...(more && oldest !== undefined ? { before: oldest } : {}) };
}
