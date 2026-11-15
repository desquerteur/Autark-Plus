// The quiet switch line (route-line.ts, 14.11.2026): a line only for a switch someone asked for – my own request (model.set or my
// task's), my own temperature, a start model set since the chat's last turn began. A switch routing made – my subconscious's call,
// the router's rules, the return after a request – leaves none (the live bar shows model · effort, the run's route says why).
// B-083: every line names the agent and says where a temperature comes from.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeLine, type SwitchFrom } from '../../../src/runtime/agents/route-line.ts';
import { BY_REQUEST } from '../../../src/runtime/routing/previous.ts';
import type { RouteDecision } from '../../../src/shared/model/providers.ts';

const route = (patch: Partial<RouteDecision>): RouteDecision => ({
  modelId: 'codex:gpt-6.1-sol', engine: 'codex', accountId: 'acc', effort: 'medium', category: 'chat', reason: 'chat · best fit', by: 'rules', alternatives: [], ...patch,
});
const of = { agent: 'Mara' };
const from: SwitchFrom = { modelId: 'codex:gpt-6.1-sol', effort: 'medium', at: 1_000 };
const text = (patch: Partial<RouteDecision>, last: SwitchFrom = from, line: Parameters<typeof routeLine>[3] = of, name = 'GPT-6.1 Sol') =>
  routeLine(route(patch), name, last, line)?.text;

test('a switch routing made leaves no line: the router\'s rules, the previous model, a first turn', () => {
  assert.equal(text({ effort: 'high' }), undefined, 'the rules raised the effort');
  assert.equal(text({ modelId: 'claude:claude-opus-5-5', reason: 'GPT-6.1 Sol is weak at video animation · video animation · strongest fit' }, from, of, 'Claude Opus 5.5'), undefined);
  assert.equal(text({ effort: 'high', reason: 'continues on the previous model · chat', by: 'previous' }), undefined, 'the return after a request');
  assert.equal(routeLine(route({ by: BY_REQUEST, effort: 'max', reason: 'requested by the agent · chat' }), 'GPT-6.1 Sol', undefined, of), undefined, 'a first turn in the chat is no switch');
  assert.equal(text({}), undefined, 'no switch');
});

test('my subconscious\'s switch leaves no line – another model, or only its effort on the start model', () => {
  const mine = 'my subconscious: a hard proof';
  assert.equal(text({ modelId: 'claude:claude-opus-5-5', reason: `${mine} · chat`, by: BY_REQUEST }, from, of, 'Claude Opus 5.5'), undefined);
  assert.equal(text({ effort: 'high', reason: `my start model · chat · ${mine}`, by: BY_REQUEST }), undefined);
  assert.equal(text({ effort: 'low', reason: `continues on the previous model · chat · ${mine}`, by: BY_REQUEST }, from, { agent: 'Mara', pinAt: 5 }), undefined, 'a start model set before the last turn is no news');
});

test('my own request gets the line: another model, or only its effort', () => {
  assert.equal(text({ modelId: 'claude:claude-opus-5-5', reason: 'requested by the agent · chat', by: BY_REQUEST }, from, of, 'Claude Opus 5.5'), 'Mara → Claude Opus 5.5 · medium – requested by me');
  assert.equal(text({ effort: 'max', reason: 'continues on the previous model · chat · effort requested by the agent', by: BY_REQUEST }), 'Mara → GPT-6.1 Sol · max – effort requested by me');
  const line = routeLine(route({ effort: 'max', reason: 'requested by the agent · chat', by: BY_REQUEST }), 'GPT-6.1 Sol', from, of);
  assert.deepEqual(line?.details, { from: from.modelId, to: 'codex:gpt-6.1-sol', effort: 'max', reason: 'requested by the agent · chat', by: BY_REQUEST });
});

test('a start model set since the chat\'s last turn began gets the line – also with my subconscious\'s effort on it', () => {
  const opus = { modelId: 'claude:claude-opus-5-5', effort: 'high' as const };
  const since = { agent: 'Mara', pinAt: 2_000 };
  assert.equal(text({ ...opus, reason: 'my start model · chat', by: 'pin' }, from, since, 'Claude Opus 5.5'), 'Mara → Claude Opus 5.5 · high – my start model');
  assert.equal(text({ ...opus, reason: 'my start model · chat · my subconscious: a decision ahead', by: BY_REQUEST }, from, since, 'Claude Opus 5.5'), 'Mara → Claude Opus 5.5 · high – my start model');
  assert.equal(text({ ...opus, reason: 'my start model · chat', by: 'pin' }, from, { agent: 'Mara', pinAt: 500 }, 'Claude Opus 5.5'), undefined, 'set before the last turn: back on it is routing\'s');
  assert.equal(text({ ...opus, reason: 'my start model · chat', by: 'pin' }, { ...from, at: undefined }, since, 'Claude Opus 5.5'), undefined, 'no time of the last turn: no news to tell');
  assert.equal(text({ ...opus, reason: 'chat · strongest fit', by: 'rules' }, from, since, 'Claude Opus 5.5'), undefined, 'a turn that does not run on the start model');
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
