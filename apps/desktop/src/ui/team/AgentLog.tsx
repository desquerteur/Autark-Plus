// Agent page › Activity log: everything the agent does, in time order, oldest at the top and the newest at the bottom –
// no chat, a running record that writes itself. Each turn opens with a system line (time,
// what started it, its chat, the model; Stop while it runs; the route's reason muted below), then its journaled steps as
// the compact step lines (run-steps.tsx: tool calls open to input and output, thoughts, plans, the runtime's own notes as
// their line; a split is its "Split · 1 of 3 done" line, open as columns – one per running part with what it does, a
// column less when a part is back, ../splits/SplitLanes.tsx – parallel parts are no turns of their own here), the agent's updates and answers as its words (answers open, AnswersOpen), and a closing system line
// (how it ended, how long, its tokens and cost). A day line goes between days. "Show earlier" reads the page before
// (agents.log `before`); the newest turns come live over `runs:<agentId>` (counted, run-items.tsx holdRunsTopic).
// The same log reads for agents as lines through the agents.log tool (runtime/tools/builtin/agents-log.ts).
// Owns: the log's list, its paging and its live merge. Never: polls, renders a step itself, or shows more than the
// runtime journaled.

import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Run, RunItem } from '../../shared/model/runs.ts';
import type { AgentLogPage } from '../../shared/api/methods-log.ts';
import '../../shared/api/methods-log.ts'; // agents.log (module augmentation)
import { RUN_STATUS_LABELS, durationText, tokenLine, triggerLabel } from '../../shared/text/run-notes.ts';
import { Button, EmptyState, Spinner } from '../lib/ui.tsx';
import { rpc, errorText } from '../lib/rpc.ts';
import { conversationMap } from '../lib/store.ts';
import { chatTitle } from '../lib/chat-naming.ts';
import { modelShortName } from '../lib/model-name.ts';
import { dayMonth, fullDate, time } from '../lib/format.ts';
import { toastError } from '../lib/toasts.ts';
import { mergeItem } from './step-view.ts';
import { holdRunsTopic } from './run-items.tsx';
import { SplitColumns } from '../splits/SplitRows.tsx';
import { AnswersOpen, StepEntry, entryKey } from './run-steps.tsx';
import { runEntries } from './model.ts';
import { shownEntry } from './step-view.ts';

interface Log { runs: Run[]; items: Map<string, RunItem[]>; before?: number }

const isLive = (run: Pick<Run, 'status'>) => run.status === 'running' || run.status === 'queued';
const byStart = (a: Run, b: Run) => (a.startedAt ?? 0) - (b.startedAt ?? 0);

/** The page's runs and items as the log (older pages go in front). */
function fromPage(page: AgentLogPage, older?: Log): Log {
  const items = new Map(older?.items);
  for (const item of page.items) { const list = items.get(item.runId); if (list) list.push(item); else items.set(item.runId, [item]); }
  const known = new Set(page.runs.map((run) => run.id));
  return { runs: [...page.runs, ...(older?.runs.filter((run) => !known.has(run.id)) ?? [])].sort(byStart), items, before: page.before };
}

const dayKey = (ms: number | undefined) => (ms ? new Date(ms).toDateString() : '');

/** "Today", "Yesterday", else "30 Oct". */
function dayLine(ms: number): string {
  if (dayKey(ms) === dayKey(Date.now())) return 'Today';
  return dayKey(ms) === dayKey(Date.now() - 86_400_000) ? 'Yesterday' : dayMonth(ms);
}

