// Tasks as the agent reads them – one line format for "## My tasks", "## Given by me" and tasks.list, and the whole
// task for "## Current task" and tasks.get: state (open, waiting on whom since when and why, paused, done, dropped), due
// time, its chat, the planned next look ("I look again …", "when Felix answers" – not on the current task, whose turn
// plans it), who gave it, what it is part of (the parent's id first), done-when, notes (whole – they are bounded where
// they are written), files with their place, the plan with ✓, facts, its pieces with owner and state, and the result.
// Times in the live part's one absolute form (time.ts dueText).
// Owns: that rendering and its caps; the walk up the parents (bounded, cycle-safe).
// Never: claims verification the task row does not record, or counts turns.

import type { RuntimeServices } from '../contracts.ts';
import { HUMAN_ID } from '../../shared/ids.ts';
import { isFinished, isPaused, type Task, type TaskView } from '../../shared/model/tasks.ts';
import { excerpt } from '../../shared/text/chat-names.ts';
import { dueText } from './time.ts';
import { attachmentLines } from './render.ts';
import { namesFor, waitWords, type NoteNames } from '../tasks/next.ts';

const MAX_PIECES = 12;
const MAX_FACTS = 8;

/** Titles of the parent chain, nearest first (max 4). */
export function goalChain(services: RuntimeServices, task: Task): string[] {
  const out: string[] = [];
  const seen = new Set([task.id]);
  let parentId = task.parentId;
  while (parentId && !seen.has(parentId) && out.length < 4) {
    seen.add(parentId);
    const parent = services.tasks.get(parentId);
    if (!parent) break;
    out.push(parent.title);
    parentId = parent.parentId;
  }
  return out;
}

/** The files the task was posted with, each with its place (no file reads here; media.view/media.transcribe open them). */
function fileLines(services: RuntimeServices, task: TaskView, zone: string, now: number): string[] {
  if (!task.files?.length) return [];
  try {
    return attachmentLines({ services, agentId: task.assigneeId ?? '', humanName: '', zone, now }, task.files, undefined, false).lines;
  } catch {
    return task.files.map((file) => `[Attached file: ${file.name}] (${file.mime}, ${file.fileId})`);
  }
}

/** Its state in words: "open", "waiting on Felix since Thu 12 Nov 19:41: why", "paused by Felix", "done", "dropped". */
export function stateWords(task: Pick<Task, 'status' | 'waitingOn'>, names: NoteNames, now: number, why = true): string {
  const wait = task.waitingOn;
  if (task.status !== 'waiting' || !wait) return task.status;
  if (isPaused(task)) return `paused by ${names.nameOf(wait.who ?? HUMAN_ID)}`;
  const until = wait.until !== undefined ? ` until ${dueText(wait.until, names.zone, now)}` : '';
  return `waiting on ${waitWords(task, names)}${until} since ${dueText(wait.since, names.zone, now)}${why ? `: ${excerpt(wait.why, 120)}` : ''}`;
}

/** The planned next look in words: "I go on now", "I look again Fri 13 Nov 19:38", "when Felix answers (I look again …)". */
export function nextWords(task: Pick<Task, 'status' | 'waitingOn' | 'nextAt' | 'assigneeKind'>, names: NoteNames, now: number): string {
  if (isFinished(task.status)) return '';
  if (isPaused(task)) return 'nothing runs until it is resumed';
  const again = task.nextAt === undefined ? '' : task.nextAt <= now + 5_000 ? 'I go on now' : `I look again ${dueText(task.nextAt, names.zone, now)}`;
  if (task.assigneeKind === 'human') return task.nextAt === undefined ? 'on their list' : `on their list; ${again.replace('I look again', 'next look')}`;
  const wait = task.status === 'waiting' ? task.waitingOn : undefined;
  const event = wait?.on === 'who' ? `when ${waitWords(task, names)} answers` : wait?.on === 'task' ? 'when what it waits on ends' : '';
  if (event) return again ? `${event} (${again})` : event;
  return again || 'nothing planned';
}

