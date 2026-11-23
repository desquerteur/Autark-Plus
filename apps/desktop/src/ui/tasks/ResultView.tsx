// The documentation of a finished task (T6, concept 26): its finish time, the summary, "Also handled …" (the
// team's report lines – Work's report collects them, work-model.ts report), the evidence the agent named and the
// follow-up chips (each schedule chip can be paused or cancelled, a task chip opens it). B-078 D10: no verification
// mark – the agent side keeps its verification; the person reads what was done. B-080 (live: 153 of 157 results of
// three days carried evidence nobody could open): each piece of evidence is a chip (its ref as the tooltip) – a link
// opens in the browser, an absolute path through path-links.ts (B-081: on the task's agent's home PC first, then this
// PC – a folder, media or file tab; a gone path its not-found tab); anything else stays a quiet static chip.
// Owns: result rendering, the evidence chips and the follow-up actions. Never: shows unverified work as verified.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Evidence, TaskResult, TaskView } from '../../shared/model/tasks.ts';
import { Chip, Icon, Menu } from '../lib/ui.tsx';
import type { IconName, MenuSection } from '../lib/ui.tsx';
import { openLink } from '../blocks/host.ts';
import { openPathLink } from '../workspace/path-links.ts';
import { toastError } from '../lib/toasts.ts';
import { listTime, fullDate } from '../lib/format.ts';
import { Markdown } from '../blocks/markdown.tsx';
import { ensureSchedules, scheduleMenu, schedules, schedulesLoaded } from './schedules.ts';
import { fetchTask } from './task-cache.ts';
import { openTask } from './jump.ts';
import { evidenceTarget } from './work-model.ts';

function ScheduleChip(props: { scheduleId: string; label: string }) {
  const ref = useRef<HTMLSpanElement>(null); // menu anchor (Chip itself does not forward refs)
  const [open, setOpen] = useState(false);
  useEffect(() => { ensureSchedules(); }, []);
  const item = schedules.value.find((entry) => entry.id === props.scheduleId);
  const sections: MenuSection[] = item ? scheduleMenu(item) : [];
  const gone = schedulesLoaded.value && !item; // finished or cancelled schedules no longer exist
  return (
    <span class="followup-anchor" ref={ref}>
      <Chip class={`followup-chip${gone ? ' ended' : ''}${item && !item.active ? ' paused' : ''}`}
        title={item?.nextAt ? `Next: ${fullDate(item.nextAt)}` : gone ? 'Ended' : undefined}
        disabled={gone} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {props.label}{item && !item.active ? ' · paused' : ''}
      </Chip>
      <Menu anchor={ref.current} open={open && sections.length > 0} onClose={() => setOpen(false)} sections={sections} placement="bottom-start" label={props.label} />
    </span>
  );
}

function TaskChip(props: { taskId: string; label: string }) {
  const open = async () => {
    try {
      const task = await fetchTask(props.taskId);
      if (task) openTask(task);
    } catch (error) { toastError(error, "Couldn't open the task"); }
  };
  return <Chip class="followup-chip" onClick={() => void open()}>{props.label}</Chip>;
}

function FollowUps(props: { items: NonNullable<TaskResult['followUps']> }) {
  return (
    <div class="task-followups" aria-label="Follow-ups">
      {props.items.map((item, index) => item.scheduleId
        ? <ScheduleChip key={item.scheduleId} scheduleId={item.scheduleId} label={item.label} />
        : item.taskId
          ? <TaskChip key={item.taskId} taskId={item.taskId} label={item.label} />
          : <span key={index} class="chip followup-chip static"><Icon name="clock" size={15} /><span class="chip-label">{item.label}</span></span>)}
    </div>
  );
}

const EVIDENCE_ICONS: Record<Evidence['kind'], IconName> = { file: 'file-text', link: 'globe', tool: 'wrench', check: 'check', note: 'file', screenshot: 'image' };

function EvidenceChips(props: { items: Evidence[]; agentId?: string }) {
  return (
    <div class="task-followups task-evidence" aria-label="Evidence">
      {props.items.map((item, index) => {
        const target = evidenceTarget(item.ref);
        const label = item.label || item.ref || item.kind;
        if (!target) return <span key={index} class="chip followup-chip static" title={item.ref}><Icon name={EVIDENCE_ICONS[item.kind] ?? 'file'} size={15} /><span class="chip-label">{label}</span></span>;
        const open = () => {
          if (target.kind === 'link') openLink(target.ref);
          else void openPathLink(target.ref, props.agentId);
        };
        return <Chip key={index} class="followup-chip" icon={EVIDENCE_ICONS[item.kind] ?? 'file'} title={target.ref} onClick={open}>{label}</Chip>;
      })}
    </div>
  );
}

export function ResultView(props: { task: TaskView }) {
  const { task } = props;
  const result = task.result;
  if (!result) return null;
  return (
    <section class="task-result" aria-label="Result">
      {task.completedAt && (
        <div class="task-result-head">
          <span class="task-result-label">Result</span>
          <time class="muted tabular" title={fullDate(task.completedAt)}>{listTime(task.completedAt)}</time>
        </div>
      )}
      <Markdown text={result.summary} class="task-result-summary" />
      {!!result.alsoHandled?.length && (
        <div class="task-result-also">
          <span class="task-result-label">Also handled</span>
          <ul>{result.alsoHandled.map((line, index) => <li key={index}>{line}</li>)}</ul>
        </div>
      )}
      {!!result.evidence?.length && <EvidenceChips items={result.evidence} agentId={task.assigneeId} />}
      {!!result.followUps?.length && <FollowUps items={result.followUps} />}
    </section>
  );
}
