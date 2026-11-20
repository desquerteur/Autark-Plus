// #20: the Schedules tab's main zone. Without a selection: what schedules are and three starting points (a daily job that
// sends its result to a contact, a message for later, a weekly reminder). With #/schedules/new: the form. With a
// schedule: its page – what it does, its rule, the next runs, Pause/Resume, Run now, Edit, Delete – and the history of its
// past runs (ran, run now, skipped, failed, ended). Kept fresh by the schedule events (tasks/schedules.ts).
// Owns: these pages. Never: timing (the runtime scheduler fires) or the rule form (ScheduleEditor.tsx).

import { useEffect, useState } from 'preact/hooks';
import type { Schedule } from '../../shared/model/tasks.ts';
import { Header, backCell } from '../lib/header.tsx';
import { go } from '../lib/router.ts';
import { isMobile } from '../lib/platform.ts';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { agentName, conversationMap } from '../lib/store.ts';
import { chatTitle } from '../lib/chat-face.tsx';
import { fullDate } from '../lib/format.ts';
import { toastError } from '../lib/toasts.ts';
import { Button, Icon, Spinner } from '../lib/ui.tsx';
import { whenText } from '../chat/details/Schedules.tsx';
import { selectTask } from '../tasks/jump.ts';
import { ensureSchedules, deleteSchedule, schedules, schedulesLoaded, setScheduleActive } from '../tasks/schedules.ts';
import { ScheduleEditor } from './ScheduleEditor.tsx';
import type { Preset } from './ScheduleEditor.tsx';
import { KIND_ICON, nextText, ruleOf } from './SchedulesNav.tsx';
import { editable, KIND_LABEL, outcomeText } from './schedules-model.ts';

const PRESETS: Array<{ title: string; text: string; preset: Preset }> = [
  {
    title: 'Daily news to a contact', text: 'Every day at 06:00 an agent thinks about the news of the day and sends them to a chat.',
    preset: { draft: { type: 'job', title: 'Daily news', body: 'Think about today’s news in my field, pick the five that matter most and write a short summary with one line on why each matters.' }, form: { kind: 'repeat', repeat: 'days', clock: '06:00' } },
  },
  { title: 'A message for later', text: 'Post a message into a chat at a set time – once, or on repeat.', preset: { draft: { type: 'message' }, form: { kind: 'once' } } },
  { title: 'A weekly reminder', text: 'Wake an agent every Monday morning with a note to itself.', preset: { draft: { type: 'reminder', title: 'Weekly check', body: 'Look at last week’s open work and tell me what is stuck.' }, form: { kind: 'repeat', repeat: 'days', clock: '09:00', days: [1] } } },
];

/** The preset picked on the start page, handed to the form (kept out of the URL). */
let pending: Preset | undefined;

function Top(props: { title: string; cells?: Parameters<typeof Header>[0]['cells']; back?: boolean }) {
  const lead = isMobile.value && props.back ? backCell(() => go.schedule()) : undefined;
  if (isMobile.value && !props.back) return null; // the tab's own top row says "Schedules"
  return <Header zone="main" title={props.title} lead={lead} cells={props.cells} />;
}

