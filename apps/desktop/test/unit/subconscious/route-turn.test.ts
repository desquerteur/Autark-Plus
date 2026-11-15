// Unterbewusstsein v1 (14.11.2026): the routing call before a turn (subconscious/route-turn.ts routeTurn, switchLine; service.ts
// lookFirst). The answer lands as the subconscious's one-step request (agents/next-route.ts, by 'subconscious') with model id, effort
// and reason; a model the agent's policy avoids and an unknown name set no model; a failed, cut or late call sets nothing; the switch
// line says cold after CACHE_COLD_MS, maybe cached from 5 min, and warm with the last model and its per-call size before it; a
// colleague's wake and a task's are labelled so; without a connected work model there is no call. The service calls once on a person's
// message, on a colleague's with content when no person wrote, else on the turn's task; the turn never waits past ROUTE_WAIT_MS, nothing
// runs after a turn, and each call leaves one info event (v2 15.11.: the route is the call's `line`; hits and context: look.test.ts). Review 14.11.: a request of the agent's own (model.set) or of its task holds the
// turn whole and costs no call; a step set for an earlier message ends on the next turn; a next step continues from the model I am on,
// a task's request alone from its task's runs, a turn without a request skips runs a request shaped. Findings 14.11.: the call reads the
// start model with its effort and who set it, "What I have here" to the end, the models' strong and weak kinds of work and the person's
// language; it names only models the router's policy bounds leave, never sets the effort 'none', and its why stays out of the log.
// Owns: these assertions only. Never: real models, engines or network (the turn's wait runs on mocked timers).

import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { agent, harness } from '../chat/harness.ts';
import { model } from '../context/fixture.ts';
import { account } from '../models/harness.ts';
import { ROUTE_SYSTEM, routeTurn, standingWords, switchLine } from '../../../src/runtime/subconscious/route-turn.ts';
import { factsLine, strengthOverview } from '../../../src/runtime/routing/model-facts.ts';
import { ROUTE_WAIT_MS, SubconsciousImpl } from '../../../src/runtime/subconscious/service.ts';
import { pendingRoute, returnChoice, setNextRoute, setTaskRoute } from '../../../src/runtime/agents/next-route.ts';
import { CACHE_COLD_MS } from '../../../src/runtime/agents/rebuild.ts';
import { DEFAULT_POLICY_KEY, POLICY_NS } from '../../../src/runtime/routing/policies.ts';
import type { StructuredRunner } from '../../../src/runtime/decision/types.ts';
import type { Agent } from '../../../src/shared/model/org.ts';
import type { Account, ModelInfo } from '../../../src/shared/model/providers.ts';
import type { Run } from '../../../src/shared/model/runs.ts';

const LUNA = 'codex:gpt-6.1-luna';
const SOL = 'codex:gpt-6.1-sol';
const ADA = 'ag_ada';
const SAID = 'Bitte prüf den Vertrag für Müller, er unterschreibt morgen.';
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Fake services around a real database and clock: two connected work models on one Codex plan account (the router's pool reads its
 * candidates; `accounts` adds more, e.g. a paying key or a cooling one) and the runs the switch line reads.
 */
function world(options: { runs?: Array<Partial<Run>>; models?: ModelInfo[]; agent?: Partial<Agent>; language?: string; accounts?: Account[]; allowPaid?: boolean; work?: string } = {}) {
  const h = harness();
  const ada = agent(ADA, 'Ada', { role: 'bookkeeper', ...options.agent });
  h.org.add(ada);
  const models = new Map((options.models ?? [model(LUNA, 'small', 'GPT-6.1 Luna'), model(SOL, 'frontier', 'GPT-6.1 Sol')]).map((info) => [info.id, info]));
  const runs = options.runs ?? [];
  const accounts = options.accounts ?? [account('acc_1', 'codex')];
  Object.assign(h.services, {
    catalog: { get: (id: string) => models.get(id), list: () => [...models.values()] },
    accounts: { list: () => accounts, candidates: () => accounts.filter((item) => item.state === 'ok') },
    runs: { list: () => runs },
    settings: { get: () => ({ profile: { name: 'Stanislaus', timezone: 'UTC', ...(options.language ? { language: options.language } : {}) }, routing: { allowPaidFallback: options.allowPaid ?? false, ...(options.work ? { work: options.work } : {}) } }) },
  });
  const stored = () => pendingRoute(h.db, ADA, undefined, () => false);
  return { h, ada, stored };
}

/** A decision model with one answer for every call: a JSON object, an error it throws, or 'hang' (it ends only when its call is cut). */
function answering(answer: Record<string, unknown> | Error | 'hang', gate?: Promise<void>) {
  const calls: Array<Parameters<StructuredRunner>[0]> = [];
  const runner: StructuredRunner = async (call) => {
    calls.push(call);
    if (gate) await gate;
    if (answer instanceof Error) throw answer;
    if (answer === 'hang') return new Promise((_resolve, reject) => call.signal?.addEventListener('abort', () => reject(new Error('cut')), { once: true }));
    return { text: JSON.stringify(answer), structured: answer, by: 'fake' };
  };
  return { runner, calls };
}

const pick = (model: string, effort: string, why = 'a contract the customer signs') => ({ hardest: 'the contract', misread: false, decide: true, model, effort, why });

