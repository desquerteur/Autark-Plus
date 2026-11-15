// B-080 – Claude Code engine (engines/claude/engine.ts, stream.ts): the CLI's own background work stays part of the turn
// (a result while a background task runs ends nothing and the input stays open; the result after its notification ends
// the turn with both texts; an ambient or awaited task is none, task_updated moves one in or out, an error result ends the
// turn at once); setModel writes the set_model control request into the running CLI (another effort is
// false; the CLI's error answer puts the turn back on the model before); a fresh session is announced at system/init.
// Owns: these assertions only. Never: a real Claude Code binary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnInput } from './fakes.ts';
import { claudeAccount, claudeSetup, until } from './claude-fixture.ts';
import { ClaudeStreamParser } from '../../../src/runtime/engines/claude/stream.ts';

const assistant = (text: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const result = (session: string, text: string) => ({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: session });
const input = (patch: Record<string, unknown> = {}) => turnInput({ model: 'claude-opus-5-5', account: claudeAccount(), ...patch });
const sessionOf = (args: string[]) => args[args.indexOf('--session-id') + 1];

test('claude: a background task keeps the turn open past its first result; the result after its notification ends it with both texts', async () => {
  const h = claudeSetup({ exit: false, turn: (_call, session) => [
    { type: 'system', subtype: 'task_started', task_id: 'bash_1', is_backgrounded: true, description: 'sleep 30 && echo DONE' },
    assistant('Der Test läuft im Hintergrund.'),
    result(session, 'Der Test läuft im Hintergrund.'),
  ] });
  const t = input();
  let ended = false;
  const running = h.engine.run(t.input).then((value) => { ended = true; return value; });
  await until(() => t.events.some((event: any) => event.type === 'background'));
  const call = h.cli.of('turn')[0];
  await until(() => false, 20);
  assert.equal(ended, false, 'the first result ends nothing while the task runs');
  assert.equal(call.child.stdin.writableEnded, false, 'its input stays open');
  assert.equal(await h.engine.steer('run_1', 'Und wie läufts?'), true, 'a line still goes in');
  call.child.send({ type: 'system', subtype: 'task_notification', task_id: 'bash_1', status: 'completed', output_file: '', summary: 'DONE' });
  call.child.send(assistant('DONE – der Test ist durch.'));
  call.child.send(result(sessionOf(call.args), 'DONE – der Test ist durch.'));
  const done = await running;
  assert.equal(done.stop, 'done');
  assert.match(done.text, /im Hintergrund[\s\S]*DONE – der Test ist durch\./);
  assert.deepEqual(t.events.filter((event: any) => event.type === 'background'), [
    { type: 'background', id: 'bash_1', running: true }, { type: 'background', id: 'bash_1', running: false },
  ]);
  call.child.exit(0);
});

test('claude: a foreground task_started (not backgrounded) holds nothing', async () => {
  const h = claudeSetup({ turn: (_call, session) => [
    { type: 'system', subtype: 'task_started', task_id: 'agent_1', is_backgrounded: false },
    assistant('Fertig.'), result(session, 'Fertig.'),
  ] });
  const t = input();
  const done = await h.engine.run(t.input);
  assert.equal(done.stop, 'done');
  assert.equal(done.text, 'Fertig.');
  assert.equal(t.events.some((event: any) => event.type === 'background'), false);
});

test('claude: setModel writes set_model into the running CLI and says so; another effort or an ended turn is false; an error answer puts it back', async () => {
  const h = claudeSetup({ exit: false, turn: () => [assistant('Working')] });
  const t = input();
  const running = h.engine.run(t.input);
  await until(() => t.events.some((event: any) => event.type === 'text'));
  const call = h.cli.of('turn')[0];
  assert.equal(await h.engine.setModel('run_1', 'claude-sonnet-5', 'high'), false, 'the CLI sets no effort inside a turn');
  assert.equal(await h.engine.setModel('run_1', 'claude-sonnet-5', 'medium'), true);
  await until(() => call.child.lines.some((line: any) => line?.request?.subtype === 'set_model'));
  const request = call.child.lines.find((line: any) => line?.request?.subtype === 'set_model') as any;
  assert.equal(request.type, 'control_request');
  assert.equal(request.request.model, 'claude-sonnet-5');
  assert.deepEqual(t.events.filter((event: any) => event.type === 'model'), [{ type: 'model', model: 'claude-sonnet-5', effort: 'medium' }]);
  call.child.send({ type: 'control_response', response: { subtype: 'error', request_id: request.request_id, error: 'unknown model' } });
  await until(() => t.events.filter((event: any) => event.type === 'model').length === 2);
  assert.deepEqual(t.events.filter((event: any) => event.type === 'model')[1], { type: 'model', model: 'claude-opus-5-5', effort: 'medium' }, 'back on the model before');
  call.child.send(result(sessionOf(call.args), 'Working'));
  await running;
  assert.equal(await h.engine.setModel('run_1', 'claude-sonnet-5', 'medium'), false, 'no turn runs');
  call.child.exit(0);
});

test('claude: a fresh agent session is announced at its system/init; a resumed one is not', async () => {
  const h = claudeSetup();
  const fresh = input();
  await h.engine.run(fresh.input);
  const call = h.cli.of('turn')[0];
  assert.deepEqual(fresh.events.filter((event: any) => event.type === 'session'), [{ type: 'session', ref: sessionOf(call.args), generation: 1 }]);
  const resumed = input({ session: { ref: sessionOf(call.args), generation: 2 } });
  await h.engine.run(resumed.input);
  assert.equal(resumed.events.some((event: any) => event.type === 'session'), false);
});

test('claude stream: ambient and awaited tasks are no background work; task_updated moves a task in and out', () => {
  const events: any[] = [];
  const parser = new ClaudeStreamParser((event) => events.push(event), () => 0);
  parser.push({ type: 'system', subtype: 'task_started', task_id: 'watch_1', is_backgrounded: true, ambient: true });
  parser.push({ type: 'system', subtype: 'task_started', task_id: 'agent_2', is_backgrounded: true, awaited: true });
  parser.push({ type: 'system', subtype: 'task_updated', task_id: 'watch_1', patch: { is_backgrounded: true } });
  assert.equal(parser.state.background.size, 0, 'a watcher and an awaited run hold nothing');
  parser.push({ type: 'system', subtype: 'task_started', task_id: 'bash_3', is_backgrounded: false });
  parser.push({ type: 'system', subtype: 'task_updated', task_id: 'bash_3', patch: { is_backgrounded: true } });
  assert.deepEqual([...parser.state.background], ['bash_3'], 'moved to the background later');
  parser.push({ type: 'system', subtype: 'task_updated', task_id: 'bash_3', patch: { is_backgrounded: false } });
  assert.equal(parser.state.background.size, 0, 'back in the foreground');
  assert.deepEqual(events.filter((event) => event.type === 'background'), [
    { type: 'background', id: 'bash_3', running: true }, { type: 'background', id: 'bash_3', running: false },
  ]);
});

test('claude: an error result ends the turn at once, even while a background task runs', async () => {
  const h = claudeSetup({ exit: false, turn: (_call, session) => [
    { type: 'system', subtype: 'task_started', task_id: 'bash_1', is_backgrounded: true },
    { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'API Error: 529 overloaded', session_id: session },
  ] });
  const t = input();
  const done = await h.engine.run(t.input);
  assert.notEqual(done.stop, 'done', 'the outage is seen now, not after the task');
  h.cli.of('turn')[0].child.exit(0);
});
