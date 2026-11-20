// #20: the Schedules tab's sidebar – every schedule (agent jobs, scheduled messages, reminders, timers) with its rule in
// words and its next run; a paused one is dimmed. "+" opens the new-schedule form. The header data (schedulesNavHeader) is
// drawn by the frame (shell/views.ts); on the phone this list is the tab's root.
// Owns: the rows and the add button. Never: builds rules (chat/composer/schedule-form.ts) or fires anything.

import { useEffect } from 'preact/hooks';
import type { Schedule } from '../../shared/model/tasks.ts';
import type { HeaderProps } from '../lib/header.tsx';
import { Icon, Spinner } from '../lib/ui.tsx';
import type { IconName } from '../lib/ui.tsx';
import { route, go } from '../lib/router.ts';
import { can } from '../lib/session.ts';
import { agentName } from '../lib/store.ts';
import { DESTINATIONS } from '../lib/vocab.ts';
import { whenText } from '../chat/details/Schedules.tsx';
import { localZone } from '../chat/composer/schedule-mode.ts';
import { repeats, ruleLine } from '../chat/composer/schedule-rule.ts';
import { ensureSchedules, schedules, schedulesLoaded } from '../tasks/schedules.ts';
import { sortSchedules } from './schedules-model.ts';

export const KIND_ICON: Record<Schedule['kind'], IconName> = { routine: 'arrow-clockwise', message: 'chat-text', reminder: 'bell', timer: 'clock' };

export function schedulesNavHeader(): HeaderProps {
  return { title: DESTINATIONS.schedules, cells: can('schedules.create') ? [{ id: 'add', icon: 'plus', label: 'New schedule', onClick: () => go.schedule('new') }] : [] };
}

/** "Every day at 06:00" for a rule that repeats, else the one run's time. */
export function ruleOf(schedule: Schedule): string {
  const tz = schedule.spec.tz || localZone();
  return repeats(schedule.spec) ? ruleLine(schedule.spec, { tz }) : schedule.nextAt ? `Once · ${whenText(schedule.nextAt)}` : 'Once';
}

export function nextText(schedule: Schedule): string {
  if (!schedule.active) return schedule.nextAt === undefined && !schedule.pausedBy && schedule.runs > 0 ? 'Finished' : 'Paused';
  return schedule.nextAt ? `Next ${whenText(schedule.nextAt)}` : 'No next run';
}

function Row(props: { schedule: Schedule; open: boolean }) {
  const { schedule } = props;
  const owner = schedule.ownerId === 'human' ? undefined : agentName(schedule.ownerId);
  return (
    <button type="button" class={`schedule-item${props.open ? ' active' : ''}${schedule.active ? '' : ' is-paused'}`} aria-current={props.open ? 'page' : undefined} onClick={() => go.schedule(schedule.id)}>
      <Icon name={KIND_ICON[schedule.kind]} size={16} class="schedule-item-icon" />
      <span class="schedule-item-text">
        <span class="row-title">{schedule.title}</span>
        <span class="row-preview">{ruleOf(schedule)}</span>
        <span class="row-preview tabular">{nextText(schedule)}{owner ? ` · ${owner}` : ''}</span>
      </span>
    </button>
  );
}

export function SchedulesNav() {
  useEffect(() => { ensureSchedules(); }, []);
  const current = route.value;
  const openId = current.view === 'schedules' ? current.id : undefined;
  const list = sortSchedules(schedules.value);
  return (
    <div class="sidebar-section schedules-nav" data-tour="schedule-list">
      {list.map((schedule) => <Row key={schedule.id} schedule={schedule} open={schedule.id === openId} />)}
      {!schedulesLoaded.value && !list.length && <div class="projects-loading"><Spinner /></div>}
      {schedulesLoaded.value && !list.length && <p class="empty-state schedules-nav-empty">Nothing scheduled yet. Use + to set up a daily job, a message or a reminder.</p>}
    </div>
  );
}
