// What stands under My day's list, today only, each left out while it is empty: Ahead today (`calendar`: the pane's column
// has no calendar beside it; events still ahead, a click opens the full My day), then two lines (17.11.2026: less on the
// page) – "Chats that matter: Lena (2 open) · Launch plan (3 unread)", at most three (important-chats.ts; a name opens
// the chat, at the waiting to-do's message), and "What the team did today · $6.10 spent · Open Work" while the team's
// report (day-overview.ts dayReport) has something since last evening or the agents spent money then. Beside a chat Work
// opens as the pane's tab, so the chat stays; a phone goes to the Work view. Every line shows only what this connection
// may read. Time windows move by themselves: everything is read at the later of the day, For-you and Work clocks.
// Owns: these blocks' markup. Never: ranks chats, decides what is stuck, or copies tasks.

import type { ComponentChildren } from 'preact';
import { useEffect, useId } from 'preact/hooks';
import type { ConversationSummary } from '../../shared/model/chat.ts';
import { lastEvening } from '../../shared/model/day-settings.ts';
import type { SpendEntry } from '../../shared/model/security.ts';
import type { TaskView } from '../../shared/model/tasks.ts';
import { liveRuns, workingIds } from '../chat/live-text.ts';
import { chatTitle } from '../lib/chat-face.tsx';
import { briefing, dayClock, dayRange, dayZone } from '../lib/day-store.ts';
import { isPersonSession } from '../lib/people.ts';
import { go, navigate } from '../lib/router.ts';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { activity, agentName, conversations, isMobile, settings, todoClock, todos } from '../lib/store.ts';
import { useAsync } from '../settings/controls.tsx';
import { chatRouteAllowed } from '../shell/gates.ts';
import { doneTasks, ensureDone } from '../tasks/done-store.ts';
import { jumpToMessage, useWorkClock } from '../tasks/jump.ts';
import { DAY_MS, REPORT_DAYS } from '../tasks/model.ts';
import { openPanel } from '../workspace/pages.ts';
import { briefingFor } from './day-briefing.ts';
import { clockOf } from './day-grid.ts';
import { dayReport, eventsAhead, OVERVIEW_LIMITS, spentText } from './day-overview.ts';
import { nextToday } from './DayNext.tsx';
import { ensureCalendar, eventsOn, shownDate, today, watchSources } from './day-state.ts';
import { chatNote, importantChats, type ImportantChat } from './important-chats.ts';

function Block(props: { heading: string; children: ComponentChildren }) {
  const id = useId();
  return (
    <section class="day-group day-over" aria-labelledby={id}>
      <h3 class="day-group-heading" id={id}>{props.heading}</h3>
      {props.children}
    </section>
  );
}

const openWork = () => { if (isMobile.peek()) go.tasks(); else openPanel({ kind: 'work' }); };

function AheadToday(props: { date: string; now: number }) {
  const tz = dayZone.value;
  useEffect(() => watchSources(), []);
  useEffect(() => { void ensureCalendar(props.date); }, [props.date]);
  const shown = nextToday(props.date, props.now, tz); // the card above already names this one (a to-do's own block is not listed here)
  const ahead = eventsAhead(eventsOn(props.date, tz).map((entry) => entry.event), props.now)
    .filter((event) => !(shown && !shown.task && shown.startAt === event.startAt && shown.title === (event.title ?? '')));
  if (!ahead.length) return null;
  const more = ahead.length - OVERVIEW_LIMITS.ahead;
  return (
    <Block heading="Ahead today">
      <ul class="day-over-list">
        {ahead.slice(0, OVERVIEW_LIMITS.ahead).map((event) => (
          <li key={event.id}>
            <button type="button" class="day-over-event" onClick={() => go.day()}>
              <time class="day-over-time tabular">{clockOf(event.startAt, tz)}</time>
              <span class="day-over-title">{event.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {more > 0 && <button type="button" class="text-button day-over-more" onClick={() => go.day()}>{more} more today</button>}
    </Block>
  );
}

/** One chat in the line: its name opens it (at the waiting to-do's message), its few words after it. */
function ChatLink(props: { row: ImportantChat<ConversationSummary, TaskView> }) {
  const { chat, todo } = props.row;
  const open = () => {
    if (todo?.messageId && todo.conversationId === chat.id) void jumpToMessage(chat.id, todo.messageId);
    else navigate({ view: 'chat', id: chat.id });
  };
  const note = chatNote(props.row);
  return (
    <span class="day-over-chat">
      <button type="button" class="day-over-link" title={props.row.reason} onClick={open}>{chatTitle(chat)}</button>
      {note && <span class="tabular"> ({note})</span>}
    </span>
  );
}

function TeamLine(props: { now: number; since: number }) {
  const { now, since } = props;
  useEffect(() => { void ensureDone({ since: now - REPORT_DAYS * DAY_MS }).catch(() => undefined); }, []); // not loaded: no line yet
  const runs = activity.value.map((entry) => entry.runId).sort().join(' '); // money: read again when a run starts or ends, never polled
  const mayMoney = can('spend.list');
  const money = useAsync<SpendEntry[]>(() => (mayMoney ? rpc.call('spend.list', { since }) : Promise.resolve([])), [since, mayMoney, runs]);
  const spent = spentText(money.data ?? []);
  const worked = dayReport(doneTasks.value, now, { keepOwn: isPersonSession() }).some((line) => line.at >= since);
  if (!worked && !spent) return null;
  return (
    <p class="day-over-line day-over-team">
      <span>What the team did today</span>
      {spent && <span class="tabular"> · {spent}</span>}
      {' · '}<button type="button" class="day-over-link" onClick={openWork}>Open Work</button>
    </p>
  );
}

/** Who works in a chat, named as its header does (its live bar, split parts folded into their group). */
const workingOf = (chat: Pick<ConversationSummary, 'id' | 'working' | 'live'>) => workingIds(chat, liveRuns(chat));

export function DayOverview(props: { calendar?: boolean }) {
  const workNow = useWorkClock();
  const now = Math.max(dayClock.value, todoClock.value, workNow);
  const date = today.value;
  if (shownDate.value !== date) return null; // another day of My day: these say what is now
  const tz = dayZone.value;
  const chats = chatRouteAllowed() ? importantChats(conversations.value, {
    todos: todos.value, briefing: briefingFor(briefing.value, date)?.chats, now, dayEnd: dayRange(date, tz).to, nameOf: agentName,
    workingOf,
  }) : [];
  return (
    <>
      {props.calendar && can('calendar.list') && <AheadToday date={date} now={now} />}
      {chats.length > 0 && (
        <p class="day-over-line day-over-chats">
          <span>Chats that matter: </span>
          {chats.map((row, index) => <span key={row.chat.id}>{index > 0 && ', '}<ChatLink row={row} /></span>)}
        </p>
      )}
      {can('tasks.list') && <TeamLine now={now} since={lastEvening(now, tz, settings.value?.day?.workEnd)} />}
    </>
  );
}
