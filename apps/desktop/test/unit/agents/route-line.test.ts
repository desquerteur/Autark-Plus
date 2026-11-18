// The quiet switch line (route-line.ts). 17.11.2026 – the model settles: a turn on another model than my last one is rare and
// gets its line with the route's own why (my request, my start model, my kind's default, a model that cannot run, a successor).
// An effort alone gets a line when somebody asked for it – my own request, my task's from its giver, the fixed effort of a start
// model set since my last turn began – and for my own temperature. The effort my subconscious sets and the lift of a person's line
// leave none (the live bar shows model · effort, the run's route says why).
// B-083: every line names the agent and says where a temperature comes from.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeLine, type SwitchFrom } from '../../../src/runtime/agents/route-line.ts';
import { BY_REQUEST } from '../../../src/runtime/routing/previous.ts';
import type { RouteDecision } from '../../../src/shared/model/providers.ts';

const route = (patch: Partial<RouteDecision>): RouteDecision => ({
  modelId: 'codex:gpt-6.1-sol', engine: 'codex', accountId: 'acc', effort: 'medium', category: 'chat', reason: 'continues on my model · chat', by: 'previous', alternatives: [], ...patch,
});
const of = { agent: 'Mara' };
const from: SwitchFrom = { modelId: 'codex:gpt-6.1-sol', effort: 'medium', at: 1_000 };
const text = (patch: Partial<RouteDecision>, last: SwitchFrom = from, line: Parameters<typeof routeLine>[3] = of, name = 'GPT-6.1 Sol') =>
  routeLine(route(patch), name, last, line)?.text;

test('no line: the model I am on at an effort nobody asked for – my settled one, the rules\', a person\'s line – and a first turn', () => {
  assert.equal(text({ effort: 'high' }), undefined, 'the rules raised the effort');
  assert.equal(text({ effort: 'high', reason: "continues on my model · chat · a person's line · effort at least high" }), undefined, 'the lift of a person\'s line');
  assert.equal(text({ effort: 'low' }), undefined, 'back at my settled effort after a request');
  assert.equal(routeLine(route({ by: BY_REQUEST, effort: 'max', reason: 'requested by the agent · chat' }), 'GPT-6.1 Sol', undefined, of), undefined, 'a first turn is no switch');
  assert.equal(text({}), undefined, 'no switch');
});

test('17.11.2026: a turn on another model than my last one gets its line – with the route\'s own why in plain words', () => {
  const sonnet = { modelId: 'claude:claude-sonnet-5-5' };
  // On the code before 17.11.2026 a switch routing made left no line: there were 177 of them in 1,474 runs.
  assert.equal(text({ ...sonnet, reason: "executing runs on the strong tier's best value · chat", by: 'rules' }, from, of, 'Claude Sonnet 5.5'),
    "Mara → Claude Sonnet 5.5 · medium – executing runs on the strong tier's best value");
  assert.equal(text({ modelId: 'claude:claude-opus-5-5', reason: "GPT-6.1 Sol is weak at video animation · leading runs on the frontier tier's first choice · video animation", by: 'rules' }, from, of, 'Claude Opus 5.5'),
    'Mara → Claude Opus 5.5 · medium – GPT-6.1 Sol is weak at video animation');
  const out = text({ ...sonnet, reason: "GPT-6.1 Sol cannot run now – no account of it can run now (limited until 20 Oct 09:00) · executing runs on the strong tier's best value · chat", by: 'rules' }, from, of, 'Claude Sonnet 5.5');
  assert.match(out ?? '', /^Mara → Claude Sonnet 5\.5 · medium – GPT-6\.1 Sol cannot run now – no account of it can run now/);
  assert.ok(out!.length <= 120, String(out!.length));
  assert.equal(text({ modelId: 'claude:claude-fable-5-2', reason: 'Claude Fable 5.2 replaces Claude Fable 5.1 · chat' }, { ...from, modelId: 'claude:claude-fable-5-1' }, of, 'Claude Fable 5.2'),
    'Mara → Claude Fable 5.2 · medium – Claude Fable 5.2 replaces Claude Fable 5.1');
  assert.equal(text({ modelId: 'claude:claude-opus-5-5', effort: 'high', reason: 'my start model · chat', by: 'pin' }, from, { agent: 'Mara', pinAt: 500 }, 'Claude Opus 5.5'),
    'Mara → Claude Opus 5.5 · high – my start model', 'whenever it was set: the turn that moves onto it says so');
});

