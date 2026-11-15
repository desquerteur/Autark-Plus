// Tests for the agent-to-agent loop and cost guard (src/runtime/chat/loop-guard.ts) and how
// delivery applies it in group chats: rate limit per chat and minute, ping-pong and (B-050 round 4) discussion detection,
// reset rules (human message, task progress), isolation per chat, and the hand-over to the
// lead. B-080: an @mention always wakes and ends a back-and-forth pause, a line from a turn that did work (chat/worked.ts)
// counts as progress, the rate pause lifts itself once the minute has room, and the lead's wake note is first person.
// Owns: these assertions only. Never: real timers or sleeps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoopGuard } from '../../../src/runtime/chat/loop-guard.ts';
import { journalWorked } from '../../../src/runtime/chat/worked.ts';
import type { RunJournal } from '../../../src/runtime/contracts.ts';
import type { RunItem } from '../../../src/shared/model/runs.ts';
import { agent, fakeJournal, harness, type FakeCall } from './harness.ts';

const T0 = Date.UTC(2026, 9, 17, 9, 0, 0);
const S = 1000;

test('rate: more than N agent messages per minute pause the chat; then "paused" until reset', () => {
  const guard = new LoopGuard({ maxPerMinute: 3, pingPongTurns: 100 });
  const verdicts = ['ag_a', 'ag_b', 'ag_c', 'ag_a', 'ag_b'].map((id, i) => guard.agentMessage('conv_1', id, T0 + i * S));
  assert.deepEqual(verdicts, ['ok', 'ok', 'ok', 'rate', 'paused']);
  assert.equal(guard.paused('conv_1'), true);
  assert.equal(guard.paused('conv_1'), true);
});

test('rate: the window slides – messages older than a minute no longer count', () => {
  const guard = new LoopGuard({ maxPerMinute: 3, pingPongTurns: 100 });
  for (let i = 0; i < 3; i++) assert.equal(guard.agentMessage('conv_1', 'ag_a', T0 + i * S), 'ok');
  assert.equal(guard.agentMessage('conv_1', 'ag_a', T0 + 60 * S), 'ok', 'the first one dropped out of the window');
  assert.equal(guard.agentMessage('conv_1', 'ag_a', T0 + 61 * S), 'ok');
  assert.equal(guard.agentMessage('conv_1', 'ag_a', T0 + 61.5 * S), 'rate');
});

test('B-080, rate: the pause lifts itself once the minute has room – no person\'s line needed; addressed lines count too', () => {
  const guard = new LoopGuard({ maxPerMinute: 3, pingPongTurns: 100 });
  const verdicts = Array.from({ length: 5 }, (_, i) => guard.agentMessage('conv_1', i % 2 ? 'ag_b' : 'ag_a', T0 + i * S, true));
  assert.deepEqual(verdicts, ['ok', 'ok', 'ok', 'rate', 'paused'], 'every line counts for the rate, an @mention too');
  assert.equal(guard.agentMessage('conv_1', 'ag_a', T0 + 62 * S, true), 'ok', 'a minute later the window has room');
  assert.equal(guard.paused('conv_1'), false);
});

test('ping-pong: two agents alternating N times pause the chat; pair() names them', () => {
  const guard = new LoopGuard({ maxPerMinute: 1000, pingPongTurns: 4 });
  const verdicts = ['ag_a', 'ag_b', 'ag_a', 'ag_b'].map((id, i) => guard.agentMessage('conv_1', id, T0 + i * 10 * S));
  assert.deepEqual(verdicts, ['ok', 'ok', 'ok', 'ping_pong']);
  assert.deepEqual(guard.pair('conv_1').sort(), ['ag_a', 'ag_b']);
  assert.deepEqual(guard.pair('conv_unknown'), []);
  assert.equal(guard.paused('conv_1'), true);
});

