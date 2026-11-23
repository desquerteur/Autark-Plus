// Activity (src/ui/team/activity-model.ts): one row per member, people and agents side
// by side – done today (since the day start, done only), working now (an agent's live run with its
// task's title; a person's focus timer or working task), open (without what waits for a ring) and
// stuck (Work's rule; for a human also past due, never a timer) – and the totals line.
// Owns: these assertions only. Never: the DOM, rpc or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentActivity } from '../../../src/shared/model/runs.ts';
import type { TaskView } from '../../../src/shared/model/tasks.ts';
import { NO_OWNER, activityRows, activityTotals, isStuck, ownedByMember } from '../../../src/ui/team/activity-model.ts';
import { STUCK_MS as STUCK_WAIT_MS, stuckOf } from '../../../src/shared/model/task-stuck.ts';
import type { ActivityInput, ActivityMember } from '../../../src/ui/team/activity-model.ts';

const NOW = Date.UTC(2026, 9, 24, 15);
const DAY_START = Date.UTC(2026, 9, 24, 0);
let seq = 0;

function task(patch: Partial<TaskView> = {}): TaskView {
  seq++;
  return {
    id: `task_${seq}`, conversationId: 'ch_a', title: `Task ${seq}`, notes: '', status: 'open', assigneeKind: 'agent', assigneeId: 'ag_mara',
    createdBy: 'human', priority: 0, dependsOn: [], ledger: {}, attempts: 0, sort: seq, rev: 1, createdAt: NOW - 1000 * seq, updatedAt: NOW,
    steps: [], progress: { done: 0, total: 0 }, conversationTitle: 'Alpha', running: false,
    ...patch,
  } as TaskView;
}

const run = (agentId: string, patch: Partial<AgentActivity> = {}): AgentActivity => ({ agentId, runId: `run_${agentId}`, conversationId: 'ch_a', note: 'Working', startedAt: NOW - 60_000, ...patch });

const members: ActivityMember[] = [{ id: 'human', kind: 'person' }, { id: 'per_anna', kind: 'person' }, { id: 'ag_mara', kind: 'agent' }, { id: 'ag_leo', kind: 'agent' }];

function input(patch: Partial<ActivityInput>): ActivityInput {
  return { open: [], todos: [], done: [], live: [], now: NOW, dayStart: DAY_START, ...patch };
}

test('ownedByMember: agents by id, people as their page counts them (the caller also without an id)', () => {
  assert.equal(ownedByMember({ assigneeKind: 'agent', assigneeId: 'ag_mara' }, { id: 'ag_mara', kind: 'agent' }), true);
  assert.equal(ownedByMember({ assigneeKind: 'human', assigneeId: 'ag_mara' }, { id: 'ag_mara', kind: 'agent' }), false);
  assert.equal(ownedByMember({ assigneeKind: 'human' }, { id: 'human', kind: 'person' }), true);
  assert.equal(ownedByMember({ assigneeKind: 'human', assigneeId: 'per_anna' }, { id: 'per_anna', kind: 'person' }), true);
  assert.equal(ownedByMember({ assigneeKind: 'team' }, { id: 'human', kind: 'person' }), false);
});



test('activityRows: a live run without a task shows its note; without a note "Working"', () => {
  const rows = activityRows([{ id: 'ag_leo', kind: 'agent' }, { id: 'ag_mara', kind: 'agent' }], input({ live: [run('ag_leo', { note: 'Checking the inbox' }), run('ag_mara', { note: '' })] }));
  assert.deepEqual(rows[0].now, { title: 'Checking the inbox', conversationId: 'ch_a' });
  assert.equal(rows[1].now?.title, 'Working');
});

test('B-054: a chat-free run without a task says what started it (origin label), with its live note beside it', () => {
  const rows = activityRows([{ id: 'ag_leo', kind: 'agent' }, { id: 'ag_mara', kind: 'agent' }], input({ live: [
    run('ag_leo', { conversationId: undefined, note: 'Reading the mail', origin: { source: 'app:mail1', label: 'New mail in office@example.com' } }),
    run('ag_mara', { conversationId: undefined, note: '', origin: { source: 'schedule:s1', label: 'Routine "Morning check"' } }),
  ] }));
  assert.deepEqual(rows[0].now, { title: 'New mail in office@example.com', note: 'Reading the mail', conversationId: undefined });
  assert.equal(rows[1].now?.title, 'Routine "Morning check"');
  assert.equal(rows[1].now?.note, undefined);
});

test('work nobody owns yet is its own row ("No owner yet"): the totals then match Work\'s stuck count', () => {
  const unowned = task({ assigneeKind: 'team', assigneeId: undefined, title: 'Steuern erledigen' });
  const unowned2 = task({ assigneeKind: 'team', assigneeId: undefined, title: 'Webseite verbessern' });
  const blocked = task({ status: 'waiting' });
  const open = [unowned, unowned2, blocked];
  const rows = activityRows([...members, NO_OWNER], input({ open }));
  const nobody = rows.find((row) => row.member.kind === 'team')!;
  assert.deepEqual([nobody.open, nobody.stuck], [2, 2], 'no owner yet is stuck in Work too');
  const workStuck = open.filter((entry) => stuckOf(entry, NOW)).length;
  assert.equal(activityTotals(rows).stuck, workStuck);
  assert.equal(ownedByMember({ assigneeKind: 'team' }, NO_OWNER), true);
  assert.equal(ownedByMember({ assigneeKind: 'agent', assigneeId: 'ag_mara' }, NO_OWNER), false);
});
