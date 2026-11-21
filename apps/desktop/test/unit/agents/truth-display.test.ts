// B-083 track D – truth in the chat and on the agent page: a turn runs with its temperature (my own request – 13.11.2026:
// the person's suggestion in the chat never routes), reports it on its activity row with whether the engine sends it, writes it into its
// chat row (shown form "0.3" / "≈0.3"), its finished row and its run's route; a change of my own temperature alone gets the
// quiet switch line "<Agent> → <model> · <effort> · temperature T – <why>", the same temperature again none, its end none (14.11.:
// routing's, the live bar shows it); a model.set now switched inside the turn keeps its temperature for my next turn.
// Owns: these assertions only. Never: real engines, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnExecutor } from '../../../src/runtime/agents/turn.ts';
import { RunningTurns } from '../../../src/runtime/agents/dispatch-runs.ts';
import { groupWakes } from '../../../src/runtime/agents/dispatch-groups.ts';
import { setNextRoute, takeNextRoute, tookInTurn } from '../../../src/runtime/agents/next-route.ts';
import { Db } from '../../../src/runtime/db/database.ts';
import { migrate } from '../../../src/runtime/db/migrate.ts';
import { shownTemperature, temperatureText, type AgentActivity, type Run } from '../../../src/shared/model/runs.ts';
import type { LiveStatus } from '../../../src/runtime/agents/dispatch-live.ts';
import type { TurnOutcome, TurnRequest, TurnRoute } from '../../../src/runtime/agents/turn-types.ts';
import type { LiveRoute } from '../../../src/runtime/agents/turn-attempt.ts';
import type { RuntimeServices, Wake } from '../../../src/runtime/contracts.ts';
import type { EngineTurnInput } from '../../../src/runtime/engines/types.ts';
import type { Agent } from '../../../src/shared/model/org.ts';
import type { ModelInfo } from '../../../src/shared/model/providers.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { model } from '../context/fixture.ts';
import { setup } from './fixture.ts';

const OPUS = 'claude:claude-opus-5-5';

/** The agents fixture with display names, a recorded route listener, the engine's input and the runs' finish patches. */
function rig(engineId = 'claude') {
  const h = setup();
  Object.assign(h.engine, { id: engineId });
  const names = new Map<string, ModelInfo>([[OPUS, { ...model(OPUS, 'frontier', 'Claude Opus 5.5'), provider: 'claude', engine: 'claude' }]]);
  const finished: Array<Partial<Run>> = [];
  Object.assign(h.services.catalog, { get: (id: string) => names.get(id) });
  Object.assign(h.services.runs, { get: () => undefined, finish: (_id: string, patch: Partial<Run>) => { finished.push(patch); } });
  const routes: LiveRoute[] = [];
  const inputs: EngineTurnInput[] = [];
  h.state.script = async (input) => { inputs.push(input); return { text: 'Done.', stop: 'done' }; };
  Object.assign(h.services, { router: { route: async () => ({ ...h.route }) } });
  const run = (runId: string) => { // the person's line: the answer is awaited and posted
    h.chats.send({ conversationId: h.chat.id, authorId: HUMAN_ID, body: 'Go on.' });
    return new TurnExecutor(() => h.services).execute(h.request({ runId, onRoute: (route) => routes.push(route) }));
  };
  const lines = () => h.chats.messages(h.chat.id).filter((message) => message.meta.status?.type === 'model_switched').map((message) => message.body);
  const answers = () => h.chats.messages(h.chat.id).filter((message) => message.authorKind === 'agent' && message.kind !== 'status');
  const ran = (id: string, temperature?: number) => h.runs.unshift({
    id, agentId: h.tom.id, conversationId: h.chat.id, model: OPUS, effort: 'medium', status: 'done',
    route: { reason: 'test', by: 'rules', category: 'chat', ...(temperature !== undefined ? { temperature } : {}) },
  });
  return { h, routes, inputs, finished, run, lines, answers, ran };
}

