// RT2 – model.set is really one step, and the return rule knows categories. Through the model.set
// tool, planTurn (agents/next-route.ts), the real router and the run journal: Sol/low → a requested
// max effort for one turn → back to Sol/low (also after a requested model); a task request holds on
// every turn of its task – not on the chat's other turns, with a next-step request on top for one
// turn – until the task is done; after a change of category the old effort is not carried and the
// old model stays only within 0.3 of the best score (RT1's escalation of a stuck task's model is gone with the give-up ladder, B-061;
// 14.11.2026 its last parameters left next-route.ts). 14.11.: a next step with a temperature alone over a task's effort-only request
// returns to the task's run, not to the model of other work.
// B-080: `task` names the task (key agent + task: its turns in any chat run on it), the answer names what the preview
// route of that work runs on (effort-only too), a temperature rides on the plan without a run to return to, planTurn
// leaves the next step for turn.ts to take (the turn helper here takes it like turn.ts before the engine: the one the plan
// read, plan.nextStepAt), and agents.delegate's model/effort hold from the child's first turn. B-080 review: a colleague's
// task other than this turn's is that fact with nothing stored; with pinned Sol unavailable two turns of one task keep the
// task's category (no "new work ("). B-083: the person's suggestion (chip) is information (13.11.2026: never a route) – my
// model or effort is stored and runs my next turn, the answer names whose suggestion I leave (this chat or the task's chat); a temperature that
// does not reach the model is my stance for the step. B-083 routing wave: a named model carries `from` (the model I am on:
// my newest done run in the chat); one that cannot run now is answered with `instead`, never switches my running turn, and
// a task request holds until it runs (D1, the router's part waits on T1); an effort the model lacks is stored as asked and
// clamped by the router (D4), also for agents.delegate with a display name (D5).
// Owns: these assertions only. Never: real engines, accounts, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent, harness } from '../chat/harness.ts';
import { FakeAccounts, FakeEngine, account, mode } from '../models/harness.ts';
import { Priors } from '../../../src/runtime/models/priors.ts';
import { Catalog } from '../../../src/runtime/models/catalog.ts';
import { RouterImpl } from '../../../src/runtime/routing/router.ts';
import { Journal } from '../../../src/runtime/runs/journal.ts';
import { defaultSettings } from '../../../src/runtime/settings/defaults.ts';
import { planTurn, routeRequest } from '../../../src/runtime/agents/turn-prepare.ts';
import { pendingRoute, returnChoice, setNextRoute, setTaskRoute, takeNextRoute } from '../../../src/runtime/agents/next-route.ts';
import { NO_TASK_TEXT, modelTools } from '../../../src/runtime/tools/builtin/models.ts'; // B-048: model.set moved here from skills.ts
import { taskTools } from '../../../src/runtime/tools/builtin/tasks.ts';
import type { RouteRequest } from '../../../src/runtime/contracts.ts';
import type { ToolContext, ToolOutput } from '../../../src/runtime/tools/types.ts';
import type { Effort, EngineId, RouteDecision } from '../../../src/shared/model/providers.ts';
import type { Run } from '../../../src/shared/model/runs.ts';

const SOL = 'codex:gpt-6.1-sol';
const LUNA = 'codex:gpt-6-luna';
const OPUS = 'claude:claude-opus-5-5';
const AGENT = 'ag_ada';
const caps = { vision: true, tools: true, structuredOutput: true };
const ALL: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** Balanced scores (no AA data, plan accounts): coding Sol 0.87 > Opus 0.74; research Opus 0.84, Sol 0.77; cheap chat Luna 0.75 ≫ Sol −0.13. */
const PRIORS = Priors.parse({
  version: 'test-rt2',
  categories: {},
  models: [
    { match: 'gpt-6.1-sol*', name: 'GPT-6.1 Sol', tier: 'frontier', relCost: 0.3, caps, efforts: ALL, strengths: { coding: 0.8, research: 0.7, chat: 0.4, 'cheap-chat': -0.2 } },
    { match: 'gpt-6-luna*', name: 'GPT-6 Luna', tier: 'small', relCost: 0.03, caps, efforts: ['none', 'low', 'medium', 'high'], strengths: { coding: 0, research: 0.2, chat: 0.4, 'cheap-chat': 0.8 } },
    { match: 'claude-opus-5-5*', name: 'Claude Opus 5.5', tier: 'frontier', relCost: 0.6, caps, efforts: ALL, strengths: { coding: 0.7, research: 0.8, chat: 0.4, 'cheap-chat': -0.6 } },
  ],
});
const MODES = Object.fromEntries(['coding', 'cheap-chat', 'research', 'chat'].map((key) => [key, mode(key)]));

