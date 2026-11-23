// B-083, owner 09.11. ("Es ist unbedingt wichtig. Ohne das funktioniert das nicht gut. Mach das bitte nicht."): Claude Code
// keeps its thinking, so a turn with a temperature changes nothing in its process env – no MAX_THINKING_TOKENS, no
// temperature in CLAUDE_CODE_EXTRA_BODY, no other small model – on every model, the 4.6 ones that would sample without
// thinking too (live 09.11.2026: with thinking on Claude answers any value but 1 with 400). An extra body already in the
// account's env passes as it is, and a temperature never holds back a switch inside the turn.
// Owns: these assertions only. Never: a real Claude Code binary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnInput } from './fakes.ts';
import { BASE_ENV, claudeAccount, claudeSetup, until } from './claude-fixture.ts';
import { takesTemperature } from '../../../src/runtime/engines/http/temperature.ts';

const assistant = (text: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const input = (patch: Record<string, unknown> = {}) => turnInput({ account: claudeAccount(), ...patch });
const envOf = async (patch: Record<string, unknown>) => {
  const h = claudeSetup();
  assert.equal((await h.engine.run(input(patch).input)).stop, 'done');
  return h.cli.of('turn')[0]!.options.env ?? {};
};

test('a turn with a temperature keeps thinking on every model: nothing about sampling in its env', async () => {
  for (const patch of [{ model: 'claude-sonnet-4-6', temperature: 0.3 }, { model: 'claude-haiku-4-5', temperature: 0 }, { model: 'claude-opus-4-6', temperature: 0.2, tools: [] },
    { model: 'claude-opus-5-5', temperature: 0.3 }, { model: 'claude-fable-5-1', temperature: 0.7 }, { model: 'claude-sonnet-4-6' }]) {
    const env = await envOf(patch);
    assert.equal(env.MAX_THINKING_TOKENS, undefined, JSON.stringify(patch));
    assert.equal(env.CLAUDE_CODE_EXTRA_BODY, undefined, JSON.stringify(patch));
    assert.equal(env.ANTHROPIC_SMALL_FAST_MODEL, undefined, JSON.stringify(patch));
  }
  for (const model of ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5', 'claude-opus-5-5']) assert.equal(takesTemperature('claude', model, 'low'), false, model);
});

test('an extra body already in the account env passes as it is, with or without a temperature', async () => {
  BASE_ENV.CLAUDE_CODE_EXTRA_BODY = '{"metadata":{"user_id":"x"}}';
  try {
    assert.equal((await envOf({ model: 'claude-sonnet-4-6', temperature: 0.3 })).CLAUDE_CODE_EXTRA_BODY, BASE_ENV.CLAUDE_CODE_EXTRA_BODY);
    assert.equal((await envOf({ model: 'claude-opus-5-5' })).CLAUDE_CODE_EXTRA_BODY, BASE_ENV.CLAUDE_CODE_EXTRA_BODY);
  } finally {
    delete BASE_ENV.CLAUDE_CODE_EXTRA_BODY;
  }
});

test('setModel: a temperature never holds back a switch inside the turn', async () => {
  const h = claudeSetup({ exit: false, turn: () => [assistant('Working')] });
  const t = input({ model: 'claude-sonnet-4-6', temperature: 0.3 });
  const running = h.engine.run(t.input);
  await until(() => t.events.some((event: any) => event.type === 'text'));
  const call = h.cli.of('turn')[0]!;
  assert.equal(await h.engine.setModel('run_1', 'claude-opus-5-5', 'medium'), true);
  await until(() => call.child.lines.some((line: any) => line?.request?.subtype === 'set_model'));
  call.child.send({ type: 'result', subtype: 'success', is_error: false, result: 'Working', session_id: call.args[call.args.indexOf('--session-id') + 1] });
  await running;
  call.child.exit(0);
});