test('the answer lands as my subconscious\'s one-step request: model id, effort, its why as reason', async () => {
  const w = world();
  const brain = answering(pick('GPT-6.1 Sol', 'high', '  a contract\n the customer   signs '));
  const line = (await routeTurn(w.h.services, brain.runner, { agent: w.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS }))?.line;
  assert.equal(line, 'GPT-6.1 Sol · high', 'the line names the route; its why stays on the request');
  const at = w.h.clock.now();
  assert.deepEqual(w.stored(), { modelId: SOL, effort: 'high', reason: 'a contract the customer signs', by: 'subconscious', at, stepAt: at });
  const [call] = brain.calls;
  assert.deepEqual([call.purpose, call.system, call.effort, call.deadlineMs], ['subconscious', ROUTE_SYSTEM, 'low', ROUTE_WAIT_MS]);
  assert.deepEqual((call.schema as { properties: { model: { enum: string[] } } }).properties.model.enum, ['GPT-6.1 Sol', 'GPT-6.1 Luna'], 'the cheap model names what it can run on, the strongest tier first');
  assert.match(call.prompt, /^Agent: Ada – bookkeeper \(mode general\)\./);
  assert.ok(call.prompt.includes(`The person's new message:\n${SAID}`), call.prompt);
  assert.ok(call.prompt.includes('What a switch costs now: the main AI has no turn yet'), 'the switch cost is a fact in the prompt');
});

test('a model the agent\'s policy avoids is not offered and not set; its effort still is, and with no valid effort nothing is', async () => {
  const w = world({ agent: { modelPolicy: { avoid: [SOL] } as Agent['modelPolicy'] } });
  const brain = answering(pick('GPT-6.1 Sol', 'high'));
  assert.equal((await routeTurn(w.h.services, brain.runner, { agent: w.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS }))?.line, 'same model · high');
  assert.deepEqual((brain.calls[0].schema as { properties: { model: { enum: string[] } } }).properties.model.enum, ['GPT-6.1 Luna'], 'review 14.11.: the call names only models it can set');
  // The router's bounds are the agent's and the default policy's (routing/policies.ts effectivePolicy): those of the default too.
  const global = world();
  global.h.db.run('INSERT INTO kv (ns, key, value, updated_at) VALUES (?, ?, ?, ?)', [POLICY_NS, DEFAULT_POLICY_KEY, JSON.stringify({ avoid: [SOL] }), 1]);
  const bounded = answering(pick('GPT-6.1 Sol', 'high'));
  assert.equal((await routeTurn(global.h.services, bounded.runner, { agent: global.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS }))?.line, 'same model · high');
  assert.deepEqual((bounded.calls[0].schema as { properties: { model: { enum: string[] } } }).properties.model.enum, ['GPT-6.1 Luna']);
  assert.equal(global.stored()?.modelId, undefined, 'a model the default policy avoids is not stored');
  const band = world({ agent: { modelPolicy: { ceilingTier: 'small' } as Agent['modelPolicy'] } });
  const banded = answering(pick('GPT-6.1 Luna', 'low'));
  await routeTurn(band.h.services, banded.runner, { agent: band.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS });
  assert.deepEqual((banded.calls[0].schema as { properties: { model: { enum: string[] } } }).properties.model.enum, ['GPT-6.1 Luna'], 'and the tier band');
  assert.deepEqual([w.stored()?.modelId, w.stored()?.effort], [undefined, 'high']);
  const none = world({ agent: { modelPolicy: { avoid: [SOL] } as Agent['modelPolicy'] } });
  assert.equal((await routeTurn(none.h.services, answering(pick('GPT-6.1 Sol', 'extreme')).runner, { agent: none.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS }))?.line, undefined);
  assert.equal(none.stored(), undefined);
});

test('an unknown model name sets no model: with a wrong effort nothing at all, with a right one only the effort', async () => {
  const w = world();
  assert.equal((await routeTurn(w.h.services, answering(pick('GPT-9 Ultra', 'extreme')).runner, { agent: w.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS }))?.line, undefined);
  assert.equal(w.stored(), undefined);
  await routeTurn(w.h.services, answering(pick('GPT-9 Ultra', 'medium')).runner, { agent: w.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS });
  assert.deepEqual([w.stored()?.modelId, w.stored()?.effort], [undefined, 'medium']);
});

test('a runner error, a cut call and an answer after the cut return undefined and set nothing', async () => {
  const w = world();
  assert.equal((await routeTurn(w.h.services, answering(new Error('model down')).runner, { agent: w.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS }))?.line, undefined);
  const cut = new AbortController();
  const hanging = routeTurn(w.h.services, answering('hang').runner, { agent: w.ada, said: SAID, signal: cut.signal, deadlineMs: ROUTE_WAIT_MS });
  await flush();
  cut.abort();
  assert.equal(await hanging, undefined);
  let release = () => {};
  const late = answering(pick('GPT-6.1 Sol', 'high'), new Promise<void>((resolve) => { release = resolve; }));
  const stop = new AbortController();
  const routed = routeTurn(w.h.services, late.runner, { agent: w.ada, said: SAID, signal: stop.signal, deadlineMs: ROUTE_WAIT_MS });
  await flush();
  stop.abort();
  release();
  assert.equal(await routed, undefined, 'the turn runs already: a late answer shapes no later turn');
  assert.equal(w.stored(), undefined);
});

