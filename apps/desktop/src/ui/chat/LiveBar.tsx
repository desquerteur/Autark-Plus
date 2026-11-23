// The chat's live bar right above its composer (owner 13.11.2026: "eine Leiste über dem Textfeld … dass eine KI
// arbeitet"): one slim line per agent – or part of a split agent – working for this chat right now, "● Lena · Reading
// invoices.pdf · 2 min" (a part: "● Lena · #2 Press DACH · …"). Where it shows is the runtime's one rule
// (runtime/chat/live.ts, the summary's `live`): the work came from this chat or posted into it. A line is a button to
// the agent's Work page with its activity log (the log lives there since F11, 16.11.2026); its title says what it runs on (model · effort · temperature). Feedback F21
// (16.11.2026): at its right end, in a fixed slot, that agent's own Stop (StopRun.tsx – only this run, others keep
// working; a split part has none, its slot stays empty). A run on another of the person's PCs shows here too
// (runtime/devices/sync/live.ts) and its Stop reaches that PC. The bar
// takes its height only while someone works and sits between the messages and the composer, so the person's newest
// line stays right above it; nothing in it moves on a click. The minutes advance on one 30 s clock while it shows.
// AF-004 (Autark-Plus, ported from the old in-chat agent view): with several at work the bar reads as a tree – each
// part sits right under its agent's line, indented with a guide (treeOrder), so who works on what stays together.
// Owns: the bar's markup and its clock. Never: invents a step, or shows work the summary does not list.

import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { ConversationSummary, LiveRun } from '../../shared/model/chat.ts';
import { agentName } from '../lib/store.ts';
import { go } from '../lib/router.ts';
import { can } from '../lib/session.ts';
import { partLabel } from '../splits/split-text.ts';
import { StopRun } from './StopRun.tsx';
import { barStopRun, modelLine, noteText, shownOf, withTemperature } from './live-text.ts';

const TICK_MS = 30_000;
const clock = signal(Date.now());

/** How long it works so far: "<1 min", "4 min", "1 h 5 min". */
export function sinceText(startedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60_000);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ''}`;
}

/** What a line says after the name: a part's label first, then what it does now (its step, else its note). */
export function lineText(run: Pick<LiveRun, 'step' | 'note' | 'split'>): string {
  const doing = noteText(run.step ?? run.note);
  return run.split ? `${partLabel(run.split)} · ${doing}` : doing;
}

/** AF-004: the runs in start order, each split part moved right under its agent's run (a part without one stays in place). */
export function treeOrder<T extends Pick<LiveRun, 'runId' | 'split'>>(runs: readonly T[]): Array<T & { part: boolean }> {
  const ids = new Set(runs.map((run) => run.runId));
  const out: Array<T & { part: boolean }> = [];
  for (const run of runs) {
    if (run.split && ids.has(run.split.parentRunId)) continue; // placed under its agent below
    out.push({ ...run, part: Boolean(run.split) });
    const parts = runs.filter((entry) => entry.split?.parentRunId === run.runId).sort((a, b) => a.split!.idx - b.split!.idx);
    for (const part of parts) out.push({ ...part, part: true });
  }
  return out;
}

export function LiveBar(props: { chat: Pick<ConversationSummary, 'live'> }) {
  const runs = props.chat.live ?? [];
  const working = runs.length > 0;
  useEffect(() => {
    if (!working) return;
    clock.value = Date.now();
    const timer = setInterval(() => { clock.value = Date.now(); }, TICK_MS);
    return () => clearInterval(timer);
  }, [working]);
  if (!working) return null;
  const now = Math.max(clock.value, ...runs.map((run) => run.startedAt));
  const stops = can('runs.cancel');
  return (
    <div class="live-bar" role="status" aria-label="Working now">
      {treeOrder(runs).map((run) => {
        const name = agentName(run.agentId);
        const text = lineText(run);
        const model = withTemperature(modelLine({ modelName: run.model, effort: run.effort }), shownOf(run));
        const stop = barStopRun(run, stops);
        return (
          <div key={run.runId} class="live-bar-row">
            <button type="button" class="live-bar-line" data-run-id={run.runId} data-part={run.part ? "" : undefined} onClick={() => go.work(run.agentId)}
              title={[`${name} · ${text}`, model].filter(Boolean).join('\n')}>
              <span class="live-bar-dot" aria-hidden="true" />
              <span class="live-bar-name">{name}</span>
              <span class="live-bar-text">{text}</span>
              <span class="live-bar-time tabular">{sinceText(run.startedAt, now)}</span>
            </button>
            {stops && <span class="live-bar-stop">{stop && <StopRun key={stop} runId={stop} name={name} />}</span>}
          </div>
        );
      })}
    </div>
  );
}