test('B-080, ping-pong: an addressed line ends the pause and starts the count over; lines without one count again', () => {
  const guard = new LoopGuard({ maxPerMinute: 1000, pingPongTurns: 4 });
  ['ag_a', 'ag_b', 'ag_a', 'ag_b'].forEach((id, i) => guard.agentMessage('conv_1', id, T0 + i * S));
  assert.equal(guard.agentMessage('conv_1', 'ag_a', T0 + 5 * S), 'paused');
  assert.equal(guard.agentMessage('conv_1', 'ag_a', T0 + 6 * S, true), 'ok', 'an @mention (or a line with work) wakes');
  assert.equal(guard.paused('conv_1'), false);
  assert.deepEqual(['ag_b', 'ag_a', 'ag_b'].map((id, i) => guard.agentMessage('conv_1', id, T0 + (7 + i) * S)), ['ok', 'ok', 'ok'], 'the count started over');
  assert.equal(guard.agentMessage('conv_1', 'ag_a', T0 + 10 * S), 'ping_pong', 'four more alternating lines without one');
  const many = new LoopGuard({ maxPerMinute: 1000, pingPongTurns: 4 });
  for (let i = 0; i < 20; i++) assert.equal(many.agentMessage('conv_1', i % 2 ? 'ag_b' : 'ag_a', T0 + i * S, true), 'ok', 'addressed lines never pause as a back-and-forth');
});

test('ping-pong: a third voice or one agent talking alone is not a ping-pong', () => {
  const guard = new LoopGuard({ maxPerMinute: 1000, pingPongTurns: 4 });
  for (const [i, id] of ['ag_a', 'ag_b', 'ag_c', 'ag_a', 'ag_b', 'ag_c', 'ag_a'].entries()) {
    assert.equal(guard.agentMessage('conv_1', id, T0 + i * S), 'ok');
  }
  for (let i = 0; i < 8; i++) assert.equal(guard.agentMessage('conv_2', 'ag_a', T0 + i * S), 'ok');
  assert.deepEqual(['ag_a', 'ag_a', 'ag_b', 'ag_a'].map((id, i) => guard.agentMessage('conv_3', id, T0 + i * S)), ['ok', 'ok', 'ok', 'ok'], 'A A B A does not alternate');
});

test('reset (human message / task progress) clears the pause and the ping-pong run', () => {
  const guard = new LoopGuard({ maxPerMinute: 1000, pingPongTurns: 4 });
  ['ag_a', 'ag_b', 'ag_a', 'ag_b'].forEach((id, i) => guard.agentMessage('conv_1', id, T0 + i * S));
  assert.equal(guard.paused('conv_1'), true);
  guard.reset('conv_1');
  assert.equal(guard.paused('conv_1'), false);
  assert.deepEqual(['ag_a', 'ag_b', 'ag_a'].map((id, i) => guard.agentMessage('conv_1', id, T0 + (10 + i) * S)), ['ok', 'ok', 'ok'], 'the run starts over');
  assert.doesNotThrow(() => guard.reset('conv_never_seen'));
});

test('reset after a rate pause starts a fresh window, so the next reply is not paused again (regression)', () => {
  const guard = new LoopGuard({ maxPerMinute: 3, pingPongTurns: 100 });
  for (let i = 0; i < 4; i++) guard.agentMessage('conv_1', 'ag_a', T0 + i * S);
  assert.equal(guard.paused('conv_1'), true);
  guard.reset('conv_1'); // the person writes "go on"
  assert.equal(guard.agentMessage('conv_1', 'ag_a', T0 + 5 * S), 'ok');
  assert.equal(guard.agentMessage('conv_1', 'ag_b', T0 + 6 * S), 'ok');
  assert.equal(guard.agentMessage('conv_1', 'ag_a', T0 + 7 * S), 'ok');
  assert.equal(guard.agentMessage('conv_1', 'ag_b', T0 + 8 * S), 'rate', 'the brake still holds for the new window');
});

test('reset without a rate pause keeps counting the minute (task lines are no way around the cost brake)', () => {
  const guard = new LoopGuard({ maxPerMinute: 3, pingPongTurns: 100 });
  guard.agentMessage('conv_1', 'ag_a', T0);
  guard.agentMessage('conv_1', 'ag_b', T0 + S);
  guard.reset('conv_1');
  guard.agentMessage('conv_1', 'ag_a', T0 + 2 * S);
  assert.equal(guard.agentMessage('conv_1', 'ag_b', T0 + 3 * S), 'rate');
});

test('B-080: a person\'s line under a back-and-forth pause with a full minute also starts a fresh window', () => {
  const guard = new LoopGuard({ maxPerMinute: 3, pingPongTurns: 2 });
  ['ag_a', 'ag_b', 'ag_a', 'ag_b'].forEach((id, i) => guard.agentMessage('conv_1', id, T0 + i * S));
  assert.equal(guard.paused('conv_1'), true);
  guard.reset('conv_1');
  assert.equal(guard.agentMessage('conv_1', 'ag_a', T0 + 5 * S, true), 'ok', 'not paused again by the old minute');
});