test('the switch line: cold after CACHE_COLD_MS, maybe cached after 5 min, warm with the last model, its effort and per-call size before it; a part\'s run does not count', () => {
  const now = Date.UTC(2026, 10, 14, 3, 0);
  const last = { model: SOL, effort: 'high' as const, inputTokens: 360_000, modelCalls: 3 };
  const part = { model: LUNA, splitId: 'sp_1', endedAt: now - 60_000 };
  const warm = world({ runs: [part, { ...last, endedAt: now - 5 * 60_000 }] });
  assert.equal(switchLine(warm.h.services, warm.ada, now),
    "What a switch costs now: the main AI's last turn ran 5 min ago on GPT-6.1 Sol · high; its context (about 120k tokens per call) is still cached on it. Staying keeps that cache; another model first reads it once uncached at its own input price.");
  const maybe = world({ runs: [{ ...last, endedAt: now - 25 * 60_000 }] });
  assert.equal(switchLine(maybe.h.services, maybe.ada, now),
    "What a switch costs now: the main AI's last turn ran 25 min ago on GPT-6.1 Sol · high; its context (about 120k tokens per call) may still be cached on it – a provider keeps a cache from about 5 minutes to an hour. Staying may keep that cache; another model first reads it once uncached at its own input price.");
  const cold = world({ runs: [{ ...last, endedAt: now - CACHE_COLD_MS - 60_000 }] });
  assert.equal(switchLine(cold.h.services, cold.ada, now), "What a switch costs now: nothing – the main AI's last turn ended 61 min ago, its cache is cold, any model reads about 120k tokens per call uncached.");
  const fresh = world();
  assert.equal(switchLine(fresh.h.services, fresh.ada, now), 'What a switch costs now: the main AI has no turn yet – any model costs the same.');
});

test("a colleague's wake is labelled as the colleague's message, not the person's", async () => {
  const w = world();
  const brain = answering(pick('GPT-6.1 Luna', 'low', 'a receipt to take note of'));
  await routeTurn(w.h.services, brain.runner, { agent: w.ada, said: 'Konrad: Die Rechnung ist raus.', from: 'colleague', deadlineMs: ROUTE_WAIT_MS });
  assert.ok(brain.calls[0].prompt.includes("The colleague's message that wakes the main AI:\nKonrad: Die Rechnung ist raus."), brain.calls[0].prompt);
  assert.ok(!brain.calls[0].prompt.includes("The person's new message:"));
  assert.equal(w.stored()?.modelId, LUNA);
});

test('no connected work model: no call, nothing set', async () => {
  const w = world({ models: [{ ...model(SOL, 'frontier', 'GPT-6.1 Sol'), available: false }] });
  const brain = answering(pick('GPT-6.1 Sol', 'high'));
  assert.equal((await routeTurn(w.h.services, brain.runner, { agent: w.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS }))?.line, undefined);
  assert.equal(brain.calls.length, 0);
  assert.equal(w.stored(), undefined);
});

test('service: a person\'s message calls the runner once and the turn waits at most ROUTE_WAIT_MS; the cut call sets nothing', async () => {
  const w = world();
  const brain = answering('hang');
  const impl = new SubconsciousImpl({ services: () => w.h.services, runner: brain.runner });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let waited = true;
    const turn = impl.beforeTurn({ agent: w.ada, thread: 'main', said: SAID }).finally(() => { waited = false; });
    await flush();
    assert.equal(brain.calls.length, 1);
    assert.equal(brain.calls[0].deadlineMs, ROUTE_WAIT_MS);
    mock.timers.tick(ROUTE_WAIT_MS - 1);
    await flush();
    assert.equal(waited, true, 'still within the wait');
    mock.timers.tick(1);
    assert.equal(await turn, undefined);
    assert.equal(brain.calls[0].signal?.aborted, true, 'the call is cut with the wait');
    await impl.settle();
    assert.equal(w.stored(), undefined);
  } finally { mock.timers.reset(); }
  const quick = world();
  const sure = answering(pick('GPT-6.1 Sol', 'high'));
  const fast = new SubconsciousImpl({ services: () => quick.h.services, runner: sure.runner });
  await fast.beforeTurn({ agent: quick.ada, thread: 'main', said: SAID });
  assert.equal(quick.stored()?.modelId, SOL, 'an answer within the wait runs this turn');
  await fast.beforeTurn({ agent: quick.ada, thread: 'main', said: 'ja bitte' });
  assert.equal(sure.calls.length, 1, 'a bare go-ahead costs no call');
});

