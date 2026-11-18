// RT5: a turn on another model than my last one says why – B-083: "<Agent> → <model> · <effort> – <first reason>" (at most 120
// characters): the agent's own model.set request ("requested by me", RT2), its start model, its kind's default after a
// stand-in, and a failover (limit or outage of the model before; the same model on another account names no account); the agent reads the same
// line in its delta. 17.11.2026 (the model settles): such a turn is rare now, so each one gets its line; an effort alone gets one
// when somebody asked for it. Judged against my last done turn; a first turn is none.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnExecutor } from '../../../src/runtime/agents/turn.ts';
import { STATUS_MAX, capText, failoverText, firstReason, switchText, switchWhy } from '../../../src/runtime/agents/switch-line.ts';
import { setNextRoute } from '../../../src/runtime/agents/next-route.ts';
import { renderMessages } from '../../../src/runtime/context/render.ts';
import type { RouteRequest } from '../../../src/runtime/contracts.ts';
import type { EngineTurnResult } from '../../../src/runtime/engines/types.ts';
import type { ModelInfo, RouteDecision } from '../../../src/shared/model/providers.ts';
import { account, agent, mode, standardSetup } from '../models/harness.ts';
import { setup } from './fixture.ts';

const LIMIT: EngineTurnResult = { text: '', stop: 'limit', error: { code: 'rate_limited', message: 'The usage limit of this account was reached.' } };
const OUTAGE: EngineTurnResult = { text: '', stop: 'error', error: { code: 'unavailable', message: 'The provider is overloaded. Retry later.' } };

/** The turn fixture with catalog entries and accounts of the routing harness, and a scripted router. */
async function switchSetup(route: (request: RouteRequest) => RouteDecision) {
  const routing = await standardSetup();
  const h = setup();
  const known = new Map<string, ModelInfo>(routing.catalog.list().map((model) => [model.id, model]));
  const accounts = new Map([h.account, account('acc_codex', 'codex'), account('acc_claude_2', 'claude', { label: 'hello@example.com' })].map((item) => [item.id, item]));
  Object.assign(h.services, {
    router: { route: async (request: RouteRequest) => route(request) },
    catalog: { get: (id: string) => known.get(id) },
    accounts: { get: (id: string) => accounts.get(id), updateLimits: () => {}, markLimited: () => true, markUnavailable: () => false },
  });
  const lines = () => h.chats.messages(h.chat.id).filter((message) => message.meta.status?.type === 'model_switched');
  const agentSees = () => renderMessages({ services: h.services, agentId: h.tom.id, humanName: 'Sam', zone: 'UTC', now: Date.now() }, h.chats.messages(h.chat.id), { images: false }).lines;
  return { h, routing, lines, agentSees, run: (runId = 'run_1') => new TurnExecutor(() => h.services).execute(h.request({ runId })) };
}

