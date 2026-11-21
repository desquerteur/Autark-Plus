// The agent's activity log: runtime/runs/log.ts (pages of whole turns, oldest first, splits only on request), the
// runtime's own notes as lines (shared/text/run-notes.ts) and the agents.log tool's lines (tools/builtin/agents-log.ts).
// Owns: these assertions only. Never: real engines, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Journal } from '../../../src/runtime/runs/journal.ts';
import { readAgentLog } from '../../../src/runtime/runs/log.ts';
import { agentLogTools } from '../../../src/runtime/tools/builtin/agents-log.ts';
import { isSystemNote, systemNoteText, triggerLabel } from '../../../src/shared/text/run-notes.ts';
import { clock, memoryDb, recordingBus } from '../store/helpers.ts';
import { ctxFor, setup as toolSetup } from '../tools/helpers.ts';
import { agent } from '../chat/harness.ts';

function journalOn() {
  const db = memoryDb();
  const time = clock();
  return { db, time, journal: new Journal({ db, bus: recordingBus().bus, clock: time }) };
}

test('readAgentLog: the latest turns oldest first with their items; `before` pages back; splits only on request', () => {
  const { db, time, journal } = journalOn();
  for (const n of [1, 2, 3]) {
    journal.start({ id: `run_${n}`, agentId: 'ag_1', trigger: 'message' });
    journal.item(`run_${n}`, { kind: 'note', data: { text: `update ${n}`, commentary: true } });
    journal.finish(`run_${n}`, {});
    time.advance(1000);
  }
  journal.start({ id: 'run_split', agentId: 'ag_1', trigger: 'split', splitId: 'sp_1' });
  journal.start({ id: 'run_other', agentId: 'ag_2', trigger: 'message' });

  const first = readAgentLog(db, 'ag_1', { maxRuns: 2 });
  assert.deepEqual(first.runs.map((run) => run.id), ['run_2', 'run_3'], 'the newest two, oldest first, no split run');
  assert.deepEqual(first.items.map((item) => item.data.text), ['update 2', 'update 3']);
  assert.equal(typeof first.before, 'number');
  const second = readAgentLog(db, 'ag_1', { maxRuns: 2, before: first.before });
  assert.deepEqual(second.runs.map((run) => run.id), ['run_1']);
  assert.equal(second.before, undefined, 'nothing older');
  assert.deepEqual(readAgentLog(db, 'ag_1', { splits: true }).runs.map((run) => run.id), ['run_1', 'run_2', 'run_3', 'run_split']);
});

test('readAgentLog: a page holds whole turns up to its item budget, and always one', () => {
  const { db, time, journal } = journalOn();
  for (const n of [1, 2]) {
    journal.start({ id: `run_${n}`, agentId: 'ag_1', trigger: 'task' });
    for (let i = 0; i < 5; i++) journal.item(`run_${n}`, { kind: 'reasoning', data: { summary: `step ${i}` } });
    time.advance(1000);
  }
  const page = readAgentLog(db, 'ag_1', { maxItems: 6 });
  assert.deepEqual(page.runs.map((run) => run.id), ['run_2']);
  assert.equal(page.items.length, 5);
  assert.ok(page.before !== undefined);
  assert.equal(readAgentLog(db, 'ag_1', { maxItems: 1 }).runs.length, 1, 'one turn even over the budget');
});

test('run notes: the runtime\'s own notes read as lines; updates and answers are the agent\'s words, no system note', () => {
  const note = (data: Record<string, unknown>, name?: string) => ({ kind: 'note' as const, data, ...(name ? { name } : {}) });
  assert.equal(systemNoteText(note({ failover: { from: 'a', to: 'gpt-5', reason: 'limit' } })), 'Switched to gpt-5 (limit reached)');
  assert.equal(systemNoteText(note({ compacted: 'overflow', coveredSeq: 4 })), 'Context compacted (overflow)');
  assert.equal(systemNoteText(note({ steered: { lines: 2, upToSeq: 9 } })), '2 new lines reached the running turn');
  assert.equal(systemNoteText(note({ modelSet: 'in-turn', model: 'opus', from: 'sonnet' })), 'Model set to opus (was sonnet)');
  assert.equal(systemNoteText(note({ whatever: 1 }, 'Mail handling blocked')), 'Mail handling blocked');
  assert.equal(systemNoteText(note({ whatever: 1 })), 'System note');
  assert.equal(isSystemNote(note({ text: 'hi', commentary: true })), false);
  assert.equal(systemNoteText(note({ text: 'done', answer: true })), undefined);
  assert.equal(systemNoteText({ kind: 'tool_call', data: {} }), undefined);
  assert.equal(triggerLabel({ trigger: 'event', origin: { kind: 'mail', label: 'New mail in office@' } as never }), 'New mail in office@');
  assert.equal(triggerLabel({ trigger: 'child' }), 'Delegated work finished');
});

test('agents.log tool: a colleague\'s turns as lines – start, steps with outcome, words, [system], end – and the next page', async () => {
  const h = toolSetup();
  h.org.add(agent('ag_mia', 'Mia', { role: 'Researcher' }));
  const journal = new Journal({ db: h.db, bus: h.bus, clock: h.clock });
  journal.start({ id: 'run_a', agentId: 'ag_mia', trigger: 'message', conversationId: h.chat.id, model: 'opus' });
  journal.item('run_a', { kind: 'reasoning', data: { summary: '**Checking the build**\n\nI look at it.' } });
  journal.item('run_a', { kind: 'tool_call', name: 'files.read', data: { callId: 'c1', args: '{"path":"src/x.ts"}' } });
  journal.item('run_a', { kind: 'tool_result', name: 'files.read', data: { callId: 'c1', ok: false, summary: 'not found' } });
  journal.item('run_a', { kind: 'note', data: { compacted: 'overflow' } });
  journal.item('run_a', { kind: 'note', data: { text: 'Ich schaue nach.', commentary: true } });
  journal.item('run_a', { kind: 'note', data: { text: 'Fertig.', answer: true, visibility: 'public' } });
  journal.finish('run_a', { inputTokens: 1200, outputTokens: 30 });
  const [logTool] = agentLogTools;
  const out = await logTool.run({ agentId: 'mia', turns: 5 }, ctxFor(h));
  const body = out.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
  assert.ok(!out.isError, body);
  assert.match(body, /^Activity log of Mia \(Researcher, ag_mia\), oldest first:/);
  assert.match(body, /── .* · Message · chat ".*" \(.+\) · opus/);
  assert.match(body, /\d\d:\d\d Thought · Checking the build/);
  assert.match(body, /\[files\.read\] FAILED: not found/);
  assert.match(body, /\[system\] Context compacted \(overflow\)/);
  assert.match(body, /Update: Ich schaue nach\./);
  assert.match(body, /Answer \(posted\): Fertig\./);
  assert.match(body, /── Done · 0 s · 1,200 in · 30 out/);
  assert.doesNotMatch(body, /Earlier turns/, 'one page holds it all');

  const mine = await logTool.run({}, ctxFor(h));
  assert.match(mine.content.map((part) => (part.type === 'text' ? part.text : '')).join(''), /Tom \(me\) has no turns recorded yet/);
  const unknown = await logTool.run({ agentId: 'Nobody' }, ctxFor(h));
  assert.equal(unknown.isError, true);
});
