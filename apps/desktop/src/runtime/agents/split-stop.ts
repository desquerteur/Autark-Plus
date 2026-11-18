// B-057 S13 – the person's Stop of an agent's own turn reaches its split groups at once. Every person-Stop path ends in
// dispatcher.ts personStop (runs.cancel → cancelRun; messages.stop, a task's stop or take-back → interrupt; the emergency
// stop → haltAll), which calls this right after the abort: the groups that turn created and that have not started yet
// are stopped then (split service afterParentTurn 'stopped' – "Not started: the person stopped the turn that split."),
// not only when the run ends, so a restart before that end never starts them (reconcile finds them stopped); the run's
// own end (split-turn.ts splitTurnEnded, or a release – dispatch-settle.ts abandonRun) finds none pending any more. A
// split's own turn created no group (depth 1); a turn a shutdown cut first stays a cut (abortTurn: the first kind decides).
// Decision 10: the same call stops, as the person, the groups that turn's agents.split call waits for – on every engine,
// whatever the call's own signal says – so they wake nobody.
// Owns: that call, best effort. Never: aborts a turn or a split lane itself (the split service and messages.stop do), or
// decides a split's lifecycle (runtime/splits/service.ts does).

import type { RuntimeServices } from '../contracts.ts';
import type { RunEntry } from './dispatch-runs.ts';

/** After the person's Stop of `entry`: the groups its turn split never start, and the ones its call waits for stop. */
export function stopPendingSplits(services: Pick<RuntimeServices, 'splits' | 'log'>, entry: Pick<RunEntry, 'runId' | 'split' | 'control'>): void {
  if (entry.split || entry.control.stopKind !== 'human' || !services.splits) return;
  try { services.splits.afterParentTurn(entry.runId, 'stopped'); } catch (error) {
    services.log.warn('the pending splits of a stopped turn were not stopped', { runId: entry.runId, error: String(error) });
  }
}