test('my subconscious\'s effort leaves no line – on the model I am on or on my start model', () => {
  const mine = 'my subconscious: a hard proof';
  assert.equal(text({ effort: 'high', reason: `continues on my model · chat · ${mine}`, by: BY_REQUEST }), undefined);
  assert.equal(text({ effort: 'high', reason: `my start model · chat · ${mine}`, by: BY_REQUEST }), undefined);
  assert.equal(text({ effort: 'low', reason: `continues on my model · chat · ${mine}`, by: BY_REQUEST }, from, { agent: 'Mara', pinAt: 5 }), undefined, 'a start model set before the last turn is no news');
});

test('an effort somebody asked for gets the line and names whose it is – mine or my task\'s; a model I asked for too', () => {
  assert.equal(text({ modelId: 'claude:claude-opus-5-5', reason: 'requested by the agent · chat', by: BY_REQUEST }, from, of, 'Claude Opus 5.5'), 'Mara → Claude Opus 5.5 · medium – requested by me');
  assert.equal(text({ effort: 'max', reason: 'continues on my model · chat · effort requested by the agent', by: BY_REQUEST }), 'Mara → GPT-6.1 Sol · max – effort requested by me');
  // On the code before 17.11.2026 a task's effort read "effort requested by me".
  assert.equal(text({ effort: 'high', reason: 'continues on my model · chat · effort from my task (given by Clara)', by: BY_REQUEST }), 'Mara → GPT-6.1 Sol · high – effort from my task (given by Clara)');
  const line = routeLine(route({ effort: 'max', reason: 'requested by the agent · chat', by: BY_REQUEST }), 'GPT-6.1 Sol', from, of);
  assert.deepEqual(line?.details, { from: from.modelId, to: 'codex:gpt-6.1-sol', effort: 'max', reason: 'requested by the agent · chat', by: BY_REQUEST });
});

test('the fixed effort of a start model set since my last turn began gets the line – also with my subconscious\'s why beside it', () => {
  const since = { agent: 'Mara', pinAt: 2_000 };
  assert.equal(text({ effort: 'high', reason: 'my start model · chat', by: 'pin' }, from, since), 'Mara → GPT-6.1 Sol · high – my start model');
  assert.equal(text({ effort: 'high', reason: 'my start model · chat · my subconscious: a decision ahead', by: BY_REQUEST }, from, since), 'Mara → GPT-6.1 Sol · high – my start model');
  assert.equal(text({ effort: 'high', reason: 'my start model · chat', by: 'pin' }, from, { agent: 'Mara', pinAt: 500 }), undefined, 'set before the last turn: no news');
  assert.equal(text({ effort: 'high', reason: 'my start model · chat', by: 'pin' }, { ...from, at: undefined }, since), undefined, 'no time of the last turn: no news to tell');
});

test('B-083: my own temperature is part of what runs – a change of it alone gets the line; its end is routing\'s', () => {
  const own = { agent: 'Mara', sent: true, ownTemperature: true };
  assert.equal(text({ temperature: 0.7 }, from, own), 'Mara → GPT-6.1 Sol · medium · temperature 0.7 – requested by me', 'my own request, sent');
  assert.equal(text({ temperature: 0.3 }, from, { agent: 'Mara', ownTemperature: true }), 'Mara → GPT-6.1 Sol · medium · temperature 0.3 (stance) – requested by me', 'the model keeps its own setting');
  assert.equal(text({ temperature: 0.3 }, { ...from, temperature: 0.3 }, own), undefined, 'the same temperature again: no line');
  assert.equal(text({}, { ...from, temperature: 0.7 }), undefined, 'the request is used up: the live bar shows it');
  assert.equal(text({ effort: 'high', temperature: 0.3 }, from, own), 'Mara → GPT-6.1 Sol · high · temperature 0.3 – requested by me', 'with an effort the rules set, the temperature is what I asked for');
  const line = routeLine(route({ temperature: 0.3 }), 'GPT-6.1 Sol', from, own);
  assert.deepEqual([line?.details.temperature, line?.details.temperatureSent], [0.3, true]);
});
