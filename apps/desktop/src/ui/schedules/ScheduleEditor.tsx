// #20: the form of a schedule – what it is (Agent job · Message · Reminder), the agent or the chat, the words, and WHEN
// (the composer's rule fields: Once, Days at a time, Interval, Advanced cron – with a preview of the next runs asked
// from the runtime). A job can send its result to a contact: pick a chat (a person, or a chat bridged to Telegram); the
// form says so when no chat bridge is connected. Creating calls schedules.create, saving an edit schedules.update.
// Owns: the fields and the one line above Save. Never: builds specs or requests (schedules-model.ts, schedule-form.ts).

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Bridge } from '../../shared/model/bridges.ts';
import type { Schedule } from '../../shared/model/tasks.ts';
import { Button } from '../lib/ui.tsx';
import { errorText, rpc } from '../lib/rpc.ts';
import { agents, conversations } from '../lib/store.ts';
import { chatTitle } from '../lib/chat-face.tsx';
import { toastError } from '../lib/toasts.ts';
import { Segmented } from '../settings/controls.tsx';
import { whenText } from '../chat/details/Schedules.tsx';
import { localZone } from '../chat/composer/schedule-mode.ts';
import { defaultForm, formFromSpec, quickPicks, scheduleSpec, todayIn, UNITS } from '../chat/composer/schedule-form.ts';
import type { ScheduleForm } from '../chat/composer/schedule-form.ts';
import { ruleWords } from '../chat/composer/schedule-rule.ts';
import { build, draftOf, emptyDraft, TYPE_HINT, TYPE_LABEL } from './schedules-model.ts';
import { readScheduleWords } from './schedule-words.ts';
import type { Draft, DraftType } from './schedules-model.ts';

const DAYS = [{ day: 1, letter: 'M', name: 'Monday' }, { day: 2, letter: 'T', name: 'Tuesday' }, { day: 3, letter: 'W', name: 'Wednesday' },
  { day: 4, letter: 'T', name: 'Thursday' }, { day: 5, letter: 'F', name: 'Friday' }, { day: 6, letter: 'S', name: 'Saturday' }, { day: 0, letter: 'S', name: 'Sunday' }];

/** A starting point offered on the start page (schedules/SchedulesPage.tsx). */
export interface Preset { draft: Partial<Draft>; form?: Partial<ScheduleForm> }

