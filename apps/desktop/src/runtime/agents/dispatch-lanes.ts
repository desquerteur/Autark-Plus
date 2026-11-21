// B-057 S12 – the dispatcher's split lanes. A split of an agent (shared/model/splits.ts) runs its turn on its own lane
// `<agentId>#<splitId>` beside the agent's main lane, which stays free for the agent's own work (dispatch-runs.ts keeps
// every lane in its running map). One capacity rule (07.11.2026, B-080 for splits): a split starts at once, like the
// agent's own turn – no global limit, whatever runs elsewhere; at most SPLIT_LIMITS.runningPerAgent run per agent;
// otherwise it is 'busy' and the split service tries again when a lane frees (onLaneFree – the dispatcher fires it
// after every split lane's end, when turns may start again and when a paused agent is resumed). A split
// whose lane still holds its ended turn (a retry asked for from inside that turn's finish) is 'busy' too. 'refused':
// under the person's emergency stop, for an archived or missing agent, or a split the split service does not hand out.
// The lane builds the turn's request from the split service – turnFor (its SplitTurn), inputFor (its brief and its
// dependencies' results as notes), the group's origin – with reason 'split', a new run id and neither chat nor task;
// the same TurnExecutor runs it. The person's Stop of an agent in a chat ends its splits there through the split
// service (rpc/handlers/chats.ts messages.stop, S13) – dispatcher.interrupt never does (a task's stop is no such Stop).
// B-083 (owner 08.11.2026: parts are the agent): a lane's turn takes notes (dispatcher.tell – agents.split_tell; the
// body for every lane is tellRun here) and a model switch inside itself (dispatcher.continueNow with the lane's run:
// model.set now of the part, or its origin's agents.split_tell) like the main lane; a part is never cut for a switch –
// it has no chat to continue in. A note its turn refused and never took before it ended goes to `onLost` (never dropped).
// Owns: starting, listing and stopping split lanes, the lane-free listeners and a note's way into a running turn. Never:
// decides which split is ready or how it ended (runtime/splits/service.ts), or touches the main lane's wakes or urgent picks.

import type { RuntimeServices, SplitLane } from '../contracts.ts';
import type { Origin } from '../../shared/model/origin.ts';
import type { Effort, ModelInfo } from '../../shared/model/providers.ts';
import { newId } from '../../shared/ids.ts';
import { SPLIT_LIMITS } from '../../shared/model/splits.ts';
import { abortTurn, runEntry, setModelInTurn, type RunEntry, type RunningTurns } from './dispatch-runs.ts';
import { steerNote, type SteerResult } from './dispatch-steer.ts';
import type { FoldRetries } from './dispatch-fold.ts';

export type LaneStart = 'started' | 'busy' | 'refused';

declare module '../contracts.ts' {
  interface Dispatcher {
    /**
     * B-083: `text` into the agent's running turn `runId` – its main lane's or a part's – at its next step: 'all' it has it,
     * 'refused' not yet (tried again while that turn runs; `onLost` runs when the turn ended without it), 'held' no such
     * turn runs or its engine never steers.
     */
    tell?(agentId: string, runId: string, text: string, onLost?: () => void): Promise<'all' | 'refused' | 'held'>;
  }
}

/** The lane of a split. */
export function laneKey(agentId: string, splitId: string): string {
  return `${agentId}#${splitId}`;
}

/** What the lanes need from the dispatcher. */
export interface LaneHost {
  services: () => RuntimeServices;
  runs: RunningTurns;
  /** May turns start now: 'refused' under the emergency stop, 'busy' while not started or paused (an update restart). */
  gate(): 'ok' | 'busy' | 'refused';
  /** A paused agent's split waits: the dispatcher fires the lane-free listeners when the agent is resumed. */
  hold(agentId: string): void;
}

export class SplitLanes {
  private readonly host: LaneHost;
  private readonly listeners = new Set<() => void>();

  constructor(host: LaneHost) {
    this.host = host;
  }