test('my own temperature request runs the turn – engine, activity, switch line, finished row and run say the same', async () => {
  const r = rig();
  r.ran('run_0'); // the chat's last turn ran without a temperature
  setNextRoute(r.h.services.db, r.h.tom.id, { temperature: 0.6, at: 1 });
  const outcome = await r.run('run_1');
  assert.equal(outcome.status, 'done');
  assert.equal(r.inputs[0]?.temperature, 0.6, 'the engine gets my own');
  assert.deepEqual(r.routes, [{ model: OPUS, modelName: 'Claude Opus 5.5', effort: 'medium', engine: 'claude', accountId: r.h.account.id, temperature: 0.6, temperatureSent: false }]);
  assert.deepEqual(r.lines(), ['Tom → Claude Opus 5.5 · medium · temperature 0.6 (stance) – requested by me']);
  assert.deepEqual([r.finished[0]?.route?.temperature, r.finished[0]?.route?.temperatureSent], [0.6, false]);
  assert.deepEqual([r.answers()[0]?.meta.model, r.answers()[0]?.meta.temperature], ['Claude Opus 5.5', '≈0.6'], 'the finished row: the model samples at its own setting');

  // The request is used up: back to the model's own temperature – the live bar and the row show it, the chat gets no line.
  r.ran('run_1', 0.6);
  await r.run('run_2');
  assert.equal(r.inputs[1]?.temperature, undefined);
  assert.equal(r.lines().length, 1);
  assert.equal(r.routes[1]?.temperature, undefined, 'the activity row (live bar) says it');
  assert.equal(r.answers().at(-1)?.meta.temperature, undefined, 'no temperature, none on the row');
  assert.equal(r.finished.at(-1)?.route?.temperature, undefined);
  // Nothing again: no line.
  r.ran('run_2');
  await r.run('run_3');
  assert.equal(r.lines().length, 1);
});

test('an engine that sends the temperature: no stance mark anywhere', async () => {
  const r = rig('fake');
  r.ran('run_0');
  setNextRoute(r.h.services.db, r.h.tom.id, { temperature: 0.25, at: 1 });
  await r.run('run_1');
  assert.equal(r.inputs[0]?.temperature, 0.25);
  assert.deepEqual([r.routes[0]?.temperature, r.routes[0]?.temperatureSent], [0.25, true]);
  assert.deepEqual(r.lines(), ['Tom → Claude Opus 5.5 · medium · temperature 0.25 – requested by me']);
  assert.equal(r.answers()[0]?.meta.temperature, '0.25');
  assert.equal(r.finished[0]?.route?.temperatureSent, true);
});

test('the activity row carries the temperature and whether it is sent; a change of it alone re-emits', async () => {
  const emits: number[] = [];
  const services = {
    clock: { now: () => 1_000 }, tasks: { get: () => undefined }, log: { info() {}, warn() {}, error() {}, debug() {} },
    wakes: { done() {}, release() {} }, runs: { get: () => ({ status: 'running' }), finish() {} },
  } as unknown as RuntimeServices;
  let turns!: RunningTurns;
  let request!: TurnRequest;
  const live = { awake() {}, status() {}, emit: () => emits.push(turns.activity().length) } as unknown as LiveStatus;
  turns = new RunningTurns({ services: () => services, executor: { execute: (next) => { request = next; return new Promise<TurnOutcome>(() => {}); } } }, live, () => {});
  const wake: Wake = { id: 'wk_1', agentId: 'ag_tom', reason: 'message', conversationId: 'cv_a', dueAt: 10, createdAt: 10, attempts: 0 };
  turns.start(services, { id: 'ag_tom' } as Agent, groupWakes([wake])[0]!);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const route = { model: OPUS, modelName: 'Claude Opus 5.5', effort: 'high', engine: 'claude' } as const;
  request.onRoute?.(route);
  const plain = turns.activity()[0]!;
  assert.equal('temperature' in plain, false, 'none: no field');
  const warm: TurnRoute & { temperature?: number; temperatureSent?: boolean } = { ...route, temperature: 0.4, temperatureSent: false };
  request.onRoute?.(warm);
  assert.equal(emits.length, 2, 'the temperature alone is a change');
  const row = turns.activity()[0]!;
  assert.deepEqual([row.temperature, row.temperatureSent], [0.4, false]);
  request.onRoute?.({ ...warm });
  assert.equal(emits.length, 2, 'the same again is quiet');
});

test('model.set now: once a request of the turn ran on the new model (FIXES-3 C1, next-route.ts tookInTurn) the temperature it carried stays for my next turn, the rest ends', () => {
  const db = new Db(':memory:');
  migrate(db);
  setNextRoute(db, 'ag_tom', { temperature: 0.7, reason: 'loose drafts', at: 1 }); // model.set {temperature: 0.7, now: true}
  tookInTurn(db, 'ag_tom', 5);
  assert.deepEqual(takeNextRoute(db, 'ag_tom'), { temperature: 0.7, reason: 'loose drafts', at: 5 });
  setNextRoute(db, 'ag_tom', { modelId: 'claude:claude-sonnet-5', effort: 'high', at: 2 });
  tookInTurn(db, 'ag_tom', 6);
  assert.equal(takeNextRoute(db, 'ag_tom'), undefined, "model and effort were this turn's");
});

test('a temperature in its shown form', () => {
  assert.deepEqual([temperatureText(1), temperatureText(0), temperatureText(0.25), temperatureText(0.30000000000000004)], ['1.0', '0.0', '0.25', '0.3']);
  assert.equal(shownTemperature(0.7, false), '≈0.7');
});