test('every chat has its own counters', () => {
  const guard = new LoopGuard({ maxPerMinute: 2, pingPongTurns: 100 });
  guard.agentMessage('conv_1', 'ag_a', T0);
  guard.agentMessage('conv_1', 'ag_a', T0);
  assert.equal(guard.agentMessage('conv_1', 'ag_a', T0), 'rate');
  assert.equal(guard.agentMessage('conv_2', 'ag_a', T0), 'ok');
  assert.equal(guard.paused('conv_2'), false);
});

test('defaults: 20 agent messages per minute, 8 alternating turns, 12 changes of speaker', () => {
  const guard = new LoopGuard();
  // Round 4: two speakers taking turns out of step (a b b a b b …) are a discussion now – here one hand-over between them.
  for (let i = 0; i < 20; i++) assert.equal(guard.agentMessage('conv_1', i < 10 ? 'ag_a' : 'ag_b', T0 + i), 'ok');
  assert.equal(guard.agentMessage('conv_1', 'ag_c', T0 + 21), 'rate');
  const pingPong = new LoopGuard();
  const verdicts = Array.from({ length: 8 }, (_, i) => pingPong.agentMessage('conv_1', i % 2 ? 'ag_b' : 'ag_a', T0 + i * 10 * S));
  assert.deepEqual(verdicts, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ping_pong']);
  const talk = new LoopGuard();
  const outOfStep = Array.from({ length: 20 }, (_, i) => talk.agentMessage('conv_1', i % 3 === 0 ? 'ag_a' : 'ag_b', T0 + i));
  assert.equal(outOfStep.indexOf('ping_pong'), 18, 'the old rate input (a b b a b b …) now pauses at its twelfth change of speaker, before the rate limit');
});

test('round 4, discussion: twelve changes of speaker among agents pause the chat – three in a circle, two out of step; one agent alone never', () => {
  const guard = new LoopGuard({ maxPerMinute: 1000 });
  const circle = Array.from({ length: 13 }, (_, i) => guard.agentMessage('conv_1', ['ag_a', 'ag_b', 'ag_c'][i % 3], T0 + i * 10 * S));
  assert.deepEqual(circle, [...Array<string>(12).fill('ok'), 'ping_pong'], 'the 13th line is the 12th change of speaker');
  assert.deepEqual(guard.pair('conv_1').sort(), ['ag_a', 'ag_b', 'ag_c'], 'the voices of the discussion');
  const outOfStep = ['ag_a', 'ag_a', 'ag_b', 'ag_a', 'ag_b', 'ag_b'];
  const verdicts: string[] = [];
  for (let i = 0; i < 40 && !verdicts.includes('ping_pong'); i++) verdicts.push(guard.agentMessage('conv_2', outOfStep[i % 6], T0 + i * 10 * S));
  assert.equal(verdicts.at(-1), 'ping_pong', 'two agents that never strictly alternate are stopped too');
  assert.ok(verdicts.length <= 20, `within 20 lines (${verdicts.length})`);
  for (let i = 0; i < 40; i++) assert.equal(guard.agentMessage('conv_3', 'ag_a', T0 + i * 10 * S), 'ok', 'one agent talking alone');
  guard.reset('conv_1');
  assert.deepEqual(['ag_a', 'ag_b', 'ag_c'].map((id, i) => guard.agentMessage('conv_1', id, T0 + (200 + i) * S)), ['ok', 'ok', 'ok'], 'a person or task progress starts the count over');
  const off = new LoopGuard({ maxPerMinute: 1000, pingPongTurns: 1000, discussionTurns: Infinity });
  for (let i = 0; i < 40; i++) assert.equal(off.agentMessage('conv_1', ['ag_a', 'ag_b', 'ag_c'][i % 3], T0 + i * S), 'ok', 'Infinity: off (bridged people)');
});

// ----------------------------------------------------------------- what counts as work (chat/worked.ts)

const items = (calls: Array<FakeCall & { result?: boolean }>): RunItem[] => {
  const journal = fakeJournal();
  return journal.runs.items(journal.add('run_x', 'message', calls.map(({ result, ...call }) => ({ ...call, ...(result !== undefined ? { ok: result } : {}) }))));
};
const categories: Record<string, 'read' | 'think' | 'write_local'> = { 'files.read': 'read', 'chat.read': 'read', 'chat.send': 'think', 'tasks.update': 'think', 'files.write': 'write_local' };

test('B-080, journalWorked: a write, a task step or a native edit is work; reads, chat.* and failed calls are not', () => {
  const worked = (calls: Array<FakeCall & { result?: boolean }>) => journalWorked(items(calls), (name) => categories[name]);
  assert.equal(worked([{ name: 'files.write' }]), true, 'its category from the registry');
  assert.equal(worked([{ name: 'tasks.update' }]), true, 'task work');
  assert.equal(worked([{ name: 'apply_patch', own: true }]), true);
  assert.equal(worked([{ name: 'shell', own: true, nested: true }]), true, 'a shell inside a code-mode script');
  assert.equal(worked([{ name: 'chat.read' }, { name: 'files.read' }, { name: 'chat.send' }]), false, 'chat.* is think, reads only look');
  assert.equal(worked([{ name: 'read', own: true }, { name: 'grep', own: true }]), false, 'native looks');
  assert.equal(worked([]), false, 'no tool at all');
  assert.equal(worked([{ name: 'files.write', result: false }]), false, 'a failed write did nothing');
  const subconscious: RunItem = { id: 'ri_s', runId: 'run_x', seq: 0, kind: 'tool_call', name: 'files.write', data: { callId: 'c', subconscious: true }, createdAt: 0 };
  assert.equal(journalWorked([subconscious], (name) => categories[name]), false, 'the subconscious\'s lookups are not the turn\'s calls');
  assert.equal(journalWorked(items([{ name: 'files.write', category: undefined }]).map((item) => ({ ...item, data: { callId: item.data.callId } })), (name) => categories[name]), true, 'without a journaled category: the registry\'s');
});

// ----------------------------------------------------------------- applied by delivery

function group(maxPerMinute?: number) {
  const h = harness({ maxPerMinute });
  h.org.add(agent('ag_mara', 'Mara', { mode: 'manager' }));
  h.org.add(agent('ag_tom', 'Tom', { managerId: 'ag_mara' }));
  h.org.add(agent('ag_lea', 'Lea', { managerId: 'ag_mara' }));
  const chat = h.chats.create({ title: 'Launch', agentIds: ['ag_mara', 'ag_tom', 'ag_lea'], createdBy: 'human' });
  const say = (from: string, to: string) => {
    h.wakes.cancel(to);
    h.clock.advance(5 * S);
    h.chats.send({ conversationId: chat.id, body: `@${h.org.get(to)!.name} next`, authorId: from });
    return h.wakes.pending(to) > 0;
  };
  /** A line without @ (the pick decides; without a decision model an agent's line wakes nobody). */
  const talk = (from: string) => { h.clock.advance(5 * S); h.chats.send({ conversationId: chat.id, body: 'next', authorId: from }); };
  const notes = () => h.chats.messages(chat.id).filter(m => m.kind === 'status' && m.meta.status?.details?.guard).map(m => m.body);
  return { ...h, chat, say, talk, notes };
}

/** Tom and Lea alone in a room (K3: a line of one wakes the other); `runs`: a fake journal for lines of runs. */
function pair(options: { maxPerMinute?: number; runs?: RunJournal } = {}) {
  const h = harness(options);
  h.org.add(agent('ag_tom', 'Tom'));
  h.org.add(agent('ag_lea', 'Lea'));
  const chat = h.chats.create({ title: 'Cut', agentIds: ['ag_tom', 'ag_lea'], humans: false, createdBy: 'ag_tom' });
  const other = (id: string) => (id === 'ag_tom' ? 'ag_lea' : 'ag_tom');
  const post = (from: string, body: string, runId?: string, gap = 5 * S) => {
    const to = other(from);
    h.wakes.cancel(to);
    h.clock.advance(gap);
    h.chats.send({ conversationId: chat.id, body, authorId: from, ...(runId ? { runId } : {}) });
    return h.wakes.pending(to) > 0;
  };
  const line = (from: string, runId?: string) => post(from, 'next', runId);
  const mention = (from: string, gap?: number) => post(from, `@${h.org.get(other(from))!.name} next`, undefined, gap);
  const notes = () => h.chats.messages(chat.id).filter(m => m.kind === 'status' && m.meta.status?.details?.guard).map(m => m.body);
  return { ...h, chat, line, mention, notes };
}

const PAUSED = 'Agent replies paused: back-and-forth without work in between';
const alternate = (n: number, say: (from: string, i: number) => boolean) => Array.from({ length: n }, (_, i) => say(i % 2 ? 'ag_lea' : 'ag_tom', i));

test('B-080, delivery: an @mention always wakes – ten alternating "@name next" lines between two agents, no pause line', () => {
  const g = group();
  const woken: boolean[] = [];
  for (let i = 0; i < 10; i++) woken.push(i % 2 ? g.say('ag_lea', 'ag_tom') : g.say('ag_tom', 'ag_lea'));
  assert.deepEqual(woken, Array<boolean>(10).fill(true), 'before B-080 the 8th to 10th woke nobody');
  assert.deepEqual(g.notes(), []);
  assert.equal(g.wakeRows().filter(w => w.reason === 'review').length, 0);
});

test('delivery: lines without @ between two agents still pause after 8 alternations, once; a group\'s lead gets the loop in its own voice', () => {
  const p = pair();
  assert.deepEqual(alternate(10, (from) => p.line(from)), [true, true, true, true, true, true, true, false, false, false]);
  assert.deepEqual(p.notes(), [PAUSED], 'one status line, not one per message');
  assert.equal(pausedIn(p, p.chat.id), true);
  const g = group();
  for (let i = 0; i < 8; i++) g.talk(i % 2 ? 'ag_lea' : 'ag_tom');
  assert.deepEqual(g.notes(), [PAUSED]);
  const review = g.wakeRows().filter(w => w.agent_id === 'ag_mara' && w.reason === 'review');
  assert.equal(review.length, 1, 'the lead (manager) is asked to sort it out');
  assert.equal(review[0].note, 'Tom and Lea answered each other here again and again with no work between the lines – I see what they are missing and settle it in this chat.');
});

test('B-080, delivery: after a back-and-forth pause an @mention wakes at once, and the next line without @ wakes again', () => {
  const p = pair();
  alternate(8, (from) => p.line(from));
  assert.equal(p.line('ag_tom'), false);
  assert.equal(p.mention('ag_lea'), true, 'the @mention wakes Tom');
  assert.equal(pausedIn(p, p.chat.id), false);
  assert.equal(p.line('ag_tom'), true, 'the pause is over');
});

test('B-080, delivery: 21 agent lines in one minute – the 21st wakes nobody; 61 s later the next one wakes, with no person\'s line', () => {
  const p = pair();
  const woken = alternate(21, (from) => p.mention(from, S));
  assert.deepEqual(woken, [...Array<boolean>(20).fill(true), false]);
  assert.deepEqual(p.notes(), ['Agent replies paused: message rate limit']);
  assert.equal(pausedIn(p, p.chat.id), true);
  assert.equal(p.mention('ag_lea', 61 * S), true);
  assert.deepEqual(p.notes(), ['Agent replies paused: message rate limit'], 'one line for the pause');
});

test('B-080 (loop-guard-ineffective, live wpp0p6v8 22:30 / zycn09tg 03:06): lines from runs that did work never pause; talk-only runs do', () => {
  const journal = fakeJournal();
  const p = pair({ runs: journal.runs });
  const work: FakeCall[][] = [[{ name: 'files.write', category: 'write_local' }], [{ name: 'apply_patch', own: true }], [{ name: 'shell', own: true }]];
  const woken = Array.from({ length: 12 }, (_, i) => p.line(i % 2 ? 'ag_lea' : 'ag_tom', journal.add(`run_w${i}`, 'message', work[i % 3])));
  assert.deepEqual(woken, Array<boolean>(12).fill(true), 'every line wakes the other');
  assert.deepEqual(p.notes(), []);

  const talk = pair({ runs: journal.runs });
  const reads: FakeCall[][] = [[{ name: 'chat.read', category: 'read' }], [{ name: 'files.read', category: 'read' }], [], [{ name: 'chat.send', category: 'think' }], [{ name: 'files.write', category: 'write_local', ok: false }]];
  const talked = Array.from({ length: 8 }, (_, i) => talk.line(i % 2 ? 'ag_lea' : 'ag_tom', journal.add(`run_t${i}`, 'message', reads[i % 5])));
  assert.deepEqual(talked, [...Array<boolean>(7).fill(true), false], 'a pause at line 8 as before');
  assert.deepEqual(talk.notes(), [PAUSED]);
  assert.equal(talk.line('ag_lea', journal.add('run_task', 'message', [{ name: 'tasks.update', category: 'think' }])), true, 'a line from a run with tasks.update lifts it');
  assert.equal(talk.line('ag_tom', journal.add('run_t9', 'message', [])), true, 'and the next talk line wakes the colleague again');
});

test('B-080 (message-wake P1): a line from a task, retry, schedule or child run is work; a message or review run\'s line is not', () => {
  const journal = fakeJournal();
  for (const trigger of ['retry', 'task', 'schedule', 'child'] as const) {
    const p = pair({ runs: journal.runs });
    alternate(8, (from, i) => p.line(from, journal.add(`run_${trigger}_${i}`, i % 2 ? 'review' : 'message')));
    assert.equal(pausedIn(p, p.chat.id), true, 'message and review runs only talked');
    assert.equal(p.line('ag_tom', journal.add(`run_${trigger}_m`, 'message')), false, 'a message run\'s line while paused wakes nobody');
    assert.equal(p.line('ag_lea', journal.add(`run_${trigger}_own`, trigger)), true, `${trigger}: it lifts the pause and wakes Tom`);
    assert.equal(pausedIn(p, p.chat.id), false);
  }
});


test('B-076, delivery: the person\'s click on an ask block (their answer line) lifts the pause like a typed line', () => {
  const g = group();
  for (let i = 0; i < 8; i++) g.talk(i % 2 ? 'ag_lea' : 'ag_tom');
  assert.equal(pausedIn(g, g.chat.id), true);
  g.chats.send({ conversationId: g.chat.id, body: 'Option B', kind: 'answer', authorId: 'human', authorKind: 'human' });
  assert.equal(pausedIn(g, g.chat.id), false);
});

test('delivery: after a rate pause, a human message lets agents answer each other again (regression)', () => {
  const g = group(4);
  const woken = Array.from({ length: 6 }, (_, i) => g.say(i % 3 === 0 ? 'ag_tom' : i % 3 === 1 ? 'ag_lea' : 'ag_mara', i % 3 === 0 ? 'ag_lea' : i % 3 === 1 ? 'ag_mara' : 'ag_tom'));
  assert.deepEqual(woken, [true, true, true, true, false, false]);
  assert.deepEqual(g.notes(), ['Agent replies paused: message rate limit']);
  g.chats.send({ conversationId: g.chat.id, body: 'Carry on, all of you', authorId: 'human' });
  assert.equal(g.say('ag_tom', 'ag_lea'), true);
  assert.deepEqual(g.notes(), ['Agent replies paused: message rate limit'], 'no second pause line right after the person spoke');
});

test('round 4 / B-080, delivery: three agents talking in a circle without @ pause at the twelfth change of speaker – the lead took part, no review; with @mentions they keep waking', () => {
  const g = group();
  const order = ['ag_tom', 'ag_lea', 'ag_mara'];
  for (let i = 0; i < 12; i++) g.talk(order[i % 3]);
  assert.equal(pausedIn(g, g.chat.id), false, 'eleven changes of speaker');
  g.talk(order[12 % 3]);
  assert.deepEqual(g.notes(), [PAUSED]);
  assert.equal(g.wakeRows().filter((w) => w.reason === 'review').length, 0, 'the lead (Mara) was one of the voices');
  g.chats.send({ conversationId: g.chat.id, body: '@Tom wrap it up please', authorId: 'human' });
  assert.equal(pausedIn(g, g.chat.id), false, 'the person lifts it');
  const woken = Array.from({ length: 14 }, (_, i) => g.say(order[i % 3], order[(i + 1) % 3]));
  assert.deepEqual(woken, Array<boolean>(14).fill(true), 'an @mention always wakes – before B-080 the 13th and 14th did not');
  assert.deepEqual(g.notes(), [PAUSED], 'no second pause line');
});

/** Whether agents' wakes are paused in that chat now (the delivery's loop guard; 13.11.2026: no public reader any more). */
function pausedIn(h: { delivery: unknown }, conversationId: string): boolean {
  return (h.delivery as { router: { guard: { paused(id: string): boolean } } }).router.guard.paused(conversationId);
}
