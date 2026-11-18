// B-080 – what the person can reach from Work and a chat, checked on the components' source (the unit tests have no
// DOM): a chat's task status line opens the task (same text and time); a step's text opens the step, its circle stays
// the toggle, and a step's detail names its task, both opening where the detail lies (the side pane keeps its own) –
// a pointer and a hover underline show it; Work's search asks tasks.list once per query change (finished tasks
// and steps too, older answers dropped, no wait); the report shows its first REPORT_MAX lines and "Show all (N)"; a
// result's evidence opens; a message's files are first in its menu (Open, and on the desktop Show in folder); the
// pane's file tab wraps long lines and keeps in step by fraction.
// Owns: these assertions only. Never: renders.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/ui');
const source = (name: string): string => readFileSync(path.join(UI, name), 'utf8');

test('a task status line in a chat is a button that opens the task; other status lines stay quiet rows', () => {
  const item = source('chat/MessageItem.tsx');
  assert.match(item, /status\?\.type\.startsWith\('task_'\)/, 'only task_* lines');
  assert.match(item, /const id = status\.details\?\.taskId;\s*return typeof id === 'string' && id \? id : message\.taskId;/, 'details.taskId, else the message\'s own');
  assert.match(item, /<button type="button" class=\{`\$\{kind\} open`\}[^>]*onClick=\{\(\) => openTaskDetail\(taskId\)\}>\{parts\}<\/button>/);
  assert.match(item, /if \(!taskId\) return <div class=\{kind\}[^>]*>\{parts\}<\/div>;/, 'the same text and time either way');
  assert.equal((item.match(/<StatusLineRow /g) ?? []).length, 1, 'one shape: a burst of one line and of many render their lines alike');
});

test('a step\'s text opens the step\'s detail, its circle stays the toggle; a step\'s detail names its task', () => {
  const steps = source('tasks/StepList.tsx');
  assert.match(steps, /class="step-text step-open" role="button" tabIndex=\{0\}/);
  assert.match(steps, /onClick=\{\(\) => onOpen\(step\.id\)\}/);
  assert.match(steps, /const open = props\.onOpen \?\? openTaskDetail;/, "Work's route unless the detail says where");
  assert.match(steps, /class="step-toggle" role="checkbox"/, 'the toggle is its own control');
  const detail = source('tasks/TaskDetail.tsx');
  const hook = detail.indexOf('useTask(task?.parentId)');
  assert.ok(hook > 0 && hook < detail.indexOf('if (!task)'), 'the parent hook runs before the early return');
  assert.match(detail, /const open = props\.onOpen \?\? selectTask;/);
  assert.match(detail, / · Part of: <button type="button" class="text-button inline" onClick=\{\(\) => open\(task\.parentId!\)\}>/);
  assert.match(detail, /<StepList task=\{task\} onOpen=\{open\} \/>/, 'a step opens where this detail lies');
  assert.match(source('tasks/WorkIndex.tsx'), /<TaskDetail [^\n]*onOpen=\{setSelected\} \/>/, 'in the side pane: its own detail, the main view stays');
});

test('the task line and the step text show they open: a pointer and a hover underline, no box change', () => {
  const chat = readFileSync(path.join(UI, 'styles', 'chat.css'), 'utf8');
  assert.match(chat, /\.status-line\.open:hover > span:not\(\.status-count\) \{ text-decoration: underline; text-underline-offset: 3px; \}/);
  const tasks = readFileSync(path.join(UI, 'styles', 'tasks.css'), 'utf8');
  assert.match(tasks, /\.step-open \{ cursor: pointer; text-align: left; \}/);
  assert.match(tasks, /\.step-open:hover \.step-title \{ text-decoration: underline; text-underline-offset: 3px; \}/);
  assert.match(tasks, /\.step-row\.done \.step-open:hover \.step-title \{ text-decoration-line: line-through underline; \}/, 'a done step keeps its strike');
});

test('Work\'s search asks tasks.list once per query change – every task, steps too – and keeps only the newest answer', () => {
  const view = source('tasks/TasksView.tsx');
  assert.match(view, /rpc\.call\('tasks\.list', \{ search: q, includeSteps: true, limit: 50, \.\.\.narrowed \}\)/);
  assert.match(view, /const ask = \+\+searchSeq;[^]*if \(ask === searchSeq\) setHits/, 'an older answer is dropped');
  assert.doesNotMatch(view, /setTimeout|debounce/, 'no wait before the call');
  assert.match(view, /searchRows\(local, hits, tasks\.value, shown, scope\)/, 'the open matches stay, the hits join under them');
  assert.match(view, /inMyChat\b[^]*chatSection\(chat\) === 'main'/, 'his own chats: the main section');
  for (const name of ['tasks/TasksView.tsx', 'tasks/WorkIndex.tsx']) assert.match(source(name), /max: Number\.POSITIVE_INFINITY/, `${name}: every report line`);
});

test('the report shows REPORT_MAX lines and "Show all (N)" under the paragraph; My day passes its three lines', () => {
  const regions = source('tasks/WorkRegions.tsx');
  assert.match(regions, /const visible = props\.limit \?\? REPORT_MAX;/);
  assert.match(regions, /<\/p>\s*\{more && <button type="button" class="text-button your-tasks-more work-report-more"/, 'under the paragraph');
  assert.match(regions, /\{all \? 'Show less' : `Show all \(\$\{props\.lines\.length\}\)`\}/);
  assert.doesNotMatch(source('day/DayOverview.tsx'), /<WorkReport[^>]*limit=/, 'My day keeps its own three lines');
});

test('a result\'s evidence chips open a link, or a path where it is (B-081 path-links: the agent\'s home PC first)', () => {
  const result = source('tasks/ResultView.tsx');
  assert.match(result, /evidenceTarget\(item\.ref\)/);
  assert.match(result, /openLink\(target\.ref\);\s*else void openPathLink\(target\.ref, props\.agentId\);/);
  assert.match(result, /<EvidenceChips items=\{result\.evidence\} agentId=\{task\.assigneeId\} \/>/);
  assert.doesNotMatch(result, /result\.verification|shield-check/, 'still no verification mark');
});

test('a message\'s files come first in its menu: Open <name>, and on the desktop Show <name> in folder', () => {
  const actions = source('chat/MessageActions.tsx');
  assert.match(actions, /label: `Open \$\{attachment\.name\}`, onSelect: \(\) => openAttachment\(attachment, message\.conversationId\)/);
  assert.match(actions, /const reveal = platform === 'desktop' && can\('files\.open'\);/);
  assert.match(actions, /label: `Show \$\{attachment\.name\} in folder`, onSelect: \(\) => showAttachment\(attachment\)/);
  assert.match(actions, /return files\.length \? \[\{ items: files \}, \{ items \}\] : \[\{ items \}\];/);
  const attachments = source('chat/Attachments.tsx');
  assert.match(attachments, /export function openAttachment\(/);
  assert.match(attachments, /export function showAttachment\(attachment: Attachment\): void \{\s*rpc\.call\('files\.open', \{ id: attachment\.fileId, reveal: true \}\)\.catch/);
});

test('the pane\'s file tab wraps a long line and keeps in step by fraction', () => {
  const view = source('workspace/FileView.tsx');
  assert.match(view, /wrap="soft"/);
  assert.match(view, /useScrollPosition\(id, area, state\.phase === 'text' \? state\.revision : -1, false\)/);
  const css = readFileSync(path.join(UI, 'styles', 'file-tab.css'), 'utf8');
  assert.match(css, /\.file-field \{[^}]*white-space: pre-wrap; overflow-wrap: anywhere;/);
});
