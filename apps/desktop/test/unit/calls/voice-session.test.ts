// KI-Runde 17.11.2026, decision 7.1: one kept conversation for a call (src/runtime/decision/engine-runner.ts
// createChatOpener) against the fake engine – it routes once, opens the session with the first line, sends one input per
// line on that session with the same stable part, hands the text to the caller as the model writes it, and lets the session
// go at the end of the call. An engine that keeps no session answers every line as its own turn with the call so far as
// text. A line that fails drops the session, and the next line opens a new one that hears the call so far. A stopped line
// (a barge-in) keeps it; a session that is gone is noticed and the line runs again with the call so far; a lane that runs
// out goes once to another account; the call's start opens the session; nothing outlives the call.
// Owns: these assertions only. Never: a real model or process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatOpener } from '../../../src/runtime/decision/engine-runner.ts';
import { FakeEngine } from '../../../src/runtime/engines/fake.ts';
import type { EngineRunnerDeps } from '../../../src/runtime/decision/engine-runner.ts';
import type { Engine, EngineTurnInput } from '../../../src/runtime/engines/types.ts';
import type { Account, RouteDecision } from '../../../src/shared/model/providers.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';
import type { EngineTurnResult } from '../../../src/runtime/engines/types.ts';
import { claudeAccount, claudeSetup, until } from '../engines/claude-fixture.ts';

const account: Account = { id: 'acc_1', provider: 'openai', label: 'Fake', engine: 'fake', state: 'ok', enabled: true, createdAt: 0, updatedAt: 0 } as unknown as Account;
const route: RouteDecision = { modelId: 'fake:fake-1', engine: 'fake', accountId: 'acc_1', effort: 'low', category: 'cheap-chat', reason: 'test', by: 'rules', alternatives: [] };

function deps(engine: Engine, options: { routes?: () => Promise<RouteDecision> } = {}): EngineRunnerDeps {
  return {
    engines: { get: () => engine } as unknown as EngineRunnerDeps['engines'],
    router: { route: options.routes ?? (async () => route) } as unknown as EngineRunnerDeps['router'],
    accounts: { get: () => account, markLimited: () => {}, markUnavailable: () => {}, updateLimits: () => {} } as unknown as EngineRunnerDeps['accounts'],
    catalog: { get: () => ({ id: 'fake:fake-1', model: 'fake-1', engine: 'fake', efforts: ['low'] }) } as unknown as EngineRunnerDeps['catalog'],
    paths: { temp: process.env.TEMP ?? '/tmp' },
    clock: { now: () => 1 } as unknown as EngineRunnerDeps['clock'],
  };
}

test('one session for the call: the first line opens it, every later line is one input on it, and the text arrives as it is written', async () => {
  const engine = new FakeEngine();
  const chat = createChatOpener(deps(engine))({ purpose: 'call voice', system: 'I am the live voice.' });
  const pieces: string[] = [];
  const first = await chat.say({ input: 'Gerd said: "Wie weit bist du mit dem Bericht für die Zahlen vom Oktober?"', onText: (delta) => pieces.push(delta) });
  assert.equal(first.kept, false, 'nothing was kept before the first line');
  assert.match(first.text, /Wie weit bist du/);
  assert.ok(pieces.length > 1, 'the text came in pieces while the model wrote');
  assert.equal(pieces.join(''), first.text);
  const second = await chat.say({ input: 'Gerd said: "Und die Zahlen?"' });
  assert.equal(second.kept, true, 'the session carried the first line');
  const turns = engine.turns as EngineTurnInput[];
  assert.equal(turns.length, 2);
  assert.equal(turns[0].session, undefined, 'the first line opens the session');
  assert.equal(turns[1].session?.ref, 'fake-session-1', 'the second line runs on it');
  assert.deepEqual(turns.map((turn) => turn.system.stable), ['I am the live voice.', 'I am the live voice.'], 'the stable part is the same text');
  assert.deepEqual(turns.map((turn) => turn.input.length), [1, 1], 'one input per spoken line');
  assert.deepEqual(turns.map((turn) => turn.keep), [true, true], 'the engine is told to keep the conversation');
  assert.deepEqual(turns.map((turn) => turn.tools.length), [0, 0], 'the voice has no tools');
  chat.close();
});