function Start() {
  return (
    <div class="schedules-view">
      <Top title="Schedules" cells={can('schedules.create') ? [{ id: 'add', icon: 'plus', label: 'New schedule', onClick: () => go.schedule('new') }] : []} />
      <div class="schedules-scroll">
        <div class="schedules-intro">
          <h1 class="schedules-title">Schedules</h1>
          <p class="schedules-lead">Let agents work on a clock: a job every morning, a message at a set time, a reminder that comes back. Runs missed while the PC was off happen once when it is back on.</p>
          {can('schedules.create') && <Button variant="primary" icon="plus" onClick={() => go.schedule('new')}>New schedule</Button>}
        </div>
        {can('schedules.create') && (
          <div class="schedules-cards">
            {PRESETS.map((entry) => (
              <button key={entry.title} type="button" class="schedule-card" onClick={() => { pending = entry.preset; go.schedule('new'); }}>
                <span class="schedule-card-name">{entry.title}</span>
                <span class="schedule-card-text">{entry.text}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function New() {
  const [preset] = useState(() => { const taken = pending; pending = undefined; return taken; });
  return (
    <div class="schedules-view">
      <Top title="New schedule" back />
      <div class="schedules-scroll"><div class="schedules-form"><ScheduleEditor preset={preset} onDone={(saved) => go.schedule(saved?.id)} /></div></div>
    </div>
  );
}

/** The next runs of a schedule, from the runtime's own calculation (an unanchored interval runs from its next run). */
function useNextRuns(schedule: Schedule): number[] {
  const [times, setTimes] = useState<number[]>([]);
  const key = JSON.stringify([schedule.spec, schedule.active, schedule.nextAt, schedule.runs]);
  useEffect(() => {
    if (!schedule.active || schedule.nextAt === undefined) { setTimes([]); return; }
    let alive = true;
    const spec = schedule.spec.everyMs !== undefined && schedule.spec.at === undefined ? { ...schedule.spec, at: schedule.nextAt } : schedule.spec;
    rpc.call('schedules.preview', { spec, count: 5, runs: schedule.runs }).then(({ times: next }) => { if (alive) setTimes(next); }, () => { if (alive) setTimes([schedule.nextAt!]); });
    return () => { alive = false; };
  }, [key]);
  return times;
}

function Detail(props: { schedule: Schedule }) {
  const { schedule } = props;
  const [editing, setEditing] = useState(false);
  const [running, setRunning] = useState(false);
  const upcoming = useNextRuns(schedule);
  const history = (schedule.history ?? []).slice().reverse();
  const owner = schedule.ownerId === 'human' ? 'You' : agentName(schedule.ownerId);
  const chat = schedule.conversationId ? conversationMap.value.get(schedule.conversationId) : undefined;
  const manage = can('schedules.update');

  const runNow = async () => {
    setRunning(true);
    try { await rpc.call('schedules.runNow', { id: schedule.id }); } catch (error) { toastError(error, 'Could not run it now'); } finally { setRunning(false); }
  };
  const remove = async () => { await deleteSchedule(schedule); if (!schedules.peek().some((entry) => entry.id === schedule.id)) go.schedule(); };

  if (editing) {
    return (
      <div class="schedules-view">
        <Top title="Edit schedule" back />
        <div class="schedules-scroll"><div class="schedules-form"><ScheduleEditor schedule={schedule} onDone={() => setEditing(false)} /></div></div>
      </div>
    );
  }
  return (
    <div class="schedules-view">
      <Top title={schedule.title} back />
      <div class="schedules-scroll">
        <div class="schedules-detail">
          <div class="schedule-head">
            <Icon name={KIND_ICON[schedule.kind]} size={20} class="schedule-item-icon" />
            <div class="schedule-head-text">
              <h1 class="schedules-title">{schedule.title}</h1>
              <p class="schedule-sub">{KIND_LABEL[schedule.kind]} · {owner}{chat ? ` · to ${chatTitle(chat)}` : ''}{schedule.payload.priority === 'important' ? ' · Important' : ''}</p>
            </div>
          </div>
          <div class="schedule-actions">
            {manage && <Button icon={schedule.active ? 'pause' : 'play'} onClick={() => void setScheduleActive(schedule, !schedule.active)}>{schedule.active ? 'Pause' : 'Resume'}</Button>}
            {can('schedules.runNow') && <Button icon="arrow-clockwise" busy={running} onClick={() => void runNow()}>Run now</Button>}
            {manage && editable(schedule) && <Button icon="pencil-simple" onClick={() => setEditing(true)}>Edit</Button>}
            {can('schedules.delete') && <Button icon="trash" onClick={() => void remove()}>Delete</Button>}
          </div>

          <dl class="schedule-facts">
            <dt>Rule</dt><dd>{ruleOf(schedule)}</dd>
            <dt>Status</dt><dd>{nextText(schedule)}{schedule.pausedBy === 'human' ? ' (paused by you)' : schedule.pausedBy ? ' (paused by an agent)' : ''}</dd>
            <dt>Runs</dt><dd class="tabular">{schedule.runs}{schedule.spec.maxRuns !== undefined ? ` of ${schedule.spec.maxRuns}` : ''}{schedule.lastAt ? ` · last ${fullDate(schedule.lastAt)}` : ''}</dd>
          </dl>

          {schedule.kind !== 'message' && (schedule.payload.taskTemplate?.notes ?? schedule.payload.note) && (
            <section class="schedule-section"><h2 class="schedule-heading">{schedule.kind === 'routine' ? 'Instructions' : 'Note'}</h2><p class="schedule-text">{schedule.payload.taskTemplate?.notes ?? schedule.payload.note}</p></section>
          )}
          {schedule.kind === 'message' && schedule.payload.body && <section class="schedule-section"><h2 class="schedule-heading">Message</h2><p class="schedule-text">{schedule.payload.body}</p></section>}

          <section class="schedule-section" aria-label="Next runs">
            <h2 class="schedule-heading">Next runs</h2>
            {upcoming.length ? <ul class="schedule-runs">{upcoming.map((at) => <li key={at} class="tabular" title={fullDate(at)}>{whenText(at)} <span class="schedule-run-full">{fullDate(at)}</span></li>)}</ul>
              : <p class="schedule-note">{schedule.active ? 'No further runs.' : 'Paused or finished – nothing is planned.'}</p>}
          </section>

          <section class="schedule-section" aria-label="History">
            <h2 class="schedule-heading">History</h2>
            {history.length ? (
              <ul class="schedule-runs">
                {history.map((run) => (
                  <li key={`${run.at}:${run.firedAt}`} class={`schedule-run ${run.outcome}`}>
                    <span class="tabular" title={`Planned ${fullDate(run.at)}`}>{fullDate(run.firedAt)}</span>
                    <span class="schedule-run-outcome">{outcomeText(run)}</span>
                    {run.taskId && <button type="button" class="text-button schedule-run-task" onClick={() => selectTask(run.taskId!)}>{run.outcome === 'skipped' ? 'Open task' : 'Task'}</button>}
                  </li>
                ))}
              </ul>
            ) : <p class="schedule-note">No runs yet.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

export function SchedulesPage(props: { id?: string }) {
  useEffect(() => { ensureSchedules(); }, []);
  if (!props.id) return <Start />;
  if (props.id === 'new') return can('schedules.create') ? <New /> : <Start />;
  const schedule = schedules.value.find((entry) => entry.id === props.id);
  if (!schedule) {
    return (
      <div class="schedules-view">
        <Top title="Schedule" back />
        <div class="schedules-scroll">{schedulesLoaded.value ? <p class="schedule-note schedules-missing">This schedule is gone. <button type="button" class="link" onClick={() => go.schedule()}>Back to Schedules</button></p> : <Spinner />}</div>
      </div>
    );
  }
  return <Detail key={schedule.id} schedule={schedule} />;
}

