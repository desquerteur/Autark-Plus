// B-083 track R – the subconscious routes the coming turn (v1 14.11.2026: service.ts lookFirst → route-turn.ts, one call;
// agents/next-route.ts `by: 'subconscious'`, agents/turn-prepare.ts reading the request after the look, routing/router.ts
// "my subconscious: <why>"): planTurn of the same turn runs on what the call set; a turn the call routed again continues from that run
// (review 14.11.: a next step is relative to the model I am on), a turn it did not route – a call that set nothing, a wake without
// anyone's words and without a task – goes back to where the router chose last (findings 14.11.), a delegated task's request alone
// holds its turns on the task's own model (re-review 14.11.); a model it named that cannot
// run leaves no "my subconscious" on the route; an effort alone keeps the model; a request read that fails after the look puts the
// trace back; the call reads one line about how the turn runs (route-turn.ts turnFacts, with its temperature and the start effort).
// Owns: these assertions only. Never: real engines, accounts, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { agent, harness } from '../chat/harness.ts';
import { FakeAccounts, FakeEngine, account, mode } from '../models/harness.ts';
import { RESOURCES, model } from '../context/fixture.ts';
import { Priors } from '../../../src/runtime/models/priors.ts';
import { Catalog } from '../../../src/runtime/models/catalog.ts';
import { RouterImpl } from '../../../src/runtime/routing/router.ts';
import { Journal } from '../../../src/runtime/runs/journal.ts';
import { defaultSettings } from '../../../src/runtime/settings/defaults.ts';
import { PromptTemplates } from '../../../src/runtime/context/templates.ts';
import { SubconsciousImpl } from '../../../src/runtime/subconscious/service.ts';
import { turnFacts } from '../../../src/runtime/subconscious/route-turn.ts';
import { planTurn, routeRequest } from '../../../src/runtime/agents/turn-prepare.ts';
import { setTaskRoute, takeNextRoute } from '../../../src/runtime/agents/next-route.ts';
import type { StructuredRunner } from '../../../src/runtime/decision/types.ts';
import type { Effort, EngineId, ModelInfo, RouteDecision } from '../../../src/shared/model/providers.ts';
import type { Run } from '../../../src/shared/model/runs.ts';
import type { SubconsciousTrace } from '../../../src/shared/model/subconscious.ts';
import type { TurnRequest } from '../../../src/runtime/agents/turn-types.ts';
import { setup } from '../agents/fixture.ts';

const SOL = 'codex:gpt-6.1-sol';
const OPUS = 'claude:claude-opus-5-5';
const AGENT = 'ag_ada';
const ALL: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const caps = { vision: true, tools: true, structuredOutput: true };
const PRIORS = Priors.parse({
  version: 'test-b083-r',
  categories: {},
  models: [
    { match: 'gpt-6.1-sol*', name: 'GPT-6.1 Sol', tier: 'frontier', relCost: 0.3, caps, efforts: ALL, strengths: { coding: 0.8, chat: 0.4 } },
    { match: 'claude-opus-5-5*', name: 'Claude Opus 5.5', tier: 'frontier', relCost: 0.6, caps, efforts: ALL, strengths: { coding: 0.7, chat: 0.4 } },
  ],
});

/** What the routing call answers (route-turn.ts schema); an empty model and effort set nothing. */
type RoutePick = { model?: string; effort?: string; why: string };

/** A decision model answering one routing call after another; after its script it sets nothing. */
function brain(picks: RoutePick[]) {
  const prompts: string[] = [];
  const runner: StructuredRunner = async (call) => {
    prompts.push(call.prompt);
    const next = picks.shift() ?? { why: 'nothing to change' };
    const structured = { hardest: 'x', misread: false, decide: false, model: next.model ?? '', effort: next.effort ?? '', why: next.why };
    return { text: JSON.stringify(structured), structured, by: 'fake' };
  };
  return { runner, prompts };
}