test('service: a wake by colleagues only calls with the colleague label; a person\'s line goes first; a bare colleague line costs no call', async () => {
  const w = world();
  const brain = answering(pick('GPT-6.1 Luna', 'low', 'a report to take note of'));
  const impl = new SubconsciousImpl({ services: () => w.h.services, runner: brain.runner });
  await impl.beforeTurn({ agent: w.ada, thread: 'main', said: '', woke: 'Der Bericht für Q3 liegt in reports/q3.md, die Zahlen sind geprüft.' });
  assert.equal(brain.calls.length, 1);
  assert.ok(brain.calls[0].prompt.includes("The colleague's message that wakes the main AI:\nDer Bericht für Q3"), brain.calls[0].prompt);
  await impl.beforeTurn({ agent: w.ada, thread: 'main', said: SAID, woke: 'Der Bericht für Q3 liegt in reports/q3.md.' });
  assert.ok(brain.calls[1].prompt.includes(`The person's new message:\n${SAID}`));
  assert.ok(!brain.calls[1].prompt.includes('Der Bericht für Q3'), 'what the person wrote is the wake');
  await impl.beforeTurn({ agent: w.ada, thread: 'main', said: '', woke: 'ok, danke' });
  assert.equal(brain.calls.length, 2);
});

test('service: nothing runs after a turn; settle waits only for a routing call in flight', async () => {
  const w = world();
  let release = () => {};
  const brain = answering(pick('GPT-6.1 Sol', 'high'), new Promise<void>((resolve) => { release = resolve; }));
  const impl = new SubconsciousImpl({ services: () => w.h.services, runner: brain.runner });
  assert.equal('afterTurn' in impl, false, 'no hook after a turn');
  await impl.settle(); // nothing in flight: at once
  const turn = impl.beforeTurn({ agent: w.ada, thread: 'main', said: SAID });
  await flush();
  let settled = false;
  const settling = impl.settle().then(() => { settled = true; });
  await flush();
  assert.equal(settled, false, 'the call in flight ends first');
  release();
  await turn;
  await settling;
  assert.equal(w.stored()?.modelId, SOL);
});

test("a request of the agent's own or of its task holds the turn's route: without hits or context items no call, the request stays with its temperature", async () => {
  const w = world();
  const brain = answering(pick('GPT-6.1 Luna', 'low', 'a status to take note of'));
  const impl = new SubconsciousImpl({ services: () => w.h.services, runner: brain.runner });
  setNextRoute(w.h.db, ADA, { modelId: SOL, effort: 'high', temperature: 0.2, at: 1 }); // model.set, also with now: the continuation reads the same message
  await impl.beforeTurn({ agent: w.ada, thread: 'main', said: 'Status: Teil 1 ist fertig, die Zahlen stehen in reports/q3.md.' });
  assert.equal(brain.calls.length, 0, "the agent's own model.set holds");
  assert.deepEqual(w.stored(), { modelId: SOL, effort: 'high', temperature: 0.2, at: 1, stepAt: 1 });

  const held = world();
  Object.assign(held.h.services, { tasks: { get: (id: string) => (id === 'tk_1' ? { id, status: 'in_progress' } : undefined) } });
  setTaskRoute(held.h.db, ADA, 'tk_1', { modelId: SOL, effort: 'high', reason: 'delegated by Konrad', at: 1 });
  const other = answering(pick('GPT-6.1 Luna', 'low', 'a status to take note of'));
  const onTask = new SubconsciousImpl({ services: () => held.h.services, runner: other.runner });
  await onTask.beforeTurn({ agent: held.ada, thread: 'main', taskId: 'tk_1', said: SAID });
  assert.equal(other.calls.length, 0, "the task's request holds its turns");
  await onTask.beforeTurn({ agent: held.ada, thread: 'main', said: SAID });
  assert.equal(other.calls.length, 1, 'off the task the call runs');
});

test('a step set for an earlier message ends on the next turn: a turn that failed before its engine hands nothing to the next', async () => {
  const w = world();
  const brain = answering(pick('GPT-6.1 Luna', 'low', 'a status to take note of'));
  const impl = new SubconsciousImpl({ services: () => w.h.services, runner: brain.runner });
  await impl.beforeTurn({ agent: w.ada, thread: 'main', said: '', woke: 'Der Bericht für Q3 liegt in reports/q3.md, die Zahlen sind geprüft.' });
  assert.equal(w.stored()?.modelId, LUNA); // that turn fails before its engine: nothing takes the step
  await impl.beforeTurn({ agent: w.ada, thread: 'main', said: 'ja' });
  assert.equal(brain.calls.length, 1, 'a bare yes costs no call');
  assert.equal(w.stored(), undefined, "the person's turn does not run on the step set for the colleague's line");
});

