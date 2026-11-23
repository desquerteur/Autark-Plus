// RPC contract part: an agent's activity log (Team › agent, team/AgentLog.tsx) – everything it did in time order: each
// turn with what started it and how it ended, and inside it every journaled item: tool calls
// with their results, thoughts the provider shows, updates, answers and the runtime's own notes. Handler:
// runtime/rpc/handlers/org.ts (runtime/runs/log.ts reads). Merged into Methods by module augmentation (methods.ts is
// at its size limit). Owns: these shapes. Never: behaviour.

import type { Run, RunItem } from '../model/runs.ts';

/** One page of the log: turns oldest first with their items; `before` asks for the page before it (absent: none). */
export interface AgentLogPage {
  runs: Run[];
  items: RunItem[];
  before?: number;
}

declare module '../api/methods.ts' {
  interface Methods {
    /** An agent's activity log: the latest turns (`before`: those that started earlier), oldest first, with their items. */
    'agents.log': { params: { id: string; before?: number }; result: AgentLogPage };
  }
}

export {};
