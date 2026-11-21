// B-057 S12 dispatcher lanes (agents/dispatch-lanes.ts, dispatch-runs.ts): a split runs on its own lane beside the
// agent's main lane; the agent's own cap ('busy' – B-080: no global slots); haltAll, stopSplit and the person's Stop in
// a chat end lanes; the agent shows idle only after its last lane; activity rows of split lanes carry `split`; onLaneFree fires
// after a lane ends and when turns may start again. Real chats, wakes and scheduler; a controllable fake executor and
// a recording split service. Owns: these assertions only. Never: real engines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent } from '../chat/harness.ts';
import { flush, setup } from './fakes.ts';
import type { SplitService } from '../../../src/runtime/contracts.ts';
import type { SplitRunEnd } from '../../../src/runtime/contracts/splits.ts';
import type { SplitTurn } from '../../../src/shared/model/splits.ts';
import { HandlerTable, type HandlerContext } from '../../../src/runtime/rpc/table.ts';
import { register as registerChats } from '../../../src/runtime/rpc/handlers/chats.ts';

function split(id: string, extra: Partial<SplitTurn> = {}): SplitTurn {
  return {
    splitId: id, groupId: 'sg_1', idx: 1, of: 3, title: `Part ${id}`, parentRunId: 'run_parent', parentThread: 'ch_x',
    context: 'brief', firstTurn: true, ...extra,
  };
}

function withSplits() {
  const h = setup();
  h.org.add(agent('ag_tom', 'Tom'));
  h.org.add(agent('ag_lea', 'Lea'));
  const turns = new Map<string, SplitTurn>();
  const ends: Array<{ splitId: string; end: SplitRunEnd }> = [];
  const stops: Array<{ q: Parameters<SplitService['stop']>[0]; by: string }> = [];
  h.services.splits = {
    turnFor: (id: string) => turns.get(id),
    inputFor: (id: string) => [{ text: `Your part: ${turns.get(id)?.title}`, at: 1 }],
    get: () => undefined,
    onSplitRunEnd: (splitId: string, end: SplitRunEnd) => { ends.push({ splitId, end }); },
    afterParentTurn: () => {},
    stop: (q: Parameters<SplitService['stop']>[0], by: string) => {
      stops.push({ q, by });
      let stopped = 0;
      for (const lane of h.dispatcher.splitLanes(q.agentId)) {
        const turn = turns.get(lane.splitId);
        if (q.conversationId && turn?.parentConversationId !== q.conversationId) continue;
        if (h.dispatcher.stopSplit(lane.splitId, 'human')) stopped++;
      }
      return stopped;
    },
  } as unknown as SplitService;
  let freed = 0;
  h.dispatcher.onLaneFree(() => { freed++; });
  const add = (turn: SplitTurn) => { turns.set(turn.splitId, turn); return turn; };
  return { ...h, turns, ends, stops, add, freed: () => freed };
}

const tomCalls = (h: ReturnType<typeof withSplits>) => h.executor.calls.filter((call) => call.request.agentId === 'ag_tom');

test('a split runs on its own lane beside the main turn of the same agent', async () => {
  const h = withSplits();
  const chat = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  h.dispatcher.start();
  h.chats.send({ conversationId: chat.id, body: 'go', authorId: 'human' });
  await flush();
  h.add(split('sp_1', { parentConversationId: chat.id }));
  assert.equal(h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_1' }), 'started');
  await flush();
  const [main, lane] = tomCalls(h);
  assert.equal(h.executor.maxRunning, 2, 'main and split lane run at once');
  assert.equal(main.request.conversationId, chat.id);
  assert.equal(lane.request.reason, 'split');
  assert.equal(lane.request.split?.splitId, 'sp_1');
  assert.equal(lane.request.conversationId, undefined);
  assert.equal(lane.request.taskId, undefined);
  assert.deepEqual(lane.request.notes.map((note) => note.text), ['Your part: Part sp_1']);
  assert.notEqual(lane.request.runId, main.request.runId);
  // Activity: the main row without split, the lane's row with its split facts and its parent's chat – main rows first.
  const rows = h.dispatcher.activity();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].runId, main.request.runId);
  assert.equal(rows[1].conversationId, chat.id, 'a split row reports its parent\'s chat');
  assert.equal(rows.find((row) => row.runId === main.request.runId)?.split, undefined);
  assert.deepEqual(rows.find((row) => row.runId === lane.request.runId)?.split, { id: 'sp_1', groupId: 'sg_1', idx: 1, of: 3, parentRunId: 'run_parent', title: 'Part sp_1' });
  assert.deepEqual(h.dispatcher.splitLanes('ag_tom'), [{ agentId: 'ag_tom', splitId: 'sp_1', runId: lane.request.runId }]);
  assert.deepEqual(h.dispatcher.splitLanes('ag_lea'), []);
  // Its lane is taken while its turn runs: busy, never a second turn (nor 'started' for a turn that is ending).
  assert.equal(h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_1' }), 'busy', 'its lane still runs');
  assert.equal(tomCalls(h).length, 2);
  main.finish();
  lane.finish();
  await flush();
  assert.equal(h.dispatcher.activity().length, 0);
});