/** The next run times of a rule, asked from the runtime (the calculation the scheduler arms with). */
function useUpcoming(form: ScheduleForm, now: number): { times: number[]; error?: string } {
  const built = scheduleSpec(form, now);
  const key = 'spec' in built ? JSON.stringify(built.spec) : '';
  const [answer, setAnswer] = useState<{ key: string; times: number[]; error?: string }>({ key: '', times: [] });
  useEffect(() => {
    if (!('spec' in built)) return;
    let alive = true;
    const timer = setTimeout(() => {
      rpc.call('schedules.preview', { spec: built.spec, count: 3 }).then(
        ({ times }) => { if (alive) setAnswer({ key, times, error: times.length ? undefined : 'This schedule never runs.' }); },
        (error) => { if (alive) setAnswer({ key, times: [], error: errorText(error) }); },
      );
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [key]);
  return 'spec' in built ? (answer.key === key ? answer : { times: [] }) : { times: [] };
}

export function ScheduleEditor(props: { schedule?: Schedule; preset?: Preset; onDone: (saved?: Schedule) => void }) {
  const { schedule, preset } = props;
  const tz = schedule?.spec.tz || localZone();
  const now = Date.now();
  const lead = agents.value[0]?.id ?? '';
  const [draft, setDraft] = useState<Draft>(() => schedule ? draftOf(schedule) : { ...emptyDraft('job', lead), ...preset?.draft });
  const [form, setForm] = useState<ScheduleForm>(() => (schedule && formFromSpec(schedule.spec, now, tz)) ?? { ...defaultForm(now, tz), kind: 'repeat', clock: '09:00', ...preset?.form });
  const [bridges, setBridges] = useState<Bridge[] | null>(null);
  const [busy, setBusy] = useState(false);
  const patch = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));
  const set = (change: Partial<ScheduleForm>) => setForm((current) => ({ ...current, ...change }));
  const text = (field: 'date' | 'time' | 'clock' | 'cron' | 'every' | 'start' | 'end') => (event: Event) => set({ [field]: (event.currentTarget as HTMLInputElement).value });
  const [words, setWords] = useState('');
  const [wordsNote, setWordsNote] = useState<{ ok: boolean; text: string } | null>(null);
  const fillFromWords = () => {
    const read = readScheduleWords(words, form, Date.now());
    if (!read) { setWordsNote({ ok: false, text: 'No time found in that – say e.g. "every day at 6", "tomorrow at 9" or "every 2 hours", or set it below.' }); return; }
    const next = { ...form, ...read.form };
    setForm(next);
    if (read.rest && !draft.body.trim()) patch({ body: read.rest });
    const spec = scheduleSpec(next, Date.now());
    setWordsNote('spec' in spec ? { ok: true, text: `Read as: ${ruleWords(spec.spec, { tz: next.tz, now: Date.now() })}. Check the fields below.` } : { ok: false, text: spec.error });
  };
  const editing = !!schedule;
  const agentList = agents.value;
  const chats = useMemo(() => conversations.value.slice().sort((a, b) => chatTitle(a).localeCompare(chatTitle(b))), [conversations.value]);

  useEffect(() => { rpc.call('bridges.list').then(setBridges, () => setBridges([])); }, []);
  useEffect(() => { if (!draft.agentId && lead) patch({ agentId: lead }); }, [lead]);

  const built = build(draft, form, now);
  const upcoming = useUpcoming(form, now);
  const rule = scheduleSpec(form, now);
  const problem = 'error' in built ? built.error : upcoming.error;
  const bridged = new Set((bridges ?? []).filter((bridge) => bridge.status === 'connected').map((bridge) => bridge.conversationId));

  const save = async () => {
    if ('error' in built) return;
    setBusy(true);
    try {
      const saved = schedule ? await rpc.call('schedules.update', { id: schedule.id, ...built.update }) : await rpc.call('schedules.create', built.create);
      props.onDone(saved);
    } catch (error) { toastError(error, editing ? 'Could not save the schedule' : 'Could not create the schedule'); } finally { setBusy(false); }
  };

  const type = draft.type;
  const line = problem ?? ('spec' in rule ? `Runs ${ruleWords(rule.spec, { tz: form.tz, now })}${upcoming.times[0] ? `, next: ${whenText(upcoming.times[0], now)}` : ''}` : '');

  return (
    <form class="schedule-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {!editing && <Segmented label="Kind" value={type} onChange={(value: DraftType) => patch({ type: value })} options={(['job', 'message', 'reminder', 'timer'] as const).map((value) => ({ value, label: TYPE_LABEL[value] }))} />}
      <p class="schedule-hint">{TYPE_HINT[type]}</p>
      {!editing && (
        <div class="schedule-words">
          <div class="schedule-field-block"><span class="schedule-label">Say it in words <span class="schedule-optional">(fills the form)</span></span>
            <div class="schedule-words-row">
              <input type="text" class="input" aria-label="Say it in words" maxLength={500} placeholder="e.g. every weekday at 7:30 summarise the news · morgen um 9 Zahnarzt"
                value={words} onInput={(event) => setWords((event.currentTarget as HTMLInputElement).value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); fillFromWords(); } }} />
              <Button type="button" variant="secondary" disabled={!words.trim()} onClick={fillFromWords}>Fill in</Button>
            </div>
          </div>
          {wordsNote && <span class={`schedule-note${wordsNote.ok ? '' : ' warn'}`} role="status">{wordsNote.text}</span>}
        </div>
      )}

      {(type === 'job' || type === 'reminder') && (
        <label class="schedule-field-block"><span class="schedule-label">Agent</span>
          <select class="select" aria-label="Agent" value={draft.agentId} disabled={editing} onChange={(event) => patch({ agentId: (event.currentTarget as HTMLSelectElement).value })}>
            {agentList.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </label>
      )}
      {(type === 'message' || type === 'job') && (
        <label class="schedule-field-block"><span class="schedule-label">{type === 'message' ? 'Chat' : 'Send the result to'}</span>
          <select class="select" aria-label={type === 'message' ? 'Chat' : 'Send the result to'} value={draft.conversationId} disabled={editing} onChange={(event) => patch({ conversationId: (event.currentTarget as HTMLSelectElement).value })}>
            <option value="">{type === 'message' ? 'Pick a chat…' : 'Nobody – the result stays in the task'}</option>
            {chats.map((chat) => <option key={chat.id} value={chat.id}>{chatTitle(chat)}{bridged.has(chat.id) ? ' · Telegram' : ''}</option>)}
          </select>
          {type === 'job' && bridges !== null && !bridged.size && <span class="schedule-note">No chat bridge is connected, so the result can only go to chats inside Autark. Connect Telegram in a chat's details to reach contacts outside.</span>}
        </label>
      )}
      <label class="schedule-field-block"><span class="schedule-label">Title <span class="schedule-optional">(optional)</span></span>
        <input type="text" class="input" maxLength={120} placeholder={type === 'job' ? 'Daily news' : undefined} value={draft.title} onInput={(event) => patch({ title: (event.currentTarget as HTMLInputElement).value })} />
      </label>
      <label class="schedule-field-block"><span class="schedule-label">{type === 'job' ? 'What should the agent do?' : type === 'message' ? 'Message' : type === 'timer' ? 'Remind me of' : 'Note for the agent'}</span>
        <textarea class="input schedule-body" rows={5} maxLength={20000} placeholder={type === 'job' ? 'Think about today’s news in my field and write a short summary.' : undefined}
          value={draft.body} onInput={(event) => patch({ body: (event.currentTarget as HTMLTextAreaElement).value })} />
      </label>
      {(type === 'job' || type === 'message') && (
        <label class="schedule-check"><input type="checkbox" checked={draft.important} onChange={(event) => patch({ important: (event.currentTarget as HTMLInputElement).checked })} /> Important</label>
      )}

      <div class="schedule-bar" role="group" aria-label="When">
        <div class="schedule-row">
          <Segmented label="When" value={form.kind} onChange={(kind) => set({ kind })} options={[{ value: 'once', label: 'Once' }, { value: 'repeat', label: 'Repeat' }]} />
          {form.kind === 'repeat' && <Segmented label="Repeat" value={form.repeat} onChange={(repeat) => set({ repeat })}
            options={[{ value: 'days', label: 'Days' }, { value: 'every', label: 'Interval' }, { value: 'cron', label: 'Advanced' }]} />}
        </div>
        <div class="schedule-row">
          {form.kind === 'once' && <>
            <input type="date" class="input schedule-date" aria-label="Date" value={form.date} min={todayIn(now, form.tz)} onInput={text('date')} />
            <input type="time" class="input schedule-time" aria-label="Time" value={form.time} onInput={text('time')} />
          </>}
          {form.kind === 'repeat' && form.repeat === 'every' && <>
            <span class="schedule-label">Every</span>
            <input type="number" class="input schedule-number" aria-label="Every" min={1} step={1} inputMode="numeric" value={form.every} onInput={text('every')} />
            <select class="select schedule-unit" aria-label="Unit" value={form.unit} onChange={(event) => set({ unit: (event.currentTarget as HTMLSelectElement).value as ScheduleForm['unit'] })}>
              {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
            </select>
          </>}
          {form.kind === 'repeat' && form.repeat === 'days' && <>
            <div class="schedule-days" role="group" aria-label="Days">
              {DAYS.map(({ day, letter, name }) => (
                <button key={day} type="button" class="schedule-day" aria-label={name} title={name} aria-pressed={form.days.includes(day)}
                  onClick={() => set({ days: form.days.includes(day) ? form.days.filter((entry) => entry !== day) : [...form.days, day] })}>{letter}</button>
              ))}
            </div>
            <span class="schedule-label">at</span>
            <input type="time" class="input schedule-time" aria-label="Time" value={form.clock} onInput={text('clock')} />
          </>}
          {form.kind === 'repeat' && form.repeat === 'cron' && <>
            <span class="schedule-label">Cron</span>
            <input type="text" class="input schedule-cron" aria-label="Cron" placeholder="0 9 * * 1" spellcheck={false} autocomplete="off" value={form.cron} onInput={text('cron')} />
          </>}
        </div>
        <div class="schedule-row schedule-extra">
          {form.kind === 'once' && quickPicks(now, form.tz).map((pick) => (
            <button key={pick.key} type="button" class="chip schedule-pick" disabled={pick.disabled} onClick={() => set({ date: pick.date, time: pick.time })}>{pick.label}</button>
          ))}
          {form.kind === 'repeat' && <>
            <label class="schedule-field" title="Optional: the first run is not before this"><span class="schedule-label">Starts</span>
              <input type="datetime-local" class="input schedule-start" aria-label="Starts" value={form.start} onInput={text('start')} /></label>
            <label class="schedule-field" title="Optional: the last day it runs"><span class="schedule-label">Ends</span>
              <input type="date" class="input schedule-end" aria-label="Ends" value={form.end} min={todayIn(now, form.tz)} onInput={text('end')} /></label>
            <button type="button" class={`chip schedule-clear${form.start || form.end ? '' : ' idle'}`} tabIndex={form.start || form.end ? 0 : -1} onClick={() => set({ start: '', end: '' })}>Clear</button>
          </>}
        </div>
        <p class="schedule-line muted">Time zone: {form.tz.replace('_', ' ')}. Runs missed while the PC was off happen once when it is back on.</p>
      </div>

      {upcoming.times.length > 1 && <p class="schedule-upcoming tabular">Then: {upcoming.times.slice(1).map((at) => whenText(at, now)).join(' · ')}</p>}
      <p class={`schedule-line ${problem ? 'error' : 'muted'}`} role="status">{line}</p>
      <div class="schedule-actions">
        <Button variant="primary" type="submit" busy={busy} disabled={'error' in built || !!upcoming.error}>{editing ? 'Save' : 'Create schedule'}</Button>
        <Button onClick={() => props.onDone()}>Cancel</Button>
      </div>
    </form>
  );
}