async function rt2Setup() {
  const h = harness({ subconscious: {} });
  h.org.add(agent(AGENT, 'Ada', { mode: 'coding' }));
  const chat = h.chats.create({ agentIds: [AGENT], createdBy: 'human' });
  const defaults = defaultSettings({ locale: 'en-US', timezone: 'UTC' });
  const settings = { ...defaults, routing: { ...defaults.routing, work: 'gemini-cli' } }; // the RT2 scores below are without B-044's Claude Code work plan default (a plan never connected here)
  const engines = new Map<EngineId, FakeEngine>([['codex', new FakeEngine('codex')], ['claude', new FakeEngine('claude')]]);
  engines.get('codex')!.lists.set('codex', [
    { model: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', efforts: ALL },
    { model: 'gpt-6-luna', name: 'GPT-6 Luna', efforts: ['none', 'low', 'medium', 'high'] },
  ]);
  engines.get('claude')!.lists.set('claude', [{ model: 'claude-opus-5-5', name: 'Claude Opus 5.5', efforts: ALL }]);
  const accounts = new FakeAccounts(h.clock, h.bus);
  accounts.upsert(account('acc_codex', 'codex'), false);
  accounts.upsert(account('acc_claude', 'claude'), false);
  const runs = new Journal({ db: h.db, bus: h.bus, clock: h.clock });
  Object.assign(h.services, {
    settings: { get: () => settings }, accounts, runs, secrets: { use: async () => { throw new Error('no secret'); } },
    engines: { get: (id: EngineId) => engines.get(id)!, all: () => [...engines.values()], disposeIdle: async () => {} },
    modes: { get: (key: string) => { if (!MODES[key]) throw new Error(`unknown mode ${key}`); return MODES[key]; }, list: () => Object.values(MODES) },
  });
  const catalog = new Catalog({ services: () => h.services, priors: PRIORS, debounceMs: 0 });
  h.services.catalog = catalog;
  const router = new RouterImpl({ services: () => h.services });
  h.services.router = router;
  await catalog.refresh({ force: true });

  let seq = 0;
  const finish = (run: Omit<Run, 'id' | 'agentId' | 'conversationId' | 'trigger' | 'status'> & { status?: Run['status'] }, conversationId = chat.id) => {
    const id = `run_${++seq}`;
    runs.start({ id, agentId: AGENT, conversationId, taskId: run.taskId, trigger: run.taskId ? 'task' : 'message' });
    runs.finish(id, { status: 'done', endedAt: h.clock.now(), ...run });
    h.clock.advance(60_000);
    return id;
  };
  /** An earlier turn the rules chose (what the return rule may return to). */
  const seed = (model: string, effort: Effort, category: string, patch: Partial<Run> = {}) =>
    finish({ engine: model.startsWith('claude') ? 'claude' : 'codex', model, effort, route: { reason: 'seed', by: 'rules', category }, ...patch });
  /** One turn: plan, route, take the next step the plan read as turn.ts does before the engine (B-080) and record it the way turn-finish does (runs.route = {reason, by, category}). */
  const turn = async (taskId?: string, note?: string, conversationId = chat.id, reason?: 'task' | 'message' | 'review' | 'handoff'): Promise<RouteDecision> => {
    const plan = await planTurn(h.services, {
      runId: `plan_${seq + 1}`, agentId: AGENT, conversationId, taskId, reason: reason ?? (taskId ? 'task' : 'message'), notes: note ? [{ text: note, at: Date.now() }] : [],
      signal: new AbortController().signal, control: { lastSeq: 0, steeredSeq: 0 },
    });
    assert.ok(plan, 'a turn is planned');
    const route = await router.route(routeRequest(plan));
    if (plan.nextStepAt !== undefined) takeNextRoute(h.db, AGENT, plan.nextStepAt);
    finish({ taskId, engine: route.engine, model: route.modelId, effort: route.effort, accountId: route.accountId, route: { reason: route.reason, by: route.by, category: route.category } }, conversationId);
    return route;
  };
  const modelSet = modelTools.find((tool) => tool.name === 'model.set')!;
  const ask = async (args: Record<string, unknown>, taskId?: string, conversationId = chat.id): Promise<ToolOutput> => modelSet.run(args, {
    agent: h.org.get(AGENT)!, runId: 'run_tool', conversationId, taskId, mode: 'coding', services: h.services,
    signal: new AbortController().signal, status() {},
  } as ToolContext);
  const setMode = (key: string) => h.org.add({ ...h.org.get(AGENT)!, mode: key });
  return { ...h, chat, router, catalog, runs, seed, turn, ask, setMode };
}

const pair = (route: RouteDecision) => `${route.modelId}/${route.effort}`;
const ok = (output: ToolOutput) => { assert.ok(!output.isError, JSON.stringify(output.content)); return output.structured as { appliesTo: string }; };

test('Sol/low → max for one step → back to low; a requested model returns too', async () => {
  const h = await rt2Setup();
  h.seed(SOL, 'low', 'coding');
  const usual = await h.turn();
  assert.equal(pair(usual), `${SOL}/low`);
  assert.equal(usual.by, 'previous');

  assert.equal(ok(await h.ask({ effort: 'max', reason: 'the tricky migration' })).appliesTo, 'next turn');
  const hard = await h.turn();
  assert.equal(pair(hard), `${SOL}/max`, 'the requested effort for this step');
  assert.equal(hard.by, 'request');
  assert.match(hard.reason, /effort requested by the agent/);

  const after = await h.turn();
  assert.equal(pair(after), `${SOL}/low`, 'back to the effort before the request');
  assert.equal(after.by, 'previous');
  assert.equal(pair(await h.turn()), `${SOL}/low`);

  // A named model (with and without an effort) is one step too.
  ok(await h.ask({ model: OPUS, effort: 'max' }));
  const opus = await h.turn();
  assert.equal(pair(opus), `${OPUS}/max`);
  assert.equal(opus.by, 'request');
  assert.match(opus.reason, /requested by the agent/);
  assert.equal(pair(await h.turn()), `${SOL}/low`);
  ok(await h.ask({ model: OPUS }));
  const named = await h.turn();
  assert.equal(pair(named), `${OPUS}/low`, 'same category: the effort before is carried to the named model');
  assert.equal(named.by, 'request');
  assert.equal(pair(await h.turn()), `${SOL}/low`);
});

test('task scope: every turn on the task until it is done; other turns and a next step on top', async () => {
  const h = await rt2Setup();
  h.seed(SOL, 'low', 'coding');
  const task = h.tasks.create({ conversationId: h.chat.id, title: 'Port the parser', assigneeId: AGENT, createdBy: 'human' });
  const noTask = await h.ask({ model: OPUS, for: 'task' });
  assert.equal(noTask.isError, true);
  assert.match(String((noTask.content[0] as { text: string }).text), /no task/);

  assert.match(ok(await h.ask({ model: OPUS, effort: 'high', for: 'task' }, task.id)).appliesTo, new RegExp(`every turn on task ${task.id}`));
  for (let i = 0; i < 2; i++) {
    const onTask = await h.turn(task.id);
    assert.equal(pair(onTask), `${OPUS}/high`, `task turn ${i + 1}`);
    assert.equal(onTask.by, 'request');
  }
  assert.equal(pair(await h.turn()), `${SOL}/low`, 'a chat turn without the task returns to the choice before');

  // A next-step request on top: its fields win for one turn, then the task request again.
  ok(await h.ask({ effort: 'max' }));
  assert.equal(pair(await h.turn(task.id)), `${OPUS}/max`);
  assert.equal(pair(await h.turn(task.id)), `${OPUS}/high`);

  // Done: the request ends with the task (its row is dropped) and routing returns.
  h.tasks.finish(task.id, { status: 'done' as const, summary: 'Done' }, 'human');
  // A bare task wake for finished work plans no turn (B-047, turn-prepare.ts SET_ASIDE); a wake with news does.
  const back = await h.turn(task.id, 'The human commented: thanks');
  assert.equal(pair(back), `${SOL}/low`);
  assert.equal(back.by, 'previous');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM kv WHERE ns = 'next_route_task'")!.n, 0);
  const late = await h.ask({ model: OPUS, for: 'task' }, task.id);
  assert.equal(late.isError, true);
  assert.match(String((late.content[0] as { text: string }).text), /finished/);
});

test('category switch: the effort is not carried; the model stays only within 0.3 of the best', async () => {
  // Coding → cheap chat: Sol is not weak there (−0.2 ≥ −0.3, the old rule kept it) but far below Luna.
  const h = await rt2Setup();
  h.seed(SOL, 'high', 'coding');
  h.setMode('cheap-chat');
  const switched = await h.turn();
  assert.equal(pair(switched), `${LUNA}/low`, 'the best fit at the category default effort');
  assert.equal(switched.by, 'rules');
  assert.match(switched.reason, /new work \(coding → cheap chat\) · GPT-6.1 Sol is not close to the best fit/);
  const stays = await h.turn();
  assert.equal(pair(stays), `${LUNA}/low`);
  assert.equal(stays.by, 'previous');

  // Coding → research: Sol scores within 0.3 of Opus, so it continues – at research's default effort, not xhigh.
  const r = await rt2Setup();
  r.seed(SOL, 'xhigh', 'coding');
  r.setMode('research');
  const kept = await r.turn();
  assert.equal(pair(kept), `${SOL}/medium`);
  assert.equal(kept.by, 'previous');
  assert.equal(pair(await r.turn()), `${SOL}/medium`, 'same category now: its effort is carried');

  // A previous choice without a category (older runs) keeps the old rule: model and effort continue.
  const legacy = await r.router.route({ agent: r.org.get(AGENT)!, mode: mode('cheap-chat'), previous: { modelId: SOL, effort: 'high' } });
  assert.equal(pair(legacy), `${SOL}/high`);
});

test('B-078: a temperature rides with the next step (like an effort) and leaves the model to the rules; the answer says where it reaches', async () => {
  const h = await rt2Setup();
  h.seed(SOL, 'low', 'coding');
  const plan = (n: number, conversationId = h.chat.id) => planTurn(h.services, {
    runId: `plan_t${n}`, agentId: AGENT, conversationId, reason: 'message', notes: [],
    signal: new AbortController().signal, control: { lastSeq: 0, steeredSeq: 0 },
  });
  const answer = ok(await h.ask({ temperature: 1.2 })) as unknown as { temperature: number; temperatureNote?: string; effort?: string };
  assert.equal(answer.temperature, 1.2);
  assert.equal(answer.effort, 'low', 'B-080: the answer names what the work runs on');
  const first = await plan(1);
  assert.equal(first!.temperature, 1.2, 'the next turn carries it to the engine (TurnPlan.temperature)');
  assert.equal(first!.previous && 'temperature' in first!.previous, false, 'no routing input');
  assert.equal(pair(await h.router.route(routeRequest(first!))), `${SOL}/low`, 'the model and effort stay the rules\'');
  takeNextRoute(h.db, AGENT, first!.nextStepAt); // turn.ts, as the engine starts
  assert.equal((await plan(2))!.temperature, undefined, 'one step only');
  assert.equal((await h.ask({ temperature: 3 })).isError, true);
  assert.equal((await h.ask({})).isError, true);
  // Codex samples at its own setting: the answer says so, and where a temperature reaches (B-083, live 09.11.)
  const named = ok(await h.ask({ model: SOL, temperature: 0.2 })) as unknown as { temperatureNote?: string };
  assert.match(named.temperatureNote ?? '', /^GPT-6\.1 Sol samples at its own setting – my thinking comes first, so a temperature goes only where it costs none: .* Claude and Codex keep their own setting \(older Claude models take one only without thinking, the newer ones none, Codex not at all\) – there my drafts carry the variety\.$/);
  // B-080: a fresh chat keeps the temperature too (it was lost on previous); one context – it returns to my last run.
  const fresh = h.chats.create({ agentIds: [AGENT], createdBy: 'human' });
  ok(await h.ask({ temperature: 0.3 }, undefined, fresh.id));
  const there = await plan(3, fresh.id);
  assert.equal(there!.previous?.modelId, SOL, 'my last run, from another chat');
  assert.equal(there!.temperature, 0.3);
});

test('B-078/B-080: pendingRoute keeps a task\'s temperature and a next step\'s on top, reads the step without taking it; returnChoice carries none', async () => {
  const h = await rt2Setup();
  const at = h.clock.now();
  setTaskRoute(h.db, AGENT, 'task_1', { effort: 'high', temperature: 0.4, at });
  const pending = () => pendingRoute(h.db, AGENT, 'task_1', () => false);
  assert.deepEqual(pending(), { effort: 'high', temperature: 0.4, at });
  setNextRoute(h.db, AGENT, { temperature: 0.9, at });
  assert.deepEqual(pending(), { effort: 'high', temperature: 0.9, at, stepAt: at, ofTask: true }, 'stepAt: the next step\'s at, the one turn.ts takes; ofTask: model and effort are the task\'s');
  assert.equal(pending()?.temperature, 0.9, 'read, not taken');
  assert.equal(takeNextRoute(h.db, AGENT, at - 1), undefined, 'a request other than the one read stays');
  assert.equal(takeNextRoute(h.db, AGENT, pending()?.stepAt)?.temperature, 0.9);
  assert.equal(pending()?.temperature, 0.4, 'the task\'s again');
  const runs = [{ id: 'run_1', agentId: AGENT, conversationId: 'ch', trigger: 'message', status: 'done', model: SOL, effort: 'low', route: { reason: 'r', by: 'rules', category: 'coding' } }] as unknown as Run[];
  assert.deepEqual(returnChoice(runs, { temperature: 0.4, at }), { modelId: SOL, effort: 'low', category: 'coding' });
  assert.deepEqual(returnChoice(runs, { modelId: OPUS, temperature: 0, at }), { modelId: OPUS, effort: 'low', explicit: true, asked: 'model', category: 'coding', from: SOL });
});

test('14.11.: a next step with a temperature alone over a task\'s effort-only request returns to the task\'s run – an effort or model in the step returns to the model I am on', async () => {
  const h = await rt2Setup();
  const at = h.clock.now();
  const runs = [
    { id: 'run_2', agentId: AGENT, trigger: 'message', status: 'done', model: OPUS, effort: 'high', route: { reason: 'other work', by: 'rules', category: 'research' } },
    { id: 'run_1', agentId: AGENT, taskId: 'task_1', trigger: 'task', status: 'done', model: SOL, effort: 'low', route: { reason: 'r', by: 'rules', category: 'coding' } },
  ] as unknown as Run[];
  setTaskRoute(h.db, AGENT, 'task_1', { effort: 'high', at });
  setNextRoute(h.db, AGENT, { temperature: 0.3, at });
  const pending = () => pendingRoute(h.db, AGENT, 'task_1', () => false);
  assert.deepEqual(returnChoice(runs, pending(), { taskId: 'task_1' }), { modelId: SOL, effort: 'high', explicit: true, asked: 'effort', category: 'coding' }, 'the task\'s own run at the task\'s effort');
  setNextRoute(h.db, AGENT, { effort: 'medium', temperature: 0.3, at });
  assert.deepEqual(returnChoice(runs, pending(), { taskId: 'task_1' }), { modelId: OPUS, effort: 'medium', explicit: true, asked: 'effort', category: 'research' }, 'a step\'s effort is relative to the model I am on');
});

test('B-083 D1: a named model carries `from` – the model I am on in that chat: my newest done run there, also one a request shaped; a split\'s run is aside', () => {
  const at = 1;
  const run = (id: string, model: string, patch: Partial<Run> = {}) => ({ id, agentId: AGENT, conversationId: 'ch', trigger: 'message', status: 'done', model, effort: 'low', route: { reason: 'r', by: 'rules', category: 'coding' }, ...patch }) as unknown as Run;
  const shaped = [run('run_3', LUNA, { route: { reason: 'requested by the agent', by: 'request', category: 'coding' } }), run('run_1', SOL)];
  const choice = returnChoice(shaped, { modelId: OPUS, effort: 'high', at });
  assert.deepEqual([choice?.modelId, choice?.from], [OPUS, LUNA], 'the request-shaped run is the model I am on');
  assert.equal(returnChoice([run('run_4', LUNA, { splitId: 'sp_1' })], { modelId: OPUS, at })?.from, undefined, 'a split\'s run is not where I am');
  assert.equal(returnChoice([run('run_5', LUNA, { status: 'failed' }), run('run_1', SOL)], { modelId: OPUS, at })?.from, SOL, 'done runs only');
  assert.equal(returnChoice([run('run_1', SOL)], { modelId: SOL, at })?.from, undefined, 'none when I am on the model I named');
  assert.equal(returnChoice([run('run_1', SOL, { conversationId: 'other' })], { modelId: OPUS, at })?.from, SOL, 'any chat: one context');
  assert.equal(returnChoice([run('run_1', SOL)], { effort: 'max', at })?.from, undefined, 'an effort-only request names no model');
});

test('B-080: task names the task – keyed agent + task, every turn of mine on it runs on it, in its chat and in another', async () => {
  const h = await rt2Setup();
  h.org.add({ ...h.org.get(AGENT)!, modelPolicy: { pin: SOL, effort: 'medium' } }); // pinned to Sol, fixed medium
  h.seed(SOL, 'medium', 'coding');
  const work = h.chats.create({ agentIds: [AGENT], createdBy: 'human' });
  const task = h.tasks.create({ conversationId: work.id, title: 'Port the parser', assigneeId: AGENT, createdBy: 'human' });
  const answer = ok(await h.ask({ model: 'claude-opus-5-5', effort: 'high', task: task.id })) as unknown as { appliesTo: string; modelId: string; effort: string };
  assert.match(answer.appliesTo, new RegExp(`every turn on task ${task.id} until it is done, in whichever chat it runs`));
  assert.deepEqual([answer.modelId, answer.effort], [OPUS, 'high'], 'the preview where the task runs');
  assert.deepEqual(h.db.all<{ key: string }>("SELECT key FROM kv WHERE ns = 'next_route_task'").map((row) => row.key), [`${AGENT}:${task.id}`]);
  const own = await h.turn(task.id, 'go on', work.id, 'task');
  assert.deepEqual([pair(own), own.by], [`${OPUS}/high`, 'request'], 'a task wake in the task\'s own chat');
  const review = await h.turn(task.id, 'Review your work', h.chat.id, 'review');
  assert.deepEqual([pair(review), review.by], [`${OPUS}/high`, 'request'], 'a review wake in another chat');
  assert.equal(pair(await h.turn()), `${SOL}/medium`, 'a chat turn without the task stays on the pin');

  // Without a task in the turn and without a task id: the first-person fact, nothing stored.
  const before = h.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM kv WHERE ns IN ('next_route', 'next_route_task')")!.n;
  const none = await h.ask({ effort: 'high', for: 'task' });
  assert.equal(String((none.content[0] as { text: string }).text), NO_TASK_TEXT);
  assert.match(NO_TASK_TEXT, /^This turn has no task of mine – I name it with task: "<id>" \(tasks\.list\)/);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM kv WHERE ns IN ('next_route', 'next_route_task')")!.n, before);
  h.tasks.finish(task.id, { status: 'done' as const, summary: 'Done' }, 'human');
  assert.equal(String(((await h.ask({ effort: 'high', task: task.id })).content[0] as { text: string }).text), `Task ${task.id} is finished – my next step here takes it with for: "next_step".`);
});

test('re-review 14.11.: an effort-only request for a task in another chat – the preview shows the model its next turn runs: the task\'s own, never one my subconscious set for other work', async () => {
  const h = await rt2Setup();
  const work = h.chats.create({ agentIds: [AGENT], createdBy: 'human' });
  const task = h.tasks.create({ conversationId: work.id, title: 'Port the parser', assigneeId: AGENT, createdBy: 'human' });
  h.seed(SOL, 'low', 'coding', { taskId: task.id });
  h.seed(OPUS, 'high', 'coding', { route: { reason: 'my subconscious: a contract the customer signs · coding', by: 'request', category: 'coding' } }); // other work, routed
  const answer = ok(await h.ask({ effort: 'high', task: task.id })) as unknown as { modelId: string; effort: string };
  const next = await h.turn(task.id, 'go on', work.id, 'task');
  assert.deepEqual([answer.modelId, answer.effort], [SOL, 'high'], 'the preview: the task\'s own model at the asked effort');
  assert.equal(pair(next), `${SOL}/high`, 'and its turn runs just that');
});

test('B-083: the person\'s suggestion is information – my effort is stored and runs my next turn, the answer names their suggestion; else the answer is what the next turn runs', async () => {
  const h = await rt2Setup();
  h.seed(SOL, 'low', 'coding');
  Object.assign(h.services.settings.get(), { profile: { ...h.services.settings.get().profile, name: 'Stanislaus' } });
  h.chats.update(h.chat.id, { settings: { efforts: { [AGENT]: 'medium' } } }, 'human');
  const chip = ok(await h.ask({ effort: 'xhigh' })) as unknown as { effort: string; suggestion?: string };
  assert.equal(chip.effort, 'xhigh', 'the preview runs on my request');
  assert.equal(chip.suggestion, 'Stanislaus suggested effort medium in this chat – I take effort xhigh for this step.');
  const says = (body: string) => h.chats.send({ conversationId: h.chat.id, authorId: 'human', body });
  says('Go on with the parser, please.');
  const mine = await h.turn();
  assert.deepEqual([mine.effort, mine.by], ['xhigh', 'request'], 'my request runs for one step');
  says('And the tests too.');
  assert.equal((await h.turn()).effort, 'high', 'then the rules again (a person\'s line: at least high), never the suggested medium');
  assert.equal((ok(await h.ask({ effort: 'medium' })) as unknown as { suggestion?: string }).suggestion, undefined, 'the suggestion\'s own effort: no line');
  takeNextRoute(h.db, AGENT);

  // A task whose chat has the suggestion, asked from another chat: that chat is named; my turns on the task run on my request.
  const elsewhere = h.tasks.create({ conversationId: h.chat.id, title: 'Port the parser', assigneeKind: 'agent', assigneeId: AGENT, createdBy: 'human' });
  const other = h.chats.create({ agentIds: [AGENT], createdBy: 'human' });
  const named = ok(await h.ask({ effort: 'xhigh', task: elsewhere.id }, undefined, other.id)) as unknown as { suggestion?: string };
  assert.equal(named.suggestion, `Stanislaus suggested effort medium in the chat of task ${elsewhere.id} – I take effort xhigh for task ${elsewhere.id}.`);
  const onTask = await h.turn(elsewhere.id, 'go on', h.chat.id, 'task');
  assert.deepEqual([onTask.effort, onTask.by], ['xhigh', 'request'], 'in the task\'s own chat');

  // A suggested model: another one is stored and named; one that cannot run now is stored as asked (like with my start model).
  const tipped = h.chats.create({ agentIds: [AGENT], createdBy: 'human' });
  h.chats.update(tipped.id, { settings: { modelHints: { [AGENT]: SOL } } }, 'human');
  const opus = ok(await h.ask({ model: OPUS }, undefined, tipped.id)) as unknown as { modelId: string; suggestion?: string };
  assert.deepEqual([opus.modelId, opus.suggestion], [OPUS, 'Stanislaus suggested GPT-6.1 Sol in this chat – I take Claude Opus 5.5 for this step.']);
  (h.services.accounts as unknown as FakeAccounts).markLimited('acc_claude', h.clock.now() + 3600_000);
  const limited = ok(await h.ask({ model: OPUS }, undefined, tipped.id)) as unknown as { modelId: string; suggestion?: string; instead?: string };
  assert.deepEqual([limited.modelId, limited.suggestion], [SOL, undefined], 'the preview stays on the model I am on');
  assert.match(limited.instead ?? '', /^Asked for Claude Opus 5\.5 – no account of it can run now \(limited until .+\)\. My next turn here runs on GPT-6\.1 Sol · \w+\.$/, 'D1: the answer says why'); // waits on T1 (routing/unfit.ts askedMiss)
  const row = h.db.get<{ value: string }>("SELECT value FROM kv WHERE ns = 'next_route' AND key = ?", [AGENT]);
  assert.equal(JSON.parse(row!.value).modelId, OPUS, 'stored as asked');

  const free = h.chats.create({ agentIds: [AGENT], createdBy: 'human' });
  const answer = ok(await h.ask({ effort: 'xhigh' }, undefined, free.id)) as unknown as { effort: string };
  const next = await h.turn(undefined, undefined, free.id);
  assert.equal(answer.effort, next.effort);
  assert.equal(next.effort, 'xhigh');
});

test('B-080: planTurn reads the next step and leaves it – a turn that fails before its engine keeps it; turn.ts takes it', async () => {
  const h = await rt2Setup();
  h.seed(SOL, 'low', 'coding');
  setNextRoute(h.db, AGENT, { effort: 'max', at: h.clock.now() });
  const plan = () => planTurn(h.services, {
    runId: 'plan_s', agentId: AGENT, conversationId: h.chat.id, reason: 'message', notes: [],
    signal: new AbortController().signal, control: { lastSeq: 0, steeredSeq: 0 },
  });
  assert.equal((await plan())!.previous?.effort, 'max', 'a first plan (its route then failed)');
  const next = (await plan())!;
  assert.equal(next.previous?.effort, 'max', 'the next turn still has it');
  takeNextRoute(h.db, AGENT, next.nextStepAt);
  assert.equal((await plan())!.previous?.explicit, undefined, 'taken once the engine started');
});



test('B-080 (route-category): pinned Sol unavailable – two turns of one task both get the task\'s category, no "new work ("', async () => {
  const h = await rt2Setup();
  h.org.add({ ...h.org.get(AGENT)!, mode: 'chat', modelPolicy: { pin: SOL } });
  h.org.add(agent('ag_lena', 'Lena'));
  h.chats.setMembers(h.chat.id, { add: ['ag_lena'] }, 'human');
  const task = h.tasks.create({ conversationId: h.chat.id, title: 'Postfach-Abgleich der Antworten', notes: 'Wer hat schon auf die Mail geantwortet?', assigneeKind: 'agent', assigneeId: AGENT, createdBy: 'human' });
  (h.services.accounts as unknown as FakeAccounts).markLimited('acc_codex', h.clock.now() + 4 * 3600_000); // Sol (and Luna) cannot run
  h.chats.send({ conversationId: h.chat.id, authorId: 'ag_lena', body: 'Originalvideo ist fertig, die Animation und der Schnitt stehen.' });
  const first = await h.turn(task.id, 'go on', h.chat.id, 'task');
  h.chats.send({ conversationId: h.chat.id, authorId: 'ag_lena', body: 'Der LinkedIn-Post steht, das Thumbnail auch.' });
  const second = await h.turn(task.id, 'go on', h.chat.id, 'task');
  assert.notEqual(first.modelId, SOL, 'a stand-in runs');
  assert.deepEqual([first.category, second.category], ['personal-assistant', 'personal-assistant'], 'the task\'s kind, not the colleague\'s reports');
  for (const route of [first, second]) assert.doesNotMatch(route.reason, /new work \(/);
});

test('B-083 D1: a model I name that cannot run now – the answer says why, my running turn stays, the task request holds until it runs', async () => {
  const h = await rt2Setup();
  h.seed(SOL, 'high', 'coding');
  const switches: unknown[] = [];
  Object.assign(h.services, { dispatcher: {
    activity: () => [{ agentId: AGENT, runId: 'run_tool', note: '', startedAt: 0, model: SOL, effort: 'high' as Effort }],
    continueNow: (...args: unknown[]) => { switches.push(args); return true; },
  } });
  const task = h.tasks.create({ conversationId: h.chat.id, title: 'Port the parser', assigneeKind: 'agent', assigneeId: AGENT, createdBy: 'human' });
  const reset = h.clock.now() + 3 * 24 * 3600_000; // the Claude plan's weekly window
  (h.services.accounts as unknown as FakeAccounts).markLimited('acc_claude', reset);
  const answer = ok(await h.ask({ model: OPUS, effort: 'high', task: task.id, now: true }, task.id)) as unknown as { modelId: string; appliesTo: string; instead?: string; now?: string };
  assert.equal(answer.now, 'my running turn stays on GPT-6.1 Sol');
  assert.deepEqual(switches, [], 'no cut and no switch onto a model I did not name');
  assert.match(answer.appliesTo, new RegExp(`^every turn on task ${task.id}`));
  const stored = () => JSON.parse(h.db.get<{ value: string }>("SELECT value FROM kv WHERE ns = 'next_route_task' AND key = ?", [`${AGENT}:${task.id}`])!.value);
  assert.equal(stored().modelId, OPUS, 'the request stays as asked');
  // The texts and the turn's model below come from the router's D1 rule (T1: routing/router.ts, routing/unfit.ts askedMiss).
  assert.equal(answer.modelId, SOL);
  assert.match(answer.instead ?? '', new RegExp(`^Asked for Claude Opus 5\\.5 – no account of it can run now \\(limited until .+\\)\\. My request stays: my turns on task ${task.id} take Claude Opus 5\\.5 from the first one it can run; until then they run on GPT-6\\.1 Sol · high\\.$`));
  const onTask = await h.turn(task.id, 'go on', h.chat.id, 'task');
  assert.deepEqual([onTask.modelId, onTask.effort, onTask.by], [SOL, 'high', 'request']);
  assert.match(onTask.reason, /^asked for Claude Opus 5\.5 – no account of it can run now \(limited until .+\) · continues on the previous model/);
  assert.equal(stored().modelId, OPUS, 'still stored for the turns on the task');
  h.clock.advance(3 * 24 * 3600_000);
  const back = await h.turn(task.id, 'go on', h.chat.id, 'task');
  assert.deepEqual([back.modelId, back.effort, back.by], [OPUS, 'high', 'request'], 'after the reset the named model runs');
});

test('B-083 D4: an effort the named model lacks is asked as is – the answer names the effort the router clamps it to', async () => {
  const h = await rt2Setup();
  h.seed(SOL, 'low', 'coding');
  const answer = ok(await h.ask({ model: LUNA, effort: 'max' })) as unknown as { modelId: string; effort: string; instead?: string };
  assert.deepEqual([answer.modelId, answer.effort, answer.instead], [LUNA, 'high', undefined]);
  const row = h.db.get<{ value: string }>("SELECT value FROM kv WHERE ns = 'next_route' AND key = ?", [AGENT]);
  assert.equal(JSON.parse(row!.value).effort, 'max', 'stored as asked');
  assert.equal(pair(await h.turn()), `${LUNA}/high`);
});

test('tasks.create to a colleague with model and effort: the task request exists before its wake is claimed; an unknown model creates nothing', async () => {
  const h = await rt2Setup();
  h.org.add(agent('ag_bo', 'Bo', { mode: 'research' }));
  const ctx = { agent: h.org.get(AGENT)!, runId: 'run_d', conversationId: h.chat.id, mode: 'coding', services: h.services, signal: new AbortController().signal, status() {} } as unknown as ToolContext;
  const create = taskTools.find((tool) => tool.name === 'tasks.create')!;
  const textOf = (result: { content: unknown[] }) => String((result.content[0] as { text?: string }).text);
  const out = JSON.parse(textOf(await create.run({ title: 'Compare the parsers', to: 'ag_bo', effort: 'xhigh' } as never, ctx)));
  const row = h.db.get<{ value: string }>("SELECT value FROM kv WHERE ns = 'next_route_task' AND key = ?", [`ag_bo:${out.taskId}`]);
  assert.equal(JSON.parse(row!.value).effort, 'xhigh', 'stored before anything claims the wake');
  assert.ok(h.wakes.list('ag_bo').some((wake) => wake.taskId === out.taskId && wake.claimedAt === undefined), 'its wake is still unclaimed');
  const tasks = h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')!.n;
  const refused = await create.run({ title: 'x', to: 'ag_bo', model: 'nope' } as never, ctx).catch((error: Error) => ({ content: [{ text: error.message }] }));
  assert.match(textOf(refused), /Unknown model "nope"/);
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')!.n, tasks, 'nothing created');
});