test('a retry asked for while the split\'s ending turn still holds its lane is busy, then starts when the lane frees', async () => {
  const h = withSplits();
  h.dispatcher.start();
  h.add(split('sp_1'));
  assert.equal(h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_1' }), 'started');
  await flush();
  const first = h.executor.last();
  const before = h.freed();
  first.finish({ status: 'failed' }); // the split service re-queues it from inside this turn's finish (turn-finish.ts → onSplitRunEnd)
  assert.equal(h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_1' }), 'busy', 'the ending turn still holds the lane');
  await flush();
  assert.equal(h.freed(), before + 1, 'the lane\'s end fires onLaneFree');
  assert.equal(h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_1' }), 'started');
  await flush();
  assert.equal(h.executor.calls.length, 2, 'the retry runs as a new turn');
  assert.notEqual(h.executor.last().request.runId, first.request.runId);
  assert.deepEqual(h.dispatcher.splitLanes('ag_tom').map((lane) => lane.runId), [h.executor.last().request.runId]);
  h.executor.last().finish();
  await flush();
});

test('B-080, one capacity rule: no global limit – with five agents at work an agent starts four parts at once, its fifth waits for one of its own', async () => {
  const h = withSplits();
  for (const [id, name] of [['ag_max', 'Max'], ['ag_nora', 'Nora'], ['ag_jonas', 'Jonas']]) h.org.add(agent(id, name));
  const chats = ['ag_tom', 'ag_lea', 'ag_max', 'ag_nora', 'ag_jonas'].map((id) => h.chats.create({ agentIds: [id], createdBy: 'human' }));
  h.dispatcher.start();
  for (const chat of chats) h.chats.send({ conversationId: chat.id, body: 'go', authorId: 'human' });
  await flush();
  assert.equal(h.executor.calls.length, 5, 'five main turns run');
  for (const id of ['sp_1', 'sp_2', 'sp_3', 'sp_4', 'sp_5', 'sp_lea']) h.add(split(id));
  const results = ['sp_1', 'sp_2', 'sp_3', 'sp_4', 'sp_5'].map((id) => h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: id }));
  assert.deepEqual(results, ['started', 'started', 'started', 'started', 'busy'], 'SPLIT_LIMITS.runningPerAgent = 4 – whatever else runs');
  assert.equal(h.dispatcher.startSplit({ agentId: 'ag_lea', splitId: 'sp_lea' }), 'started', 'Lea\'s part starts at once beside Tom\'s four');
  await flush();
  assert.equal(h.executor.maxRunning, 10, 'five main turns and five parts at once');
  const tomMain = tomCalls(h).find((call) => !call.request.split)!;
  tomMain.finish(); // a main lane's end frees nothing for his fifth part
  await flush();
  assert.equal(h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_5' }), 'busy', 'his four parts still run');
  h.chats.send({ conversationId: chats[0].id, body: 'and now?', authorId: 'human' });
  await flush();
  assert.equal(tomCalls(h).filter((call) => !call.request.split && !call.done).length, 1, 'his own turn starts at once beside his four parts');
  const before = h.freed();
  tomCalls(h).find((call) => call.request.split?.splitId === 'sp_1')!.finish();
  await flush();
  assert.equal(h.freed(), before + 1, 'his part\'s end fires onLaneFree');
  assert.equal(h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_5' }), 'started');
  for (const call of h.executor.calls) call.finish();
  await flush();
});

test('the agent shows idle only after its last lane; a split lane keeps the main lane\'s status line', async () => {
  const h = withSplits();
  const chat = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  h.dispatcher.start();
  h.chats.send({ conversationId: chat.id, body: 'go', authorId: 'human' });
  await flush();
  h.add(split('sp_1'));
  h.add(split('sp_2'));
  h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_1' });
  h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_2' });
  await flush();
  const [main, one, two] = tomCalls(h);
  one.request.onStatus?.('reading the docs');
  assert.notEqual(h.org.get('ag_tom')?.statusNote, 'reading the docs', 'a split note shows in its activity row only');
  assert.equal(h.dispatcher.activity().find((row) => row.runId === one.request.runId)?.note, 'reading the docs');
  const idle = () => h.statuses.filter((item) => item.id === 'ag_tom' && item.status === 'idle').length;
  main.finish();
  await flush();
  assert.equal(idle(), 0, 'splits still run');
  assert.equal(h.org.get('ag_tom')?.status, 'working');
  one.finish();
  await flush();
  assert.equal(idle(), 0);
  two.finish();
  await flush();
  assert.equal(idle(), 1, 'idle after the last lane');
  assert.equal(h.org.get('ag_tom')?.status, 'idle');
});

test('haltAll stops every lane; under the work-stop a split is refused; lifting it fires onLaneFree', async () => {
  const h = withSplits();
  const chat = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  h.dispatcher.start();
  h.chats.send({ conversationId: chat.id, body: 'go', authorId: 'human' });
  await flush();
  h.add(split('sp_1'));
  h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_1' });
  await flush();
  const [main, lane] = tomCalls(h);
  const halted = h.dispatcher.haltAll('Emergency stop.');
  h.dispatcher.setHalted(true);
  await halted.settled;
  await flush();
  assert.deepEqual(new Set(halted.runIds), new Set([main.request.runId, lane.request.runId]));
  assert.equal(lane.request.signal.aborted, true);
  assert.equal(lane.request.control.stopKind, 'human');
  h.add(split('sp_2'));
  assert.equal(h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_2' }), 'refused');
  const before = h.freed();
  h.dispatcher.setHalted(false);
  assert.equal(h.freed(), before + 1);
  assert.equal(h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_2' }), 'started');
  h.executor.last().finish();
  await flush();
});

test('stopSplit aborts that lane only; an archived agent is refused, a paused one busy until resumed', async () => {
  const h = withSplits();
  h.dispatcher.start();
  h.add(split('sp_1'));
  h.add(split('sp_2'));
  h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_1' });
  h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_2' });
  await flush();
  const [one, two] = tomCalls(h);
  assert.equal(h.dispatcher.stopSplit('sp_1', 'human'), true);
  assert.equal(h.dispatcher.stopSplit('sp_missing', 'human'), false);
  await flush();
  assert.equal(one.request.signal.aborted, true);
  assert.equal(one.request.control.stopKind, 'human');
  assert.equal(two.request.signal.aborted, false);
  two.finish();
  await flush();

  const lea = h.org.require('ag_lea');
  lea.archivedAt = 1;
  h.add(split('sp_3'));
  assert.equal(h.dispatcher.startSplit({ agentId: 'ag_lea', splitId: 'sp_3' }), 'refused');
  const tom = h.org.require('ag_tom');
  tom.status = 'paused';
  assert.equal(h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_3' }), 'busy');
  const before = h.freed();
  tom.status = 'idle';
  h.bus.emit('agent.upserted', tom);
  await flush();
  assert.equal(h.freed(), before + 1, 'resuming the agent fires onLaneFree');
  assert.equal(h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_unknown' }), 'refused', 'a split the service does not hand out');
});

test('interrupt (a task\'s end or take-back) stops the main turn only; the person\'s Stop in a chat (messages.stop) ends that chat\'s splits, others run on', async () => {
  const h = withSplits();
  const chat = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  h.dispatcher.start();
  h.chats.send({ conversationId: chat.id, body: 'go', authorId: 'human' });
  await flush();
  h.add(split('sp_here', { parentConversationId: chat.id }));
  h.add(split('sp_else', { parentConversationId: 'ch_other' }));
  h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_here' });
  h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_else' });
  await flush();
  const [main, here, elsewhere] = tomCalls(h);
  await h.dispatcher.interrupt('ag_tom', chat.id); // tasks/owners.ts stopRuns, tasks/capture.ts stopTurns
  await flush();
  assert.equal(main.request.signal.aborted, true);
  assert.deepEqual(h.stops, [], 'interrupt never stops splits');
  assert.equal(here.request.signal.aborted, false);
  const table = new HandlerTable();
  registerChats(table);
  const ctx = { scope: { kind: 'owner' }, services: h.services, extras: {}, topics: new Set(), signal: new AbortController().signal } as unknown as HandlerContext;
  await table.get('messages.stop')!.handler({ conversationId: chat.id, agentId: 'ag_tom' }, ctx);
  await flush();
  assert.deepEqual(h.stops, [{ q: { conversationId: chat.id, agentId: 'ag_tom' }, by: 'human' }]);
  assert.equal(here.request.signal.aborted, true);
  assert.equal(here.request.control.stopKind, 'human');
  assert.equal(elsewhere.request.signal.aborted, false);
  elsewhere.finish();
  await flush();
});

test('a split turn that plans no run or is stopped before it starts tells the split service', async () => {
  const h = withSplits();
  h.dispatcher.start();
  h.add(split('sp_1'));
  h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_1' });
  await flush();
  h.executor.last().finish({ status: 'skipped' });
  await flush();
  assert.deepEqual(h.ends.map((item) => [item.splitId, item.end.status]), [['sp_1', 'stopped']]);

  h.add(split('sp_2'));
  h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_2' });
  h.dispatcher.stopSplit('sp_2', 'human'); // before the executor ran (it starts a microtask later)
  await flush();
  assert.equal(h.executor.calls.length, 1, 'never executed');
  assert.deepEqual(h.ends.at(-1), { splitId: 'sp_2', end: { runId: h.ends.at(-1)!.end.runId, status: 'stopped' } });
  assert.equal(h.dispatcher.activity().length, 0);

  h.add(split('sp_3'));
  h.dispatcher.startSplit({ agentId: 'ag_tom', splitId: 'sp_3' });
  await h.dispatcher.stop(); // a shutdown before its turn ran: the part never started – back to queued, no attempt used
  assert.equal(h.executor.calls.length, 1);
  assert.deepEqual(h.ends.at(-1), { splitId: 'sp_3', end: { runId: h.ends.at(-1)!.end.runId, status: 'failed', retryable: true, requeue: true, error: 'The runtime stopped before the split ran.' } });
});