/** The real router, catalog, journal, planTurn and subconscious service with a scripted decision model. */
async function world(picks: RoutePick[]) {
  const h = harness();
  h.org.add(agent(AGENT, 'Ada', { mode: 'coding' }));
  const chat = h.chats.create({ agentIds: [AGENT], createdBy: 'human' });
  const defaults = defaultSettings({ locale: 'en-US', timezone: 'UTC' });
  // No Claude Code work plan default here; economy: the person's line gets no strongest-model rule, so the return rule shows.
  const settings = { ...defaults, routing: { ...defaults.routing, work: 'gemini-cli', costMode: 'economy' as const } };
  const engines = new Map<EngineId, FakeEngine>([['codex', new FakeEngine('codex')], ['claude', new FakeEngine('claude')]]);
  engines.get('codex')!.lists.set('codex', [{ model: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', efforts: ALL }]);
  engines.get('claude')!.lists.set('claude', [{ model: 'claude-opus-5-5', name: 'Claude Opus 5.5', efforts: ALL }]);
  const accounts = new FakeAccounts(h.clock, h.bus);
  accounts.upsert(account('acc_codex', 'codex'), false);
  accounts.upsert(account('acc_claude', 'claude'), false);
  const runs = new Journal({ db: h.db, bus: h.bus, clock: h.clock });
  const modes = { coding: mode('coding'), chat: mode('chat') };
  Object.assign(h.services, {
    settings: { get: () => settings }, accounts, runs, secrets: { redact: (text: string) => text, use: async () => { throw new Error('no secret'); } },
    engines: { get: (id: EngineId) => engines.get(id)!, all: () => [...engines.values()], disposeIdle: async () => {} },
    modes: { get: (key: string) => { const found = modes[key as keyof typeof modes]; if (!found) throw new Error(`unknown mode ${key}`); return found; }, list: () => Object.values(modes) },
    prompts: new PromptTemplates(() => path.join(RESOURCES, 'prompts')),
  });
  const catalog = new Catalog({ services: () => h.services, priors: PRIORS, debounceMs: 0 });
  h.services.catalog = catalog;
  const router = new RouterImpl({ services: () => h.services });
  h.services.router = router;
  await catalog.refresh({ force: true });
  const decision = brain(picks);
  h.services.subconscious = new SubconsciousImpl({ services: () => h.services, runner: decision.runner });

  let seq = 0;
  const finish = (run: Partial<Run>) => {
    const id = `run_${++seq}`;
    runs.start({ id, agentId: AGENT, conversationId: chat.id, trigger: 'message' });
    runs.finish(id, { status: 'done', endedAt: h.clock.now(), ...run });
    h.clock.advance(60_000);
  };
  /** One turn as turn.ts runs it: plan, route, take the next step the plan read, record the run. */
  const turn = async (exclude?: string[], wake: Partial<TurnRequest> = {}): Promise<{ route: RouteDecision; temperature?: number }> => {
    const plan = await planTurn(h.services, {
      runId: `plan_${seq + 1}`, agentId: AGENT, conversationId: chat.id, reason: 'message', notes: [], ...wake,
      signal: new AbortController().signal, control: { lastSeq: 0, steeredSeq: 0 },
    });
    assert.ok(plan, 'a turn is planned');
    const route = await router.route({ ...routeRequest(plan), ...(exclude ? { exclude } : {}) });
    if (plan.nextStepAt !== undefined) takeNextRoute(h.db, AGENT, plan.nextStepAt);
    const temperature = plan.temperature !== undefined ? { temperature: plan.temperature } : {}; // as turn-finish.ts records it
    finish({ engine: route.engine, model: route.modelId, effort: route.effort, accountId: route.accountId, route: { reason: route.reason, by: route.by, category: route.category, ...temperature } });
    return { route, ...(plan.temperature !== undefined ? { temperature: plan.temperature } : {}) };
  };
  return { ...h, chat, decision, finish, turn };
}

test('the routing call sets the coming turn: planTurn of that turn runs on it, the reason names my subconscious; a routed turn after continues from it, one the call did not route goes back', async () => {
  const w = await world([{ model: 'Claude Opus 5.5', effort: 'high', why: 'a contract the customer signs' }, { effort: 'medium', why: 'going on with the checked clauses' }]);
  w.finish({ engine: 'codex', model: SOL, effort: 'low', route: { reason: 'seed', by: 'rules', category: 'coding' } });
  w.chats.send({ conversationId: w.chat.id, authorId: 'human', body: 'Bitte prüf den Vertrag für Müller, er unterschreibt morgen.' });

  const set = await w.turn();
  assert.deepEqual([set.route.modelId, set.route.effort, set.route.by, set.temperature], [OPUS, 'high', 'request', undefined]);
  assert.match(set.route.reason, /^my subconscious: a contract the customer signs · coding/);
  assert.ok(w.decision.prompts[0].includes("The main AI's coming turn: runs on GPT-6.1 Sol · effort low; start model chosen per task."), w.decision.prompts[0]);
  assert.equal(w.decision.prompts.length, 1, 'one call, no steps');

  const on = await w.turn(); // the same message is still unread: the call runs again and sets an effort only
  assert.deepEqual([on.route.modelId, on.route.effort, on.route.by], [OPUS, 'medium', 'request'], 'a routed turn continues from the run my subconscious shaped: the model I am on');
  assert.ok(w.decision.prompts.at(-1)!.includes('runs on Claude Opus 5.5 · effort high'), 'the next call reads what ran');
  assert.ok(w.decision.prompts.at(-1)!.includes("the main AI's last turn ran 1 min ago on Claude Opus 5.5 · high"), 'and what a switch costs now');

  const after = await w.turn(); // the call runs again and sets nothing
  assert.deepEqual([after.route.modelId, after.route.effort, after.route.by], [SOL, 'low', 'previous'], 'a turn the call did not route: back to where the router chose last');
});

test('a wake without anyone\'s words and without a task: no call, and it never inherits the model the call set for another message', async () => {
  const w = await world([{ model: 'Claude Opus 5.5', effort: 'high', why: 'a contract the customer signs' }]);
  w.finish({ engine: 'codex', model: SOL, effort: 'low', route: { reason: 'seed', by: 'rules', category: 'coding' } });
  w.chats.send({ conversationId: w.chat.id, authorId: 'human', body: 'Bitte prüf den Vertrag für Müller, er unterschreibt morgen.' });
  assert.equal((await w.turn()).route.modelId, OPUS);
  const quiet = w.chats.create({ agentIds: [AGENT], createdBy: 'human' }); // a timer's wake: no line in its chat, no task
  const timer = await w.turn(undefined, { conversationId: quiet.id, reason: 'schedule', notes: [{ text: 'Täglicher Blick auf die Mails.', at: w.clock.now() }] });
  assert.equal(w.decision.prompts.length, 1, 'no call');
  assert.deepEqual([timer.route.modelId, timer.route.effort, timer.route.by], [SOL, 'low', 'previous']);
  assert.doesNotMatch(timer.route.reason, /my subconscious/);
});

test('a task wake without chat lines routes on its task: its title and the wake\'s newest note', async () => {
  const w = await world([{ model: 'Claude Opus 5.5', effort: 'high', why: 'books that have to add up' }]);
  w.finish({ engine: 'codex', model: SOL, effort: 'low', route: { reason: 'seed', by: 'rules', category: 'coding' } });
  const task = w.tasks.create({ title: 'Monatsabschluss Oktober', notes: 'Belege liegen in belege/10.', assigneeKind: 'agent', assigneeId: AGENT, createdBy: 'human' });
  const routed = await w.turn(undefined, { conversationId: undefined, taskId: task.id, reason: 'review', notes: [{ text: 'Konrad hat die Buchungen geprüft, zwei fehlen noch.', at: w.clock.now() }] });
  assert.ok(w.decision.prompts[0].includes('The task that wakes the main AI:\nMonatsabschluss Oktober\nKonrad hat die Buchungen geprüft, zwei fehlen noch.'), w.decision.prompts[0]);
  assert.deepEqual([routed.route.modelId, routed.route.effort, routed.route.by], [OPUS, 'high', 'request']);
});

test('re-review 14.11.: a delegated task\'s effort-only request holds its turns on the task\'s own model – never on one the call set for other work', async () => {
  const w = await world([{ model: 'Claude Opus 5.5', effort: 'low', why: 'a receipt to take note of' }]);
  w.finish({ engine: 'codex', model: SOL, effort: 'low', route: { reason: 'seed', by: 'rules', category: 'coding' } });
  const task = w.tasks.create({ title: 'Quartalsbericht schreiben', notes: 'Zahlen aus reports/q3.md.', assigneeKind: 'agent', assigneeId: AGENT, createdBy: 'human' });
  setTaskRoute(w.db, AGENT, task.id, { effort: 'high', reason: 'given by Lead', at: w.clock.now() });
  const wake = () => w.turn(undefined, { conversationId: undefined, taskId: task.id, reason: 'task', notes: [{ text: 'Konrad hat die Zahlen geprüft.', at: w.clock.now() }] });
  const first = await wake();
  assert.deepEqual([first.route.modelId, first.route.effort], [SOL, 'high'], 'no run of the task yet: where the router chose last, at the task\'s effort');
  w.chats.send({ conversationId: w.chat.id, authorId: 'human', body: 'Danke, die Rechnung ist angekommen und abgelegt.' });
  assert.equal((await w.turn()).route.modelId, OPUS, 'the call routes the receipt');
  const next = await wake();
  assert.equal(w.decision.prompts.length, 1, 'the task request holds its turns: no call');
  assert.deepEqual([next.route.modelId, next.route.effort], [SOL, 'high'], "the task's own newest run, not the receipt's model");
});

test('a model my subconscious named that cannot run here: the turn stays on its model and says what was asked (B-083 D1); with its effort the note stays', async () => {
  const w = await world([{ model: 'Claude Opus 5.5', why: 'a contract the customer signs' }]);
  w.finish({ engine: 'codex', model: SOL, effort: 'low', route: { reason: 'seed', by: 'rules', category: 'coding' } });
  w.chats.send({ conversationId: w.chat.id, authorId: 'human', body: 'Bitte prüf den Vertrag für Müller.' });
  const failover = await w.turn([OPUS]);
  assert.deepEqual([failover.route.modelId, failover.route.by], [SOL, 'previous']);
  assert.match(failover.route.reason, /^asked for Claude Opus 5\.5 – /, 'the reason leads with what was asked and why it cannot run');
  assert.doesNotMatch(failover.route.reason, /my subconscious/);

  const hard = await world([{ model: 'Claude Opus 5.5', effort: 'high', why: 'a contract the customer signs' }]);
  hard.finish({ engine: 'codex', model: SOL, effort: 'low', route: { reason: 'seed', by: 'rules', category: 'coding' } });
  hard.chats.send({ conversationId: hard.chat.id, authorId: 'human', body: 'Bitte prüf den Vertrag für Müller.' });
  const kept = await hard.turn([OPUS]);
  assert.deepEqual([kept.route.modelId, kept.route.effort, kept.route.by], [SOL, 'high', 'request']);
  assert.match(kept.route.reason, /my subconscious: a contract the customer signs$/, 'the effort it set runs');
});

test('an effort alone: the model stays, the reason names my subconscious', async () => {
  const w = await world([{ effort: 'max', why: 'one right answer, hard to hit' }]);
  w.finish({ engine: 'codex', model: SOL, effort: 'low', route: { reason: 'seed', by: 'rules', category: 'coding' } });
  w.chats.send({ conversationId: w.chat.id, authorId: 'human', body: 'Find the race condition in the scheduler.' });
  const harder = await w.turn();
  assert.deepEqual([harder.route.modelId, harder.route.effort, harder.route.by], [SOL, 'max', 'request']);
  assert.match(harder.route.reason, /my subconscious: one right answer, hard to hit$/);
  assert.doesNotMatch(harder.route.reason, /effort requested by the agent/);
});

test('a request read that fails after the look gives the trace it took back to the thread', async () => {
  const h = setup();
  const trace: SubconsciousTrace = { calls: [{ tool: 'agent.tell', args: {}, output: 'Eine Notiz.' }] };
  const back: Array<[string, string, SubconsciousTrace]> = [];
  h.services.subconscious.beforeTurn = async () => trace;
  h.services.subconscious.putBack = (agentId, thread, given) => { back.push([agentId, thread, given]); };
  Object.assign(h.services.runs, { list: () => { throw new Error('runs gone'); } });
  h.chats.send({ conversationId: h.chat.id, authorId: 'human', body: 'Wie heißt unser Steuerberater?' });
  await assert.rejects(planTurn(h.services, h.request()), /runs gone/);
  assert.deepEqual(back, [[h.tom.id, 'main', trace]]);
});

test('the line about the coming turn: my last model (any chat), the start model and who set it, the person\'s suggestion', () => {
  const h = harness();
  h.org.add(agent(AGENT, 'Ada'));
  const chat = h.chats.create({ agentIds: [AGENT], createdBy: 'human' });
  h.chats.update(chat.id, { settings: { modelHints: { [AGENT]: OPUS }, efforts: { [AGENT]: 'high' }, temperatures: { [AGENT]: 0.3 } } }, 'human');
  const runs: Array<Partial<Run>> = [
    { agentId: AGENT, conversationId: chat.id, model: OPUS, effort: 'medium', splitId: 'sp_1' },
    { agentId: AGENT, conversationId: 'ch_other', model: SOL, effort: 'low', route: { reason: 'x', by: 'rules', category: 'chat', temperature: 0.4, temperatureSent: false } },
    { agentId: AGENT, conversationId: chat.id, model: OPUS, effort: 'max' },
  ]; // newest first; one context: my last own turn, from any chat (a part's aside)
  const models = new Map<string, ModelInfo>([[SOL, model(SOL, 'frontier', 'GPT-6.1 Sol')], [OPUS, model(OPUS, 'frontier', 'Claude Opus 5.5')]]);
  Object.assign(h.services, {
    runs: { list: () => runs }, catalog: { get: (id: string) => models.get(id), list: () => [...models.values()] },
    settings: { get: () => ({ profile: { name: 'Stanislaus', timezone: 'Europe/Berlin' } }) },
  });
  const ada = agent(AGENT, 'Ada', { modelPolicy: { pin: OPUS, pinBy: { name: 'Stanislaus', at: Date.UTC(2026, 10, 8, 12) } } });
  assert.equal(turnFacts(h.services, ada, chat.id),
    "The main AI's coming turn: runs on GPT-6.1 Sol · effort low · temperature 0.4; start model Claude Opus 5.5 (set by Stanislaus, 2026-11-08); Stanislaus suggests Claude Opus 5.5 · effort high · temperature 0.3 in this chat – what they think fits now; it runs when I set it.");
  const self = agent(AGENT, 'Ada', { modelPolicy: { pin: SOL, pinBy: { name: 'Ada', at: Date.UTC(2026, 10, 7, 9), self: true } } });
  assert.match(turnFacts(h.services, self, chat.id), /start model GPT-6\.1 Sol \(set by itself, 2026-11-07\); /);
  const fixed = agent(AGENT, 'Ada', { modelPolicy: { pin: OPUS, effort: 'high', pinBy: { name: 'Stanislaus', at: Date.UTC(2026, 10, 8, 12) } } });
  assert.match(turnFacts(h.services, fixed, chat.id), /; start model Claude Opus 5\.5 · effort high \(set by Stanislaus, 2026-11-08\); /, 'the start model with its fixed effort');
  const fresh = h.chats.create({ agentIds: [AGENT], createdBy: 'human' });
  assert.match(turnFacts(h.services, agent(AGENT, 'Ada'), fresh.id), /^The main AI's coming turn: runs on GPT-6\.1 Sol · effort low · temperature 0\.4; start model chosen per task\.$/, 'one context: a fresh chat continues on my last turn');
});