test('an engine that keeps no session: every line is its own turn, and the voice works the same', async () => {
  const engine = new FakeEngine();
  Object.assign(engine, { caps: { ...engine.caps, sessions: false } });
  const chat = createChatOpener(deps(engine))({ purpose: 'call voice', system: 'I am the live voice.' });
  await chat.say({ input: 'eins' });
  const second = await chat.say({ input: 'zwei' });
  assert.equal(second.kept, false, 'no session carried it');
  const turns = engine.turns as EngineTurnInput[];
  assert.deepEqual(turns.map((turn) => turn.session), [undefined, undefined]);
  const text = (turn: EngineTurnInput) => (turn.input[0] as { text: string }).text;
  assert.equal(text(turns[0]), 'eins', 'the first line comes alone');
  assert.equal(text(turns[1]), 'Earlier in this call, in order:\neins\nI answered: Echo: eins\n\nzwei', 'a later line brings the call so far as text');
  chat.close();
});

test('a line that fails drops the session; a closed voice answers nothing more; no lane reaches the caller as unavailable', async () => {
  const engine = new FakeEngine();
  const chat = createChatOpener(deps(engine))({ purpose: 'call voice', system: 'x' });
  await chat.say({ input: 'eins' });
  await assert.rejects(chat.say({ input: '[[fail]]' }), /could not complete|internal/);
  await chat.say({ input: 'drei' });
  const turns = engine.turns as EngineTurnInput[];
  assert.equal(turns[1].session?.ref, 'fake-session-1', 'the failed line still ran on the open session');
  assert.equal(turns[2].session, undefined, 'after it, the next line opens a new one');
  assert.match((turns[2].input[0] as { text: string }).text, /^Earlier in this call, in order:\neins\n/, 'and the new one hears the call so far');
  chat.close();
  await assert.rejects(chat.say({ input: 'vier' }), /closed/);

  const none = createChatOpener(deps(engine, { routes: async () => { throw new WorkforceError('unavailable', 'No model can run now.'); } }))({ purpose: 'call voice', system: 'x' });
  await assert.rejects(none.say({ input: 'eins' }), (error: unknown) => error instanceof WorkforceError && error.code === 'unavailable');
});

// ------------------------------------------------------------------ the kept Claude process across barge-ins (review r2-2 finding 1)

const cdelta = (text: string) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const userText = (message: any): string => (message?.message?.content ?? []).map((part: any) => part.text ?? '').join('');
const done = (text: string, session?: string) => ({ type: 'result', subtype: 'success', is_error: false, result: text, ...(session ? { session_id: session } : {}) });

function claudeDeps(h: ReturnType<typeof claudeSetup>): EngineRunnerDeps {
  const acc = claudeAccount();
  const claudeRoute: RouteDecision = { modelId: 'claude:claude-haiku-5-5', engine: 'claude', accountId: acc.id, effort: 'low', category: 'cheap-chat', reason: 'test', by: 'rules', alternatives: [] };
  return {
    engines: { get: () => h.engine } as unknown as EngineRunnerDeps['engines'],
    router: { route: async () => claudeRoute } as unknown as EngineRunnerDeps['router'],
    accounts: { get: () => acc, markLimited: () => {}, markUnavailable: () => {}, updateLimits: () => {} } as unknown as EngineRunnerDeps['accounts'],
    catalog: { get: () => ({ id: claudeRoute.modelId, model: 'claude-haiku-5-5', engine: 'claude', efforts: ['low'] }) } as unknown as EngineRunnerDeps['catalog'],
    paths: { temp: process.env.TEMP ?? '/tmp' },
    clock: { now: () => 1 } as unknown as EngineRunnerDeps['clock'],
  };
}