test('back from a stand-in where the context starts anew: the router says why it leaves the stand-in, and the chat gets that line', async () => {
  // Opus stood in while Sol could not run; at the boundary my kind decides again (review 2, 17.11.2026: the test pinned the
  // removed rule that a model weak for this turn's work moves at a boundary – fits is the kind's tier alone now)
  const routing = await standardSetup();
  const decision = await routing.router.route({ agent: agent('ag_1'), mode: mode('chat'), previous: { modelId: 'claude:claude-opus-5-5', effort: 'medium', standIn: true } });
  assert.equal(decision.modelId, 'codex:gpt-6.1-sol');
  assert.match(decision.reason, /^executing runs on the frontier tier's first choice · /, 'the router puts the switch reason first');

  const s = await switchSetup(() => ({ ...decision, accountId: 'acc_codex' }));
  s.h.runs.push({ id: 'run_0', agentId: s.h.tom.id, conversationId: s.h.chat.id, model: 'claude:claude-opus-5-5', effort: 'medium', status: 'done' });
  const outcome = await s.run();
  assert.equal(outcome.status, 'done');

  // On the code before 17.11.2026 a switch routing made left no line.
  const line = "Tom → GPT-6.1 Sol · medium – executing runs on the frontier tier's first choice";
  assert.deepEqual(s.lines().map((item) => item.body), [line]);
  assert.ok(s.agentSees().some((seen) => seen.includes(line)), 'the agent reads why it runs elsewhere');
});

test("a start model the person set since my last turn: the turn that moves onto it gets the line, the turns on it after that none", async () => {
  const OPUS = 'claude:claude-opus-5-5';
  const pin: RouteDecision = { modelId: OPUS, engine: 'claude', accountId: 'acc_claude', effort: 'high', category: 'chat', reason: 'my start model · chat', by: 'pin', alternatives: [] };
  const s = await switchSetup(() => pin);
  s.h.org.add({ ...s.h.tom, modelPolicy: { pin: OPUS, pinBy: { name: 'Sam', at: 2_000 } } });
  s.h.runs.push({ id: 'run_0', agentId: s.h.tom.id, conversationId: s.h.chat.id, model: 'codex:gpt-6.1-sol', effort: 'medium', status: 'done', startedAt: 1_000 });
  await s.run('run_1');
  const [line] = s.lines();
  assert.equal(line?.body, 'Tom → Claude Opus 5.5 · high – my start model');
  assert.equal(line?.silent, true, 'still a quiet line');
  assert.deepEqual(line?.meta.status?.details, { from: 'codex:gpt-6.1-sol', to: OPUS, effort: 'high', reason: pin.reason, by: 'pin' });
  assert.ok(s.agentSees().some((seen) => seen.endsWith(`] · ${line?.body}`)), 'the agent sees the same text in its delta');

  // The next turn on it: nothing changed, nothing to say.
  s.h.runs.unshift({ id: 'run_1', agentId: s.h.tom.id, conversationId: s.h.chat.id, model: OPUS, effort: 'high', status: 'done', startedAt: 3_000 });
  await s.run('run_2');
  assert.equal(s.lines().length, 1);
});

test('failover: the line names the model that hit its limit or is unavailable, never an account label', async () => {
  const sol: RouteDecision = { modelId: 'codex:gpt-6.1-sol', engine: 'codex', accountId: 'acc_codex', effort: 'medium', category: 'coding', reason: 'coding · strongest fit', by: 'rules', alternatives: [] };
  const opus: RouteDecision = { ...sol, modelId: 'claude:claude-opus-5-5', engine: 'claude', accountId: 'acc_claude', effort: 'high' };
  for (const [result, why] of [[LIMIT, 'GPT-6.1 Sol hit its usage limit'], [OUTAGE, 'GPT-6.1 Sol is unavailable right now']] as const) {
    const s = await switchSetup((request) => (request.exclude?.includes('acc_codex') ? opus : sol));
    s.h.state.script = async (input) => (input.account.id === 'acc_codex' ? result : { text: 'Done.', stop: 'done' });
    const outcome = await s.run();
    assert.equal(outcome.status, 'done', why);
    const lines = s.lines();
    assert.equal(lines.length, 1, why);
    assert.equal(lines[0].body, `Tom → Claude Opus 5.5 · high – ${why}`);
    assert.equal((lines[0].meta.status?.details as { reason: string }).reason, result === LIMIT ? 'limit' : 'unavailable');
    assert.match(lines[0].body, /limit|unavailable/);
  }

  // The same model on a second plan: "another account", no label (it may hold an e-mail address).
  const first: RouteDecision = { ...opus, accountId: 'acc_claude', effort: 'medium' };
  const s = await switchSetup((request) => (request.exclude?.includes('acc_claude') ? { ...first, accountId: 'acc_claude_2' } : first));
  s.h.state.script = async (input) => (input.account.id === 'acc_claude' ? LIMIT : { text: 'Done.', stop: 'done' });
  await s.run();
  const [line] = s.lines();
  assert.equal(line.body, 'Tom → another account · Claude Opus 5.5 · medium – the first one hit its usage limit');
  assert.ok(!line.body.includes('hello@example.com'));
});

test('first reason: the switch note or pin wins; a bare category joins what follows; empty adds nothing', () => {
  assert.equal(firstReason('GPT-6.1 Sol is weak at video animation · video animation · strongest fit', 'video-animation'), 'GPT-6.1 Sol is weak at video animation');
  assert.equal(firstReason('suggested in this chat · coding', 'coding'), 'suggested in this chat');
  assert.equal(firstReason('coding · strongest fit', 'coding'), 'strongest fit for coding');
  assert.equal(firstReason('video animation', 'video-animation'), 'for video animation');
  assert.equal(firstReason('pinned model unavailable · chat · best fit', 'chat'), 'pinned model unavailable');
  assert.equal(firstReason('requested by the agent · coding', 'coding'), 'requested by me', 'B-083: the agent\'s own request in its own voice');
  assert.equal(firstReason('', 'chat'), undefined);
  assert.equal(switchText('Tom', { modelName: 'Claude Opus 5.5', effort: 'high' }), 'Tom → Claude Opus 5.5 · high');
  assert.equal(failoverText('Tom', { modelName: 'Claude Opus 5.5', effort: 'high' }, { failedName: 'GPT-6.1 Sol', sameModel: false, limited: false }),
    'Tom → Claude Opus 5.5 · high – GPT-6.1 Sol is unavailable right now');
});

test('the text is capped at 120 characters at a word boundary', () => {
  const long = switchText('Tom', { modelName: 'Claude Opus 5.5', effort: 'high' }, `GPT-6.1 Sol is weak at ${'very long category words '.repeat(8)}`);
  assert.ok(long.length <= STATUS_MAX, `${long.length} characters`);
  assert.ok(long.endsWith('…'));
  assert.ok(long.startsWith('Tom → Claude Opus 5.5 · high – GPT-6.1 Sol is weak at very long'));
  assert.ok(!/\s…$/.test(long), 'no space before the ellipsis');
  const name = 'x'.repeat(200);
  assert.equal(switchText('Tom', { modelName: name, effort: 'low' }).length, STATUS_MAX, 'one unbroken word is cut hard');
  assert.equal(capText('  short   text '), 'short text');
});

test('RT2: the agent\'s own effort request gets a line, the return to the choice before it none', async () => {
  const routing = await standardSetup();
  const OPUS = 'claude:claude-opus-5-5';
  const video = mode('video-animation', { minTier: 'strong' });
  const route = (previous: RouteRequest['previous']) => routing.router.route({ agent: agent('ag_1'), mode: video, previous });
  const kept = await route({ modelId: OPUS, effort: 'high', category: 'video-animation' });
  const asked = await route({ modelId: OPUS, effort: 'max', explicit: true, asked: 'effort', category: 'video-animation' });
  assert.deepEqual([kept.modelId, kept.effort, kept.by], [OPUS, 'high', 'previous']);
  assert.deepEqual([asked.modelId, asked.effort, asked.by], [OPUS, 'max', 'request']);

  let next = asked;
  const s = await switchSetup(() => ({ ...next, accountId: 'acc_claude' }));
  const ran = (id: string, decision: RouteDecision) => s.h.runs.unshift({
    id, agentId: s.h.tom.id, conversationId: s.h.chat.id, model: decision.modelId, effort: decision.effort, status: 'done',
    route: { reason: decision.reason, by: decision.by, category: decision.category },
  });
  ran('run_0', kept);
  setNextRoute(s.h.services.db, s.h.tom.id, { effort: 'max', reason: 'tricky timing', at: 1 });
  await s.run('run_1');
  const [lifted] = s.lines();
  assert.equal(lifted.body, 'Tom → Claude Opus 5.5 · max – effort requested by me');
  assert.deepEqual(lifted.meta.status?.details, { from: OPUS, to: OPUS, effort: 'max', reason: asked.reason, by: 'request' });

  // The turn after the requested one returns to high: routing's switch, the live bar shows it.
  ran('run_1', asked);
  next = kept;
  await s.run('run_2');
  assert.equal(s.lines().length, 1);
  ran('run_2', kept);
  await s.run('run_3');
  assert.equal(s.lines().length, 1, 'no switch, no line');
});

test('RT2: a request for another model says so; a first turn in a chat is no switch, also not a requested one', async () => {
  const routing = await standardSetup();
  const SOL = 'codex:gpt-6.1-sol';
  const asked = await routing.router.route({ agent: agent('ag_1'), mode: mode('video-animation'), previous: { modelId: SOL, effort: 'medium', explicit: true, asked: 'model' } });
  assert.deepEqual([asked.modelId, asked.by], [SOL, 'request']);
  const s = await switchSetup(() => ({ ...asked, accountId: 'acc_codex' }));
  setNextRoute(s.h.services.db, s.h.tom.id, { effort: 'max', at: 1 });
  await s.run('run_1');
  assert.equal(s.lines().length, 0, 'nothing ran in this chat before');

  s.h.runs.unshift({ id: 'run_1', agentId: s.h.tom.id, conversationId: s.h.chat.id, model: 'claude:claude-opus-5-5', effort: 'high', status: 'done', route: { reason: 'video animation · strongest fit', by: 'rules', category: 'video-animation' } });
  setNextRoute(s.h.services.db, s.h.tom.id, { modelId: SOL, at: 2 });
  await s.run('run_2');
  assert.equal(s.lines()[0]?.body, `Tom → GPT-6.1 Sol · ${asked.effort} – requested by me`);
});

test('switch why: an effort-only request names it, else the first reason', () => {
  const base: RouteDecision = { modelId: 'm1', engine: 'claude', accountId: 'a', effort: 'max', category: 'coding', reason: 'continues on my model · coding · effort requested by the agent', by: 'request' as RouteDecision['by'], alternatives: [] };
  assert.equal(switchWhy(base, { modelId: 'm1' }), 'effort requested by me');
  assert.equal(switchWhy(base, { modelId: 'm0' }), 'continues on my model', 'another model: the reason for the model');
  assert.equal(switchWhy({ ...base, reason: 'my start model · coding · my subconscious: a decision ahead' }, { modelId: 'm0' }), 'my start model', 'a new start model, my subconscious set its effort');
});
