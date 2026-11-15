// Work's two regions (B-078 D10), told apart by shape, not by labels (owner 06.11.: "anderes Design … andere
// Stärke … Formen und Farben"): "For you" – large accent-bordered cards, each with the agent's question right in it
// (the same AskBlock as in the chat and on My day; without one, what the work waits on and a click to its detail) –
// and the report: one quiet prose block, no rows, of what the team handled on the side and what everyone should
// know (work-model.ts report); each sentence opens its task; B-080: the first REPORT_MAX sentences, the rest under
// "Show all (N)" below the paragraph (nothing above it moves). Between them "Your tasks": what the person handed out,
// typed on Work or said in his chats, as slim rows with one status cell (spinner while a turn works on it, check when
// done; work-model.ts yourTasks). Also the slim rows of one owner's open work and of the search.
// Owns: these regions' markup. Never: decides what needs the person or what the report says (work-model.ts does).

import { useState } from 'preact/hooks';
import type { TaskView } from '../../shared/model/tasks.ts';
import { AskBlock } from '../blocks/AskBlock.tsx';
import { agentName } from '../lib/store.ts';
import { listTime, plainPreview } from '../lib/format.ts';
import { useContextMenu } from '../lib/context-menu.tsx';
import { WORK_REGIONS } from '../lib/vocab.ts';
import { askTargetOf } from './model.ts';
import { openQuestions } from './center-model.ts';
import { OwnerBadge, StatusGlyph } from './parts.tsx';
import { TaskRow } from './TaskRow.tsx';
import { taskMenu } from './task-menu.ts';
import { REPORT_MAX, YOUR_TASKS_VISIBLE } from './work-model.ts';
import type { ReportLine, YourStatus, YourTask } from './work-model.ts';

/** One card: owner and title (a click opens the detail), then the question to answer right here. */
function ForYouCard(props: { task: TaskView; selected: boolean; onSelect: (id: string) => void }) {
  const { task } = props;
  const questions = openQuestions(task.steps);
  const menu = useContextMenu(() => taskMenu(task));
  const owner = task.assigneeId ? agentName(task.assigneeId) : '';
  return (
    <li class={`foryou-card${props.selected ? ' selected' : ''}`} {...menu}>
      <button type="button" class="foryou-card-head" aria-current={props.selected ? 'true' : undefined} onClick={() => props.onSelect(task.id)}>
        <OwnerBadge task={task} size={28} working={task.running} interactive={false} />
        <span class="foryou-card-text">
          <span class="foryou-card-title">{task.title}</span>
          <span class="foryou-card-meta">{[owner, task.waitingOn?.why ? plainPreview(task.waitingOn.why, 120) : ''].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
      {questions.map((step) => (
        <div key={step.id} class="foryou-card-ask">
          <AskBlock block={step.widget!} target={askTargetOf(step)} bare />
        </div>
      ))}
    </li>
  );
}

export function ForYouCards(props: { list: TaskView[]; selected: string | null; onSelect: (id: string) => void }) {
  if (!props.list.length) return null;
  return (
    <section class="foryou" aria-label={WORK_REGIONS.forYou}>
      <ul class="foryou-cards">
        {props.list.map((task) => <ForYouCard key={task.id} task={task} selected={task.id === props.selected} onSelect={props.onSelect} />)}
      </ul>
    </section>
  );
}

const YOUR_LABELS: Record<YourStatus, string> = { working: 'Working now', done: 'Done', dropped: 'Dropped', needs_you: 'Needs you', open: 'Open' };

/** One handed-out task: the status cell (spinner while a turn works on it, check when done) is reserved on the left. */
function YourRow(props: { entry: YourTask<TaskView>; selected: boolean; now: number; onSelect: (id: string) => void }) {
  const { task, status } = props.entry;
  const menu = useContextMenu(() => taskMenu(task));
  const finished = status === 'done' || status === 'dropped';
  const owner = task.assigneeId ? agentName(task.assigneeId) : 'Team';
  return (
    <li {...menu}>
      <button type="button" class={`your-row${props.selected ? ' selected' : ''}${status === 'dropped' ? ' dropped' : ''}${finished ? ' finished' : ''}`}
        data-state={status} data-task-id={task.id} aria-current={props.selected ? 'true' : undefined} onClick={() => props.onSelect(task.id)}>
        <StatusGlyph status={status} running={status === 'working'} size={18} label={YOUR_LABELS[status]} />
        <span class="your-row-title">{task.title}</span>
        <span class="your-row-owner">{owner}</span>
        <span class="your-row-time tabular">{listTime(finished ? (task.completedAt ?? task.updatedAt) : task.updatedAt, props.now)}</span>
      </button>
    </li>
  );
}

/** The person's handed-out tasks (work-model.ts yourTasks): slim rows, newest first, the first YOUR_TASKS_VISIBLE until "Show all". */
export function YourTasks(props: { list: Array<YourTask<TaskView>>; selected: string | null; now: number; onSelect: (id: string) => void }) {
  const [all, setAll] = useState(false);
  if (!props.list.length) return null;
  const shown = all ? props.list : props.list.slice(0, YOUR_TASKS_VISIBLE);
  const more = props.list.length - YOUR_TASKS_VISIBLE;
  return (
    <section class="your-tasks" aria-label={WORK_REGIONS.yours}>
      <h3 class="your-tasks-heading">{WORK_REGIONS.yours}</h3>
      <ul class="your-rows">
        {shown.map((entry) => <YourRow key={entry.task.id} entry={entry} selected={entry.task.id === props.selected} now={props.now} onSelect={props.onSelect} />)}
      </ul>
      {more > 0 && <button type="button" class="text-button your-tasks-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all (${props.list.length})`}</button>}
    </section>
  );
}

/** A line as a sentence: ends with a full stop unless it already ends with one. */
const sentence = (text: string): string => (/[.!?…:]$/.test(text) ? text : `${text}.`);

/**
 * The report: one quiet paragraph; each sentence opens its task. B-080: the first `limit` (REPORT_MAX) sentences, the
 * rest behind "Show all (N)" / "Show less" under the paragraph, as Your tasks does – no line of the window is left out.
 */
export function WorkReport(props: { lines: Array<ReportLine<TaskView>>; now: number; onSelect: (id: string) => void; limit?: number }) {
  const [all, setAll] = useState(false);
  const visible = props.limit ?? REPORT_MAX;
  const lines = all ? props.lines : props.lines.slice(0, visible);
  if (!lines.length) return null;
  const more = props.lines.length > visible;
  return (
    <section class="work-report" aria-label={WORK_REGIONS.report}>
      <p class="work-report-text">
        {lines.map((line) => (
          <button key={line.key} type="button" class="work-report-line" title={`${line.task.title} · ${listTime(line.at, props.now)}`}
            onClick={() => props.onSelect(line.task.id)}>
            {sentence(line.text)}
          </button>
        ))}
      </p>
      {more && <button type="button" class="text-button your-tasks-more work-report-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all (${props.lines.length})`}</button>}
    </section>
  );
}

/** One owner's open work (or the search's other matches): slim muted rows. */
export function SlimRows(props: { list: TaskView[]; selected: string | null; onSelect: (id: string) => void; label: string }) {
  if (!props.list.length) return null;
  return (
    <ul class="task-rows slim" aria-label={props.label}>
      {props.list.map((task) => <TaskRow key={task.id} task={task} selected={task.id === props.selected} onSelect={props.onSelect} />)}
    </ul>
  );
}