test('the return rule: a next step continues from the model I am on, whatever shaped it; a task request alone from its task\'s runs; a turn without a request skips runs a request shaped', () => {
  const before = { model: LUNA, effort: 'medium', status: 'done', route: { reason: 'continues on the previous model · chat', by: 'previous', category: 'chat' } } as Run;
  const routed = { model: SOL, effort: 'high', status: 'done', route: { reason: 'my subconscious: a contract the customer signs · coding', by: 'request', category: 'coding' } } as Run;
  const asked = { ...routed, route: { reason: 'requested by the agent · coding', by: 'request', category: 'coding' } } as Run;
  const step = { effort: 'medium' as const, reason: 'going on with set work', by: 'subconscious' as const, at: 1 };
  assert.deepEqual(returnChoice([routed, before], step), { modelId: SOL, effort: 'medium', explicit: true, asked: 'effort', category: 'coding', by: 'subconscious', why: 'going on with set work' }, 'the model I am on, with its warm cache');
  assert.deepEqual(returnChoice([routed, before], undefined), { modelId: LUNA, effort: 'medium', category: 'chat' }, 'a model set for another message never carries over');
  assert.deepEqual(returnChoice([asked, before], undefined), { modelId: LUNA, effort: 'medium', category: 'chat' });
  assert.equal(returnChoice([asked, before], step)?.modelId, SOL, 'a next step is relative to the model I am on, whatever shaped it');
  // Reviews 14.11.: my own effort-only model.set for the next step is relative to the model I am on – model.set's preview shows that one.
  const own = { effort: 'max' as const, at: 2, stepAt: 2 };
  assert.deepEqual(returnChoice([routed, before], own), { modelId: SOL, effort: 'max', explicit: true, asked: 'effort', category: 'coding' }, 'it stays on the routed model');
  assert.equal(returnChoice([asked, before], own)?.modelId, SOL, 'and on a model my own model.set chose');
  assert.equal(returnChoice([routed, before], { temperature: 0.2, at: 3, stepAt: 3 })?.modelId, SOL, 'a temperature-only request too');
  // A task's request alone (tasks.create effort high) is relative to where that task ran – never to a model set for other work.
  const T = 'task_q3';
  const receipt = { ...routed, model: LUNA, effort: 'low', route: { reason: 'my subconscious: a receipt to take note of · chat', by: 'request', category: 'chat' } } as Run;
  const ownTask = { model: 'codex:gpt-6.1-terra', effort: 'high', status: 'done', taskId: T, route: { reason: 'effort requested by the agent · writing', by: 'request', category: 'writing' } } as Run;
  const delegated = { effort: 'high' as const, reason: 'given by Lead', at: 4 };
  assert.deepEqual(returnChoice([receipt, ownTask, before], delegated, { taskId: T }), { modelId: 'codex:gpt-6.1-terra', effort: 'high', explicit: true, asked: 'effort', category: 'writing' }, "the task's own newest run");
  assert.equal(returnChoice([receipt, before], delegated, { taskId: T })?.modelId, LUNA, 'no run of the task yet: the router\'s last own choice, not the receipt\'s Luna · low');
  assert.equal(returnChoice([receipt, before], delegated, { taskId: T })?.category, 'chat');
  // The model the work stays on while a task's named model cannot run (D1 `from`): the task's own, never the receipt's small model.
  assert.equal(returnChoice([receipt, ownTask, before], { modelId: SOL, effort: 'high', at: 5 }, { taskId: T })?.from, 'codex:gpt-6.1-terra');
  assert.equal(returnChoice([receipt, ownTask, before], { modelId: SOL, effort: 'high', at: 5, stepAt: 5 })?.from, LUNA, 'a next step: the model I am on');
});

test("a wake with a task and nobody's words routes on its task with its own label; a person's line and a colleague's with content go first", async () => {
  const w = world();
  const brain = answering(pick('GPT-6.1 Sol', 'high', 'the books of a month'));
  const impl = new SubconsciousImpl({ services: () => w.h.services, runner: brain.runner });
  const TASK = 'Monatsabschluss Oktober\nKonrad hat die Belege abgelegt, die Buchungen fehlen noch.';
  await impl.beforeTurn({ agent: w.ada, thread: 'main', said: '', woke: '', taskText: TASK });
  assert.equal(brain.calls.length, 1);
  assert.ok(brain.calls[0].prompt.includes(`The task that wakes the main AI:\n${TASK}`), brain.calls[0].prompt);
  assert.ok(!brain.calls[0].prompt.includes("The person's new message:"));
  assert.equal(w.stored()?.modelId, SOL);
  await impl.beforeTurn({ agent: w.ada, thread: 'main', said: '', woke: 'ok, danke', taskText: TASK });
  assert.ok(brain.calls[1].prompt.includes('The task that wakes the main AI:'), "a colleague's bare receipt: the task's work decides");
  await impl.beforeTurn({ agent: w.ada, thread: 'main', said: '', woke: 'Der Bericht für Q3 liegt in reports/q3.md, die Zahlen sind geprüft.', taskText: TASK });
  assert.ok(brain.calls[2].prompt.includes("The colleague's message that wakes the main AI:\nDer Bericht für Q3"));
  await impl.beforeTurn({ agent: w.ada, thread: 'main', said: 'ja bitte', taskText: TASK });
  assert.equal(brain.calls.length, 3, "a person's bare go-ahead is the wake, and it holds nothing to weigh");
  await impl.beforeTurn({ agent: w.ada, thread: 'main', said: '', woke: '' });
  assert.equal(brain.calls.length, 3, 'neither words nor a task: no call');
  assert.equal(w.stored(), undefined, 'and the step set for the earlier wake ended');
});