  /** Starts a split's turn on its lane now, or says why not ('busy': try again on a lane-free event). */
  start(input: { agentId: string; splitId: string }): LaneStart {
    const services = this.host.services();
    try {
      const gate = this.host.gate();
      if (gate !== 'ok') return gate;
      // Its lane still holds the turn that just ended (the split service re-queues a retry from inside that turn's
      // finish, before the lane is freed): 'busy' – the lane's end fires the listeners and the split starts then.
      if (this.host.runs.lane(laneKey(input.agentId, input.splitId))) return 'busy';
      const agent = services.org.get(input.agentId);
      if (!agent || agent.archivedAt) return 'refused';
      // Paused by the person or a manager (the main lane's order): waits for the un-pause.
      if (agent.status === 'paused') {
        this.host.hold(agent.id);
        return 'busy';
      }
      if (this.host.runs.lanes(agent.id).length >= SPLIT_LIMITS.runningPerAgent) return 'busy'; // B-080: the agent's own bound, nothing global
      const split = services.splits?.turnFor(input.splitId);
      if (!split || split.splitId !== input.splitId) return 'refused';
      const now = services.clock.now();
      const runId = newId('run', now);
      const notes = services.splits?.inputFor(input.splitId) ?? [];
      const origin = groupOrigin(services, input.splitId);
      const entry = runEntry({
        runId, agentId: agent.id, lane: laneKey(agent.id, split.splitId), reason: 'split', split,
        wakeIds: [], attempts: 0, startedAt: now, ...(origin ? { origin } : {}),
      });
      this.host.runs.launch(services, entry, { runId: entry.runId, agentId: agent.id, reason: 'split', split, notes, ...(origin ? { origin } : {}) });
      return 'started';
    } catch (error) {
      services.log.warn('split lane could not start', { ...input, error: String(error) });
      return 'busy';
    }
  }

  /** Running split lanes (of one agent). */
  list(agentId?: string): SplitLane[] {
    return this.host.runs.lanes(agentId).map((entry) => ({ agentId: entry.agentId, splitId: entry.split!.splitId, runId: entry.runId }));
  }

  /** Aborts a running split lane: the person's Stop ('human' – the split ends stopped) or a cut ('shutdown'). */
  stop(splitId: string, why: 'human' | 'shutdown'): boolean {
    const entry = this.host.runs.lanes().find((item) => item.split?.splitId === splitId);
    if (!entry) return false;
    if (why === 'human') abortTurn(entry, 'The split was stopped.', 'human');
    else abortTurn(entry, 'The split was cut off.', 'shutdown', 'release');
    return true;
  }

  /** `listener` runs whenever a lane frees or turns may start again; returns its removal. */
  onFree(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** A lane freed (or turns may start again): the split service starts what is ready. Nothing while turns may not start. */
  fire(): void {
    if (!this.listeners.size || this.host.gate() !== 'ok') return;
    const services = this.host.services();
    for (const listener of [...this.listeners]) {
      try { listener(); } catch (error) {
        services.log.warn('lane-free listener failed', { error: String(error) });
      }
    }
  }
}

/**
 * B-083: a part's lane takes `target` inside its turn when that model runs on the turn's engine and account (the check of
 * dispatch-runs.ts setModelInTurn) – false at once otherwise; an engine that refuses later is told to the part (`tell`).
 */
export function switchLane(services: RuntimeServices, entry: RunEntry, target: { modelId: string; effort?: Effort }, tell: (text: string) => void): boolean {
  const engine = entry.control.engine;
  const route = entry.route;
  let to: ModelInfo | undefined;
  try { to = services.catalog.get(target.modelId); } catch { to = undefined; }
  if (!engine?.setModel || !route?.accountId || !to || to.engine !== engine.id || route.engine !== engine.id || !to.accounts.includes(route.accountId)) return false;
  const name = to.name;
  void setModelInTurn(services, entry, target).then((inTurn) => {
    if (!inTurn) tell(`The switch to ${name} did not take inside this turn – I stay on ${route.modelName || route.model}.`);
  }, () => undefined);
  return true;
}

/**
 * B-083: Dispatcher.tell – `input.text` into the running turn `input.runId` (main lane or a part's) at its next step
 * (dispatch-steer.ts steerNote); a refused one is tried again while that turn runs (FoldRetries, `key` its own), and
 * `onLost` runs once that turn ended without taking it (it failed before its engine, ended first, or never steers).
 */
export async function tellRun(
  host: { services: RuntimeServices; runs: RunningTurns; folds: FoldRetries }, key: string,
  input: { agentId: string; runId: string; text: string }, onLost?: () => void,
): Promise<SteerResult> {
  const entry = host.runs.byRunId(input.runId);
  if (!entry || entry.agentId !== input.agentId || entry.controller.signal.aborted || !input.text.trim()) return 'held';
  const stillRunning = () => host.runs.byRunId(input.runId) === entry && !entry.controller.signal.aborted;
  let landed = false;
  const result = await host.folds.fold(key, async () => {
    const tried = await steerNote(host.services, entry, input.text, stillRunning);
    if (tried === 'all') landed = true;
    return tried;
  }, stillRunning);
  if (result === 'refused' && onLost) {
    void entry.finished.then(() => { if (!landed) onLost(); }).catch((error: unknown) => host.services.log.warn('a lost note was not handed on', { runId: input.runId, error: String(error) }));
  }
  return result;
}

/** The origin of a split's group (what started its parent's turn), shown in its activity row and run. */
function groupOrigin(services: RuntimeServices, splitId: string): Origin | undefined {
  try { return services.splits?.get(splitId)?.group.origin; } catch { return undefined; }
}
