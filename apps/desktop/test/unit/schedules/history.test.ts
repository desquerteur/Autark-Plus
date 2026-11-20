// #20: the run history of a schedule (what the Schedules page lists): every fire, a run now, a missed run
// under catch-up 'skip', a routine whose last task is still open and an ended schedule leave one line; the last
// 30 stay. Also the page's flagship rule "every day 06:00 Berlin" across both DST changes.
// Owns: these assertions only. Never: real timers or sleeps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent, harness } from '../chat/harness.ts';
import { SchedulerImpl } from '../../../src/runtime/schedules/scheduler.ts';
import { firesBetween, localParts } from '../../../src/runtime/schedules/spec.ts';
import { SCHEDULE_HISTORY_MAX } from '../../../src/shared/model/tasks.ts';

const M = 60_000;
const H = 60 * M;
const D = 24 * H;
const NINE = Date.UTC(2026, 9, 17, 9, 0, 0);

function setup() {
  const h = harness();
  h.org.add(agent('ag_tom', 'Tom'));
  const chat = h.chats.create({ agentIds: ['ag_tom'], createdBy: 'human' });
  return { ...h, chat };
}

test('every fire leaves an ok line; Run now one marked manual', () => {
  const h = setup();
  h.scheduler.start();
  const job = h.scheduler.create({ ownerId: 'ag_tom', conversationId: h.chat.id, kind: 'message', title: 'Hi', spec: { cron: '0 10 * * *', tz: 'UTC' }, payload: { body: 'Hi' } });
  h.scheduler.stop();
  const restarted = new SchedulerImpl({ ...h.services }, { timers: h.timers });
  h.clock.advance(H + M);
  restarted.start();
  assert.deepEqual(restarted.get(job.id)!.history!.map(r => [r.outcome, r.at]), [['ok', NINE + H]]);
  restarted.runNow(job.id);
  const history = restarted.get(job.id)!.history!;
  assert.equal(history.length, 2);
  assert.equal(history[1].manual, true);
  assert.equal(history[1].outcome, 'ok');
  restarted.stop();
});

test("catch-up 'skip': a run missed while the PC was off is listed as skipped", () => {
  const h = setup();
  h.scheduler.start();
  const job = h.scheduler.create({ ownerId: 'ag_tom', conversationId: h.chat.id, kind: 'message', title: 'Hi', spec: { cron: '0 10 * * *', tz: 'UTC', catchUp: 'skip' }, payload: { body: 'Hi' } });
  h.scheduler.stop();
  h.clock.advance(3 * D);
  const restarted = new SchedulerImpl({ ...h.services }, { timers: h.timers });
  restarted.start();
  const after = restarted.get(job.id)!;
  assert.deepEqual(after.history!.map(r => r.outcome), ['skipped']);
  assert.match(after.history![0].note ?? '', /not running/);
  assert.equal(after.runs, 0);
  restarted.stop();
});

test('a schedule whose chat is gone ends and says so in its history (Run now keeps it switched off)', () => {
  const h = setup();
  h.scheduler.start();
  const job = h.scheduler.create({ ownerId: 'ag_tom', conversationId: h.chat.id, kind: 'message', title: 'Hi', spec: { everyMs: H }, payload: { body: 'Hi' } });
  h.chats.remove(h.chat.id);
  h.scheduler.runNow(job.id);
  const after = h.scheduler.get(job.id)!;
  assert.equal(after.active, false);
  assert.deepEqual(after.history!.map(r => r.outcome), ['ended']);
  h.scheduler.stop();
});

test(`only the last ${SCHEDULE_HISTORY_MAX} runs are kept`, () => {
  const h = setup();
  h.scheduler.start();
  const job = h.scheduler.create({ ownerId: 'ag_tom', conversationId: h.chat.id, kind: 'message', title: 'Hi', spec: { everyMs: H }, payload: { body: 'Hi' } });
  for (let i = 0; i < SCHEDULE_HISTORY_MAX + 5; i++) h.scheduler.runNow(job.id);
  assert.equal(h.scheduler.get(job.id)!.history!.length, SCHEDULE_HISTORY_MAX);
  h.scheduler.stop();
});

test('"every day 06:00" in Berlin fires at 06:00 local on both DST changes (23 and 25 hour days)', () => {
  const tz = 'Europe/Berlin';
  const spec = { times: ['06:00'], tz };
  for (const [from, to] of [[Date.UTC(2026, 9, 23), Date.UTC(2026, 9, 28)], [Date.UTC(2027, 2, 26), Date.UTC(2027, 2, 31)]]) {
    const fires = firesBetween(spec, from, to);
    assert.equal(fires.length, 5, 'exactly one run per local day');
    for (const at of fires) assert.equal(localParts(at, tz).minutes, 6 * 60);
    for (let i = 1; i < fires.length; i++) assert.ok([23 * H, 24 * H, 25 * H].includes(fires[i] - fires[i - 1]));
  }
});

test('a routine\'s run names the task it made; a skipped one the task still open', () => {
  const h = setup();
  h.scheduler.start();
  const job = h.scheduler.create({ ownerId: 'ag_tom', kind: 'routine', title: 'News', spec: { cron: '0 10 * * *', tz: 'UTC' }, payload: { taskTemplate: { title: 'News' } } });
  h.scheduler.runNow(job.id);
  const first = h.scheduler.get(job.id)!.history!.at(-1)!;
  assert.equal(first.outcome, 'ok');
  assert.ok(first.taskId && h.tasks.get(first.taskId), 'the run links the task it created');
  h.scheduler.runNow(job.id);
  const second = h.scheduler.get(job.id)!.history!.at(-1)!;
  assert.equal(second.outcome, 'skipped');
  assert.equal(second.taskId, first.taskId, 'skipped for the task that is still open');
  h.scheduler.stop();
});