test("the person's standing words reach the call: the start model with its effort and who set it, What I have here whole", async () => {
  const have = ['## My role', 'Bookkeeper.', '', '## What I have here', '- This PC is my workplace, all of it.', '- Stanislaus 12.11.: Beim Programmieren gerne mit Opus high.'].join('\n');
  const w = world({ agent: { instructions: have, modelPolicy: { pin: SOL, effort: 'high', pinBy: { name: 'Stanislaus', at: Date.UTC(2026, 10, 12, 9) } } } });
  const brain = answering(pick('GPT-6.1 Sol', 'high'));
  await routeTurn(w.h.services, brain.runner, { agent: w.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS });
  const [{ prompt }] = brain.calls;
  assert.ok(prompt.includes('start model GPT-6.1 Sol · effort high (set by Stanislaus, 2026-11-12)'), prompt);
  assert.ok(prompt.includes('What the agent has here – its standing facts and agreements (its SYSTEM.md):\n- This PC is my workplace, all of it.\n- Stanislaus 12.11.: Beim Programmieren gerne mit Opus high.\n'), prompt);
  assert.ok(prompt.indexOf('What the agent has here') < prompt.indexOf("The main AI's coming turn:"), 'the same each turn, so before what changes');
  assert.match(ROUTE_SYSTEM, /in the agent's standing facts and agreements, or with the start model and effort they set – outweighs my weighing/);
  const unpinned = world({ agent: { modelPolicy: { effort: 'xhigh' } as Agent['modelPolicy'] } });
  const plain = answering(pick('GPT-6.1 Sol', 'high'));
  await routeTurn(unpinned.h.services, plain.runner, { agent: unpinned.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS });
  assert.ok(plain.calls[0].prompt.includes('start model chosen per task · effort xhigh.'), plain.calls[0].prompt);
  assert.ok(!plain.calls[0].prompt.includes('What the agent has here'), 'no such part, no such lines');

  // Reviews 14.11. (6 live SYSTEM.md files): agents keep their agreements under their own subheadings and in their own parts after it,
  // not by day, up to 15,181 characters – the app's own split (org/hire.ts splitAtHave) reads it to the end.
  const lines = Array.from({ length: 150 }, (_unused, index) => `- Line ${index}: ${'x'.repeat(60)}`);
  const WISH = '- Konrad 10.11.: Gutes KI-Modell und einen hohen effort bei Social Media.';
  const body = ['### Arbeitsweise und Vereinbarungen', ...lines.slice(0, 75), WISH, '### Erledigt', ...lines.slice(75), '## Vereinbarungen mit Konrad', '- Konrad 11.11.: Für Social Media effort high.'].join('\n');
  const long = world({ agent: { instructions: `# How I work\nTeam text.\n\n## My role\nSocial media.\n\n## What I have here\r\n${body.replace(/\n/g, '\r\n')}` } });
  const words = standingWords(long.h.services, long.ada);
  assert.equal(words, body, 'whole to the end, its subheadings and its own parts in it, CRLF read as LF');
  assert.ok(words.includes(WISH), 'a model wish in the middle reaches the call');
  assert.ok(!words.includes('Team text') && !words.includes('Social media.'), 'nothing above it');
  const huge = world({ agent: { instructions: `## What I have here\n${'- y\n'.repeat(9_000)}` } });
  assert.ok(standingWords(huge.h.services, huge.ada).length <= 16_002, 'bounded');
});

test("the call never turns thinking off: no 'none' among the efforts it names, and a 'none' answer sets no effort", async () => {
  const w = world();
  const brain = answering(pick('GPT-6.1 Luna', 'none', 'a status to take note of'));
  assert.equal((await routeTurn(w.h.services, brain.runner, { agent: w.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS }))?.line, 'GPT-6.1 Luna · same effort');
  assert.deepEqual((brain.calls[0].schema as { properties: { effort: { enum: string[] } } }).properties.effort.enum, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual([w.stored()?.modelId, w.stored()?.effort], [LUNA, undefined]);
});

test("the call's own model list: per model its tier, smarts, how a turn is paid and its strong and weak kinds of work; the main AI's line stays as it is; the why in the person's language", async () => {
  const sol = { ...model(SOL, 'frontier', 'GPT-6.1 Sol'), smarts: 90, strengths: { coding: 0.8, research: 0.6, chat: -0.4 } };
  const luna = { ...model(LUNA, 'small', 'GPT-6.1 Luna'), smarts: 60, strengths: { coding: -0.5 } };
  const w = world({ models: [luna, sol], language: 'de' });
  const brain = answering(pick('GPT-6.1 Sol', 'high'));
  await routeTurn(w.h.services, brain.runner, { agent: w.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS });
  const [{ prompt }] = brain.calls;
  assert.ok(prompt.endsWith([
    'The models the turn can run on now (tier · $ in/out per 1M tokens · smarts 0–100 · how a turn is paid · fit -1…+1 per kind of work); a plan costs nothing per turn while its quota lasts, an API key pays every token:',
    `- GPT-6.1 Sol · frontier · smarts 90 · plan · ${strengthOverview(sol)}`,
    `- GPT-6.1 Luna · small · smarts 60 · plan · ${strengthOverview(luna)}`,
  ].join('\n')), prompt);
  assert.ok(!factsLine([luna, sol], []).includes('strong:'), "the main AI's own line names no strengths (its prompt cache holds)");
  assert.match(strengthOverview(sol)!, /^strong: .*coding \+0\.80.* · weak: .*-0\.40$/);
  assert.match(prompt, /^Agent: Ada – bookkeeper \(mode general\)\. The person writes in German\.\n/);
  assert.match(ROUTE_SYSTEM, /why in one short sentence in the language the person writes in; then the hits I open/);
  const bare = world();
  const plain = answering(pick('GPT-6.1 Sol', 'high'));
  await routeTurn(bare.h.services, plain.runner, { agent: bare.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS });
  assert.ok(!plain.calls[0].prompt.includes('strong:') && !plain.calls[0].prompt.includes('weak:'), 'no known strength: none named');
  assert.ok(!plain.calls[0].prompt.includes('The person writes in'), 'no profile language: no guess');
});

test("re-review 14.11.: the call names only what the router runs for this turn – its own pool: healthy accounts, a plan before a paying key, the mode's tier, the turn's needs; per tier the smartest", async () => {
  const enumOf = (call: Parameters<StructuredRunner>[0]) => (call.schema as { properties: { model: { enum: string[] } } }).properties.model.enum;
  const call = async (w: ReturnType<typeof world>, extra: Partial<Parameters<typeof routeTurn>[2]> = {}, answer = pick('Claude Opus 5.5', 'high')) => {
    const brain = answering(answer);
    await routeTurn(w.h.services, brain.runner, { agent: w.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS, ...extra });
    return brain.calls[0];
  };
  // A paying key's twin of a plan model (the same name): with pay-per-use fallback off the router never runs it, so it is not offered.
  const plan = { ...model('claude:claude-opus-5-5', 'frontier', 'Claude Opus 5.5'), provider: 'claude', engine: 'claude', accounts: ['acc_plan'] } as ModelInfo;
  const paid = { ...model('anthropic:claude-opus-5-5', 'frontier', 'Claude Opus 5.5'), provider: 'anthropic', engine: 'anthropic', accounts: ['acc_key'] } as ModelInfo;
  const keyed = world({ models: [paid, plan, model(LUNA, 'small', 'GPT-6.1 Luna')], accounts: [account('acc_plan', 'claude'), account('acc_key', 'anthropic'), account('acc_1', 'codex')] });
  assert.deepEqual(enumOf(await call(keyed)), ['Claude Opus 5.5', 'GPT-6.1 Luna']);
  assert.equal(keyed.stored()?.modelId, 'claude:claude-opus-5-5', "the plan's, not the paying key's");
  const spill = world({ models: [paid, plan], accounts: [account('acc_plan', 'claude'), account('acc_key', 'anthropic')], allowPaid: true });
  await call(spill);
  assert.equal(spill.stored()?.modelId, 'claude:claude-opus-5-5', 'with the key allowed too: one name, the plan first');
  // A cooling account's model is not in the pool now.
  const cooling = world({ models: [plan, model(LUNA, 'small', 'GPT-6.1 Luna')], accounts: [account('acc_plan', 'claude', { state: 'cooling' }), account('acc_1', 'codex')] });
  assert.deepEqual(enumOf(await call(cooling, {}, pick('GPT-6.1 Luna', 'low'))), ['GPT-6.1 Luna']);
  // The mode's minimum tier and the turn's needs (an image): the router's own filters.
  const tiered = world();
  Object.assign(tiered.h.services, { modes: { get: (key: string) => ({ key, category: 'computer', minTier: 'strong' }) } });
  assert.deepEqual(enumOf(await call(tiered, { mode: 'computer' }, pick('GPT-6.1 Sol', 'high'))), ['GPT-6.1 Sol'], 'mode computer (strong): no small model');
  const seeing = world({ models: [model(LUNA, 'small', 'GPT-6.1 Luna'), { ...model(SOL, 'frontier', 'GPT-6.1 Sol'), caps: { vision: true } }] });
  assert.deepEqual(enumOf(await call(seeing, { vision: true }, pick('GPT-6.1 Sol', 'high'))), ['GPT-6.1 Sol'], 'an image: only models that see');
  // Many models: per tier the PER_TIER smartest, so the middle and small kinds still show.
  const many = [1, 2, 3, 4, 5, 6].map((n) => ({ ...model(`codex:f${n}`, 'frontier', `Frontier ${n}`), smarts: 90 + n }));
  const wide = world({ models: [...many, { ...model('codex:s1', 'strong', 'Strong 1'), smarts: 80 }, model(LUNA, 'small', 'GPT-6.1 Luna')] });
  assert.deepEqual(enumOf(await call(wide, {}, pick('Strong 1', 'medium'))), ['Frontier 6', 'Frontier 5', 'Frontier 4', 'Frontier 3', 'Strong 1', 'GPT-6.1 Luna']);
  // How a turn is paid: on the account the router runs the model on (a key holding a plan's credits before a paying one).
  const claude = { ...model('anthropic:claude-opus-5-5', 'frontier', 'Claude Opus 5.5'), provider: 'anthropic', engine: 'anthropic', accounts: ['acc_key', 'acc_credits'] } as ModelInfo;
  const credits = world({ models: [claude], accounts: [account('acc_key', 'anthropic'), account('acc_credits', 'anthropic', { credits: true })] });
  assert.match((await call(credits)).prompt, /\n- Claude Opus 5\.5 · frontier · plan$/, 'review 14.11.: the credits key it runs on, not the first listed paying key');
});

test("review 14.11.: the models the person or the work stand on are always listed – the start model past the cap or outside the band, the Work model, the chat's suggestion, the last turn's – and naming the one the router runs anyway keeps only my effort", async () => {
  const enumOf = (call: Parameters<StructuredRunner>[0]) => (call.schema as { properties: { model: { enum: string[] } } }).properties.model.enum;
  const smarter = [1, 2, 3, 4].map((n) => ({ ...model(`codex:f${n}`, 'frontier', `Frontier ${n}`), smarts: 95 + n }));
  const sol = { ...model(SOL, 'frontier', 'GPT-6.1 Sol'), smarts: 90 };
  // The start model, the 5th smartest of its tier: listed; naming it stores only the effort, so the router's step 1 runs it.
  const pinned = world({ models: [...smarter, sol, model(LUNA, 'small', 'GPT-6.1 Luna')], agent: { modelPolicy: { pin: SOL } } });
  const kept = answering(pick('GPT-6.1 Sol', 'high'));
  assert.equal((await routeTurn(pinned.h.services, kept.runner, { agent: pinned.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS }))?.line, 'GPT-6.1 Sol · high');
  assert.ok(enumOf(kept.calls[0]).includes('GPT-6.1 Sol'));
  assert.deepEqual([pinned.stored()?.modelId, pinned.stored()?.effort, pinned.stored()?.by], [undefined, 'high', 'subconscious'], 'the start model runs as the person set it, at my effort');
  // Outside the policy's band (the router runs a start model unbanded): listed too, and kept the same way.
  const banded = world({ agent: { modelPolicy: { pin: SOL, ceilingTier: 'small' } as Agent['modelPolicy'] } });
  const band = answering(pick('GPT-6.1 Sol', 'medium'));
  await routeTurn(banded.h.services, band.runner, { agent: banded.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS });
  assert.deepEqual(enumOf(band.calls[0]), ['GPT-6.1 Sol', 'GPT-6.1 Luna']);
  assert.equal(banded.stored()?.modelId, undefined);
  // No start model of the agent's own: the Work model of Settings stands in its place – named in the facts, listed, kept.
  const working = world({ models: [...smarter, sol], work: SOL });
  const work = answering(pick('GPT-6.1 Sol', 'low'));
  await routeTurn(working.h.services, work.runner, { agent: working.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS });
  assert.ok(work.calls[0].prompt.includes('start model GPT-6.1 Sol (the Work model in Settings)'), work.calls[0].prompt);
  assert.ok(enumOf(work.calls[0]).includes('GPT-6.1 Sol'));
  assert.deepEqual([working.stored()?.modelId, working.stored()?.effort], [undefined, 'low']);
  // The last turn's model past the cap: listed, so staying on a warm cache stays possible – and naming it sets it.
  const warm = world({ models: [...smarter, sol], runs: [{ model: SOL, effort: 'high', status: 'done', startedAt: 1, endedAt: 1 }] });
  const stay = answering(pick('GPT-6.1 Sol', 'high'));
  await routeTurn(warm.h.services, stay.runner, { agent: warm.ada, said: SAID, deadlineMs: ROUTE_WAIT_MS });
  assert.ok(enumOf(stay.calls[0]).includes('GPT-6.1 Sol'));
  assert.equal(warm.stored()?.modelId, SOL, 'not the router\'s own default: the model is mine to set');
});

test('service: each routing call leaves one info event – the line it set, cut, failed or held by request – with its wait; a wake without content none', async () => {
  const events: Array<Record<string, unknown>> = [];
  const listened = () => {
    const w = world();
    Object.assign(w.h.services, { log: { debug() {}, warn() {}, error() {}, info: (message: string, data: Record<string, unknown>) => { if (message === 'subconscious route') events.push(data); } } });
    return w;
  };
  const set = listened();
  const impl = new SubconsciousImpl({ services: () => set.h.services, runner: answering(pick('GPT-6.1 Sol', 'high')).runner });
  await impl.beforeTurn({ agent: set.ada, thread: 'main', said: SAID });
  await impl.beforeTurn({ agent: set.ada, thread: 'main', said: 'ja bitte' });
  const failed = listened();
  await new SubconsciousImpl({ services: () => failed.h.services, runner: answering(new Error('model down')).runner }).beforeTurn({ agent: failed.ada, thread: 'main', said: SAID });
  const held = listened();
  setNextRoute(held.h.db, ADA, { modelId: SOL, at: 1 });
  await new SubconsciousImpl({ services: () => held.h.services, runner: answering(pick('GPT-6.1 Luna', 'low')).runner }).beforeTurn({ agent: held.ada, thread: 'main', said: SAID });
  const cut = listened();
  const stop = new AbortController();
  const turn = new SubconsciousImpl({ services: () => cut.h.services, runner: answering('hang').runner }).beforeTurn({ agent: cut.ada, thread: 'main', said: '', taskText: 'Monatsabschluss Oktober, Buchungen fehlen.', signal: stop.signal });
  await flush();
  stop.abort();
  await turn;
  assert.deepEqual(events.map((event) => [event.agentId, event.wake, event.outcome]), [
    [ADA, 'person', 'GPT-6.1 Sol · high'], [ADA, 'person', 'failed'], [ADA, 'person', 'held by request'], [ADA, 'task', 'cut'],
  ]);
  assert.ok(!JSON.stringify(events).includes('contract'), 'review 14.11.: the why (about the chat) stays out of the log');
  assert.ok(events.every((event) => typeof event.ms === 'number' && event.ms >= 0));
});