test('a barge-in keeps the session: the cut line ends, the newer one runs in the same process, and the end of the call ends it', async () => {
  const h = claudeSetup({ exit: false, turn: (_call, session) => [cdelta('Hallo.'), done('Hallo.', session)] });
  const chat = createChatOpener(claudeDeps(h))({ purpose: 'call voice', system: 'I am the voice.' });
  await chat.say({ input: 'eins' });
  const child = h.cli.of('turn')[0].child;
  const heard: string[] = [];
  let writing!: () => void;
  const twoWrites = new Promise<void>((resolve) => { writing = resolve; }); // the event the cut waits for, not a count of ticks (E4, 18.11.)
  child.onLine = (message: any) => {
    if (message?.type === 'control_request' && message.request?.subtype === 'interrupt') { child.send({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'interrupted' }); return; }
    if (message?.type !== 'user') return;
    heard.push(userText(message));
    if (userText(message) === 'zwei') { child.send(cdelta('Ich schau')); writing(); return; } // writes on until it is cut
    child.send(cdelta('Klar.'));
    child.send(done('Klar.'));
  };
  const cut = new AbortController();
  const two = chat.say({ input: 'zwei', signal: cut.signal }).then(() => 'answered', (error: unknown) => String(error));
  await twoWrites;
  cut.abort(); // talker.heard: the running ask is cut and asked again at once with both lines
  const three = await chat.say({ input: 'zwei / drei' });
  assert.match(await two, /stopped|cancel/i);
  assert.equal(three.text, 'Klar.');
  assert.equal(three.kept, true, 'the session carried the call');
  assert.equal(h.cli.of('turn').length, 1, 'no second process');
  assert.deepEqual(heard, ['zwei', 'zwei / drei'], 'the newer line went into the same process');
  const four = await chat.say({ input: 'vier' });
  assert.equal(four.kept, true);
  assert.equal(h.cli.of('turn').length, 1);
  chat.close(); // ends the kept process's input at once (kept.ts close), nothing to wait for
  assert.deepEqual(h.cli.of('turn').map((call) => call.child.stdin.writableEnded), [true], 'nothing outlives the call');
  child.exit(0);
});

test('a kept process that is gone is noticed: the line runs once more on a new one, with the call so far in front', async () => {
  const h = claudeSetup({ exit: false, turn: (_call, session) => [done('Hallo.', session)] });
  const sent: Array<{ text: string; session?: string }> = [];
  const engine = Object.assign(Object.create(h.engine), {
    run: (input: EngineTurnInput) => { sent.push({ text: (input.input[0] as { text: string }).text, session: input.session?.ref }); return h.engine.run(input); },
  });
  const d = claudeDeps(h);
  d.engines = { get: () => engine } as unknown as EngineRunnerDeps['engines'];
  const chat = createChatOpener(d)({ purpose: 'call voice', system: 'I am the voice.' });
  await chat.say({ input: 'eins' });
  h.cli.of('turn')[0].child.exit(0); // it idled out, crashed or was let go after a stop
  await until(() => false, 10);
  const two = await chat.say({ input: 'und?' });
  assert.equal(two.kept, false, 'the new process did not have the call');
  assert.equal(h.cli.of('turn').length, 2, 'one new process, started by the line that ran again');
  assert.deepEqual(sent.slice(1).map((one) => one.text), ['und?', 'Earlier in this call, in order:\neins\nI answered: Hallo.\n\nund?'], 'the gone session was noticed and the line ran again with the call so far');
  assert.equal(sent[2].session, undefined);
  chat.close();
  h.cli.of('turn')[1].child.exit(0);
});

test('the start of the call opens the session, and the first line runs in it', async () => {
  const h = claudeSetup({ exit: false, turn: (_call, session) => [done('Hallo.', session)] });
  const chat = createChatOpener(claudeDeps(h))({ purpose: 'call voice', system: 'I am the voice.' });
  chat.open();
  const one = await chat.say({ input: 'eins' }); // runs after the opening on the chat's queue: no count of ticks to wait (E4, 18.11.)
  assert.equal(one.text, 'Hallo.');
  assert.equal(one.kept, true, 'the session the start opened carried the first line');
  assert.equal(h.cli.of('turn').length, 1, 'the process opened at the start is the one the line ran in');
  const child = h.cli.of('turn')[0].child;
  chat.close();
  assert.equal(child.stdin.writableEnded, true);
  child.exit(0);
});

// ------------------------------------------------------------------ a lane that runs out in the middle of a call (review r2-4 finding 5)

function laneDeps(answer: (accountId: string) => EngineTurnResult, accounts: string[]): { deps: EngineRunnerDeps; ran: string[] } {
  const ran: string[] = [];
  const engine = {
    id: 'fake', caps: { sessions: true },
    run: async (input: EngineTurnInput) => { ran.push(input.account.id); return answer(input.account.id); },
  } as unknown as Engine;
  const byId = new Map(accounts.map((id) => [id, { ...account, id } as Account]));
  const deps: EngineRunnerDeps = {
    engines: { get: () => engine } as unknown as EngineRunnerDeps['engines'],
    router: {
      route: async (request: { exclude?: string[] }) => {
        const free = accounts.find((id) => !(request.exclude ?? []).includes(id));
        if (!free) throw new WorkforceError('unavailable', 'No model can run now.');
        return { ...route, accountId: free };
      },
    } as unknown as EngineRunnerDeps['router'],
    accounts: { get: (id: string) => byId.get(id), list: () => [...byId.values()], markLimited: () => {}, markUnavailable: () => {}, updateLimits: () => {} } as unknown as EngineRunnerDeps['accounts'],
    catalog: { get: () => ({ id: 'fake:fake-1', model: 'fake-1', engine: 'fake', efforts: ['low'] }) } as unknown as EngineRunnerDeps['catalog'],
    paths: { temp: process.env.TEMP ?? '/tmp' },
    clock: { now: () => 1 } as unknown as EngineRunnerDeps['clock'],
  };
  return { deps, ran };
}