function Turn(props: { run: Run; items: readonly RunItem[] }) {
  const { run } = props;
  const [stopping, setStopping] = useState(false);
  const live = isLive(run);
  const chat = run.conversationId ? conversationMap.value.get(run.conversationId) : undefined;
  const entries = runEntries(props.items.slice()).filter(shownEntry);
  const stop = async () => {
    setStopping(true);
    try { await rpc.call('runs.cancel', { runId: run.id }); } catch (err) { toastError(err, 'Could not stop the run'); } finally { setStopping(false); }
  };
  const start = [triggerLabel(run), chat && chatTitle(chat), modelShortName(run.model)].filter(Boolean).join(' · ');
  const cost = run.costUsd ? `$${run.costUsd.toFixed(run.costUsd < 1 ? 3 : 2)}` : '';
  const end = [RUN_STATUS_LABELS[run.status], durationText(run.startedAt, run.endedAt), tokenLine(run), cost].filter(Boolean).join(' · ');
  return (
    <li class={`log-turn status-${run.status}`}>
      <div class="log-system">
        <time class="log-time tabular" title={run.startedAt ? fullDate(run.startedAt) : undefined}>{run.startedAt ? time(run.startedAt) : ''}</time>
        <span class="log-mark" aria-hidden="true">{live ? <Spinner size={12} label={RUN_STATUS_LABELS[run.status]} /> : <span class="log-dot" />}</span>
        <span class="log-system-text" title={start}>{start}</span>
        {live && <Button variant="ghost" busy={stopping} onClick={() => void stop()}>Stop</Button>}
      </div>
      {run.route?.reason && <p class="log-route muted">{run.route.reason}</p>}
      {entries.length > 0 && <ul class="run-items log-steps">{entries.map((entry) => <StepEntry key={entryKey(entry)} entry={entry} live={live} />)}</ul>}
      {!live && (
        <div class={`log-system log-end ${run.status}`}>
          <span class="log-time" />
          <span class="log-mark" aria-hidden="true"><span class={`log-dot ${run.status}`} /></span>
          <span class="log-system-text" title={end}>{end}</span>
        </div>
      )}
      {run.error && <p class="run-error log-error">{run.error}</p>}
    </li>
  );
}

export function AgentLog(props: { agentId: string }) {
  const { agentId } = props;
  const [log, setLog] = useState<Log | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [earlier, setEarlier] = useState(false);

  useEffect(() => {
    let alive = true;
    setLog(null);
    const load = () => rpc.call('agents.log', { id: agentId })
      .then((page) => { if (alive) { setLog(fromPage(page)); setError(null); } })
      .catch((err) => { if (alive) setError(errorText(err)); });
    const release = holdRunsTopic(agentId); // before the read: no run event falls between the two
    void load();
    const offRun = rpc.on('run.upserted', (run) => {
      if (run.agentId !== agentId || run.splitId) return; // a split's run shows under its parent's Split line
      setLog((current) => {
        if (!current) return current;
        const known = current.runs.some((entry) => entry.id === run.id);
        if (!known && current.runs.length && (run.startedAt ?? 0) < (current.runs[0].startedAt ?? 0)) return current; // before the loaded pages
        const runs = known ? current.runs.map((entry) => (entry.id === run.id ? run : entry)) : [...current.runs, run].sort(byStart);
        return { ...current, runs };
      });
    });
    const offItem = rpc.on('run.item', (item) => {
      setLog((current) => {
        if (!current || !current.runs.some((run) => run.id === item.runId)) return current;
        const items = new Map(current.items);
        items.set(item.runId, mergeItem(items.get(item.runId) ?? [], item));
        return { ...current, items };
      });
    });
    const offOpen = rpc.onOpen(() => { void load(); });
    return () => { alive = false; offRun(); offItem(); offOpen(); release(); };
  }, [agentId]);

  const showEarlier = async () => {
    if (!log?.before) return;
    setEarlier(true);
    try {
      const page = await rpc.call('agents.log', { id: agentId, before: log.before });
      setLog((current) => (current ? fromPage(page, current) : current));
    } catch (err) {
      toastError(err, 'Could not load earlier activity');
    } finally {
      setEarlier(false);
    }
  };

  if (error) return <p class="run-error">{error}</p>;
  if (!log) return <div class="run-loading"><Spinner size={16} /></div>;
  if (!log.runs.length) return <EmptyState>Nothing yet. Everything this agent does shows up here by itself.</EmptyState>;
  return (
    <AnswersOpen.Provider value={true}>
      <SplitColumns.Provider value={true}>
        {log.before !== undefined && <Button variant="ghost" class="log-earlier" busy={earlier} onClick={() => void showEarlier()}>Show earlier</Button>}
        <ol class="log-list">
          {log.runs.map((run, index) => (
            <Fragment key={run.id}>
              {dayKey(run.startedAt) !== dayKey(log.runs[index - 1]?.startedAt) && run.startedAt !== undefined && (
                <li key={`day-${dayKey(run.startedAt)}`} class="log-day">{dayLine(run.startedAt)}</li>
              )}
              <Turn run={run} items={log.items.get(run.id) ?? []} />
            </Fragment>
          ))}
        </ol>
      </SplitColumns.Provider>
    </AnswersOpen.Provider>
  );
}
