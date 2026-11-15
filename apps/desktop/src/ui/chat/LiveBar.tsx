// The chat's live bar right above its composer (owner 13.11.2026: "eine Leiste über dem Textfeld … dass eine KI
// arbeitet"): one slim line per agent – or part of a split agent – working for this chat right now, "● Lena · Reading
// invoices.pdf · 2 min" (a part: "● Lena · #2 Press DACH · …"). Where it shows is the runtime's one rule
// (runtime/chat/live.ts, the summary's `live`): the work came from this chat or posted into it. A line is a button to
// the agent's page with its activity log; its title says what it runs on (model · effort · temperature). The bar
// takes its height only while someone works and sits between the messages and the composer, so the person's newest
// line stays right above it; nothing in it moves on a click. The minutes advance on one 30 s clock while it shows.
// Owns: the bar's markup and its clock. Never: invents a step, or shows work the summary does not list.

import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { ConversationSummary, LiveRun } from '../../shared/model/chat.ts';
import { agentName } from '../lib/store.ts';
import { go } from '../lib/router.ts';
import { partLabel } from '../splits/split-text.ts';
import { modelLine, noteText, shownOf, withTemperature } from './live-text.ts';

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
  return (
    <div class="live-bar" role="status" aria-label="Working now">
      {runs.map((run) => {
        const name = agentName(run.agentId);
        const text = lineText(run);
        const model = withTemperature(modelLine({ modelName: run.model, effort: run.effort }), shownOf(run));
        return (
          <button type="button" key={run.runId} class="live-bar-line" data-run-id={run.runId} onClick={() => go.agent(run.agentId)}
            title={[`${name} · ${text}`, model].filter(Boolean).join('\n')}>
            <span class="live-bar-dot" aria-hidden="true" />
            <span class="live-bar-name">{name}</span>
            <span class="live-bar-text">{text}</span>
            <span class="live-bar-time tabular">{sinceText(run.startedAt, now)}</span>
          </button>
        );
      })}
    </div>
  );
}