/** One task as a line: "- task_… · open · due 14 Nov 09:00 · Title · I look again …"; `owner`: whose it is, when not mine. */
export function taskLine(task: TaskView, names: NoteNames, now: number, options: { owner?: boolean; mine?: string } = {}): string {
  const parts = [task.id];
  if (options.owner && task.assigneeId !== options.mine) parts.push(names.nameOf(task.assigneeId ?? HUMAN_ID));
  parts.push(stateWords(task, names, now));
  if (task.dueAt) parts.push(`due ${dueText(task.dueAt, names.zone, now)}`);
  if (task.priority > 0) parts.push(task.priority === 2 ? 'urgent' : 'high priority');
  parts.push(excerpt(task.title, 120));
  if (task.parentId) parts.push(`piece of ${task.parentId}`);
  const next = nextWords(task, names, now);
  if (next) parts.push(next);
  return `- ${parts.join(' · ')}`;
}

/** The whole task: "## Current task" (no next look – this turn plans it), else tasks.get's "## Task". */
export function renderTask(services: RuntimeServices, task: TaskView, zone: string, heading = '## Current task'): string {
  const now = services.clock.now();
  const names = namesFor(services, zone);
  const head = [task.id, stateWords(task, names, now, false)];
  if (task.priority > 0) head.push(task.priority === 2 ? 'urgent' : 'high priority');
  if (task.dueAt) head.push(`due ${dueText(task.dueAt, zone, now)}`);
  if (task.conversationId) head.push(`chat ${task.conversationId}`);
  const next = heading === '## Current task' ? '' : nextWords(task, names, now);
  if (next) head.push(`next look: ${next}`);
  const lines = [heading, head.join(' · '), `Title: ${task.title}`];
  const giver = task.assignedBy ?? task.createdBy;
  if (giver !== task.assigneeId && giver !== (task.assigneeId ?? HUMAN_ID)) lines.push(`Given by: ${names.nameOf(giver)}`);
  const chain = goalChain(services, task);
  if (chain.length) lines.push(`Part of: ${task.parentId} ${chain.map((title) => excerpt(title, 100)).join(' ← ')}`);
  if (task.doneWhen || !isFinished(task.status)) lines.push(`Done when: ${task.doneWhen || 'not set yet.'}`);
  if (task.status === 'waiting' && task.waitingOn) lines.push(`${stateWords(task, names, now)[0].toUpperCase()}${stateWords(task, names, now).slice(1)}`);
  if (task.notes.trim()) lines.push(`Notes:\n${task.notes.trim()}`);
  const files = fileLines(services, task, zone, now);
  if (files.length) lines.push(`Files:\n${files.join('\n')}`);
  const plan = task.ledger.plan ?? [];
  if (plan.length) lines.push(`Plan (${plan.filter((line) => line.startsWith('✓')).length}/${plan.length}):\n${plan.slice(0, 20).map((line) => excerpt(line, 300)).join('\n')}`);
  const facts = (task.ledger.facts ?? []).slice(-MAX_FACTS);
  if (facts.length) lines.push(`Facts:\n${facts.map((fact) => `- ${excerpt(fact, 300)}`).join('\n')}`);
  const pieces = task.steps;
  if (pieces.length) {
    lines.push(`Pieces:\n${pieces.slice(0, MAX_PIECES).map((piece) => `- ${names.nameOf(piece.assigneeId ?? HUMAN_ID)} · ${stateWords(piece, names, now, false)} · ${excerpt(piece.title, 120)} · ${piece.id}`).join('\n')}`);
    if (pieces.length > MAX_PIECES) lines.push(`(+${pieces.length - MAX_PIECES} more – tasks.list)`);
  }
  if (task.result) {
    const evidence = task.result.evidence.map((item) => item.label).slice(0, 6).join('; ');
    const note = task.result.verificationNote?.trim();
    lines.push(`Result: ${excerpt(task.result.summary, 300)} (${task.result.verification.replace(/_/g, ' ')})${evidence ? ` · evidence: ${evidence}` : ''}${note ? ` – ${note}` : ''}`);
  }
  return lines.join('\n');
}

export function currentTaskSection(services: RuntimeServices, taskId: string, zone: string): string {
  const task = services.tasks.get(taskId);
  return task ? renderTask(services, task, zone) : '';
}