const limited: EngineTurnResult = { text: '', stop: 'limit', error: { code: 'rate_limited', message: 'The usage limit of this account was reached.' } };

test('a lane that runs out in the middle of a call: the line goes once to another account', async () => {
  const { deps: d, ran } = laneDeps((id) => (id === 'acc_1' ? limited : { text: 'Bin da.', stop: 'done', session: { ref: `s-${id}`, generation: 1 } }), ['acc_1', 'acc_2']);
  const said = await createChatOpener(d)({ purpose: 'call voice', system: 'x' }).say({ input: 'eins' });
  assert.equal(said.text, 'Bin da.');
  assert.deepEqual(ran, ['acc_1', 'acc_2']);
});

test('a lane that runs out and none other can run: the line fails as unavailable, so the call hears the no-lane line', async () => {
  const unavailable = (error: unknown) => error instanceof WorkforceError && error.code === 'unavailable';
  const one = laneDeps(() => limited, ['acc_1']);
  await assert.rejects(createChatOpener(one.deps)({ purpose: 'call voice', system: 'x' }).say({ input: 'eins' }), unavailable);
  assert.deepEqual(one.ran, ['acc_1']);
  const both = laneDeps(() => limited, ['acc_1', 'acc_2']);
  await assert.rejects(createChatOpener(both.deps)({ purpose: 'call voice', system: 'x' }).say({ input: 'eins' }), unavailable);
  assert.deepEqual(both.ran, ['acc_1', 'acc_2'], 'tried once on the other account');
});

test('a line that runs once more tells the caller first, so its text starts anew (review 3)', async () => {
  const { deps: d } = laneDeps(() => limited, ['acc_1', 'acc_2']);
  const engine = {
    id: 'fake', caps: { sessions: true },
    run: async (input: EngineTurnInput) => {
      const text = input.account.id === 'acc_1' ? 'Hallo Gerd.' : 'Hallo Gerd, bin da.';
      input.onEvent?.({ type: 'text', delta: text });
      return input.account.id === 'acc_1' ? limited : { text, stop: 'done' };
    },
  } as unknown as Engine;
  d.engines = { get: () => engine } as unknown as EngineRunnerDeps['engines'];
  let heard = '';
  const said = await createChatOpener(d)({ purpose: 'call voice', system: 'x' }).say({ input: 'eins', onText: (delta) => { heard += delta; }, onRestart: () => { heard = ''; } });
  assert.equal(said.text, 'Hallo Gerd, bin da.');
  assert.equal(heard, 'Hallo Gerd, bin da.', 'the first try\'s text is not in front of the second');
});

test('every line the voice answers says in one log line what it used: the model, whether the session carried it, its time and tokens (real run 18.11.)', async () => {
  const logged: Array<{ message: string; data: Record<string, unknown> }> = [];
  const engine = new FakeEngine();
  const d = { ...deps(engine), log: { info: (message: string, data?: Record<string, unknown>) => { logged.push({ message, data: data ?? {} }); } } };
  const chat = createChatOpener(d)({ purpose: 'call voice', system: 'I am the live voice.' });
  await chat.say({ input: 'Gerd said: "Eins."' });
  await chat.say({ input: 'Gerd said: "Zwei."' });
  chat.close();
  const lines = logged.filter((entry) => entry.message === 'call voice line');
  assert.equal(lines.length, 2, 'one log line per spoken line');
  assert.deepEqual(lines.map((entry) => entry.data.kept), [false, true]);
  assert.deepEqual(lines.map((entry) => entry.data.model), ['fake:fake-1', 'fake:fake-1']);
  for (const { data } of lines) {
    assert.equal(typeof data.ms, 'number');
    const use = data.use as { input: number; cached: number; output: number };
    assert.ok(use.input > 0 && use.output > 0, 'the tokens it used');
    assert.ok(!Object.keys(data).some((key) => /token/i.test(key)), 'no key the log hides');
  }
});
