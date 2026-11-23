// A call voice's kept Claude Code process (KI-Runde 17.11.2026, decision 7.1; src/runtime/engines/claude/kept.ts): a helper
// turn with `keep` starts one process (our prompt only, no tools, nothing on disk), a later line with its ref is one more user
// message in that same process with its text streamed back, a stopped line is interrupted inside it, and unload() at the
// call's end ends its input so the CLI ends by itself. Before this, a kept line on Claude Code resumed a session the CLI had
// never written (--no-session-persistence) and failed.
// Owns: these assertions only. Never: a real Claude Code binary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnInput } from './fakes.ts';
import { claudeAccount, claudeSetup, until } from './claude-fixture.ts';

const delta = (text: string) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const assistant = (text: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const result = (session: string, text: string) => ({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: session });
const line = (text: string, patch: Record<string, unknown> = {}) => turnInput({
  model: 'claude-haiku-5-5', account: claudeAccount(), tools: [], keep: true, system: { stable: 'I am the live voice.', volatile: '' }, input: [{ type: 'text', text }], ...patch,
});
const said = (message: any): string => (message?.message?.content ?? []).map((part: any) => part.text ?? '').join('');

test('claude: one process for the call – each later line is one more message in it, its text streamed back', async () => {
  const h = claudeSetup({ exit: false, turn: (_call, session) => [delta('Läuft'), delta(' noch.'), assistant('Läuft noch.'), result(session, 'Läuft noch.')] });
  const first = line('Gerd said: "Wie weit bist du?"');
  const one = await h.engine.run(first.input);
  assert.equal(one.stop, 'done');
  assert.equal(one.text, 'Läuft noch.');
  assert.deepEqual(first.events.filter((event: any) => event.type === 'text').map((event: any) => event.delta), ['Läuft', ' noch.'], 'the text came as it was written');
  const spawned = h.cli.of('turn');
  assert.equal(spawned.length, 1);
  const args = spawned[0].args;
  assert.ok(args.includes('--no-session-persistence'), 'nothing of the call lands on disk');
  assert.ok(!args.includes('--resume'));
  assert.equal(args[args.indexOf('--tools') + 1], '', 'no tool of Claude Code’s own');
  const ref = one.session!.ref;
  assert.equal(args[args.indexOf('--session-id') + 1], ref, 'the session ref is the id the process started with');

  const child = spawned[0].child;
  const heard: string[] = [];
  child.onLine = (message: any) => {
    if (message?.type !== 'user') return;
    heard.push(said(message));
    child.send(delta('Die Zahlen'));
    child.send(delta(' sind da.'));
    child.send(assistant('Die Zahlen sind da.'));
    child.send(result(ref, 'Die Zahlen sind da.'));
  };
  const second = line('Gerd said: "Und die Zahlen?"', { session: { ref, generation: 1 } });
  const two = await h.engine.run(second.input);
  assert.equal(two.stop, 'done');
  assert.equal(two.text, 'Die Zahlen sind da.');
  assert.equal(two.session?.ref, ref);
  assert.equal(h.cli.of('turn').length, 1, 'no second process');
  assert.deepEqual(heard, ['Gerd said: "Und die Zahlen?"'], 'the line went into the running process');
  assert.equal(child.stdin.writableEnded, false, 'the process waits for the next line');

  await h.engine.unload!(claudeAccount(), ref);
  assert.equal(child.stdin.writableEnded, true, 'the call ended: its input ends and the CLI ends by itself');
  child.exit(0);
  const third = await h.engine.run(line('Noch was?', { session: { ref, generation: 1 } }).input);
  assert.equal(third.stop, 'error');
  assert.equal(third.error?.code, 'conflict', 'a ref whose process is gone says so, so the caller says the line again with the call so far');
  assert.equal(h.cli.of('turn').length, 1, 'and it starts nothing on its own');
});

test('claude: keepOpen starts the call voice\'s process before its first line, and that line runs in it', async () => {
  const h = claudeSetup({ exit: false, turn: (_call, session) => [result(session, 'Hallo.')] });
  const opened = await h.engine.keepOpen!({ account: claudeAccount(), model: 'claude-haiku-5-5', effort: 'low', system: { stable: 'I am the live voice.', volatile: '' }, cwd: '/fake-temp/helper' });
  assert.equal(h.cli.of('turn').length, 1, 'the process runs before anyone spoke');
  const child = h.cli.of('turn')[0].child;
  child.onLine = (message: any) => { if (message?.type === 'user') child.send(result(opened.ref, `Gehört: ${said(message)}`)); };
  const one = await h.engine.run(line('Hallo?', { session: opened }).input);
  assert.equal(one.stop, 'done');
  assert.equal(one.text, 'Gehört: Hallo?');
  assert.equal(h.cli.of('turn').length, 1, 'no second process');
  await h.engine.unload!(claudeAccount(), opened.ref);
  assert.equal(child.stdin.writableEnded, true);
  child.exit(0);
});

test('claude: a stopped line is interrupted inside the kept process, and the process takes the next line', async () => {
  const h = claudeSetup({ exit: false, turn: (_call, session) => [result(session, 'Hallo.')] });
  const one = await h.engine.run(line('Hallo?').input);
  const ref = one.session!.ref;
  const child = h.cli.of('turn')[0].child;
  let interrupted = 0;
  child.onLine = (message: any) => {
    if (message?.type === 'control_request' && message.request?.subtype === 'interrupt') {
      interrupted++;
      child.send({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Request interrupted by user', session_id: ref });
      return;
    }
    if (message?.type !== 'user') return;
    if (said(message).includes('zweite')) { child.send(delta('Ich schau')); return; } // writes and writes
    child.send(assistant('Ja.'));
    child.send(result(ref, 'Ja.'));
  };
  const stop = new AbortController();
  const second = line('die zweite Zeile', { session: { ref, generation: 1 }, signal: stop.signal });
  const running = h.engine.run(second.input);
  await until(() => second.events.some((event: any) => event.type === 'text'));
  stop.abort();
  const cut = await running;
  assert.equal(cut.stop, 'interrupted');
  assert.equal(interrupted, 1);
  const third = await h.engine.run(line('die dritte', { session: { ref, generation: 1 } }).input);
  assert.equal(third.stop, 'done');
  assert.equal(third.text, 'Ja.');
  assert.equal(h.cli.of('turn').length, 1, 'still the one process');
  await h.engine.dispose();
  assert.equal(child.stdin.writableEnded, true, 'shutdown lets the kept process go');
  child.exit(0);
});
