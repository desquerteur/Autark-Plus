// agents.log: an agent's activity log as plain lines – the same log a person sees on the agent's page (team/AgentLog.tsx),
// read from the run journal (runs/log.ts). Every turn is journaled by itself, so nothing has to be written for it: each
// turn opens with what started it (and where), its items follow in order – thoughts the provider shows, tool calls with
// their outcome, updates, answers and the runtime's own notes, marked [system] – and it closes with how it ended. Any
// agent reads any colleague's log or its own (an open system: everyone can see what the others do when it matters).
// Found through tools.find; agents.list names it.
// Owns: this tool and its line format. Never: shows a tool's whole output (the journal keeps it truncated and
// secret-redacted; the person opens it on the agent's page) or writes anything.

import type { Agent } from '../../../shared/model/org.ts';
import type { Run, RunItem } from '../../../shared/model/runs.ts';
import { reasoningHeadline } from '../../../shared/text/step-label.ts';
import { RUN_STATUS_LABELS, durationText, systemNoteText, tokenLine, triggerLabel } from '../../../shared/text/run-notes.ts';
import { profileZone } from '../../calendar/service.ts';
import { itemStep } from '../../chat/live.ts';
import { readAgentLog } from '../../runs/log.ts';
import type { ToolContext } from '../types.ts';
import { failure, text } from '../types.ts';
import { clip, defineTool, internal, parseWhen } from './util.ts';

const MAX_TURNS = 15;
const DEFAULT_TURNS = 5;
const WORDS_MAX = 600; // an update's or answer's words in one line
const OUTPUT_MAX = 24_000;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const flat = (value: string, max: number): string => clip(value.replace(/\s+/g, ' ').trim(), max);

/** The agent by id or name (case-insensitive); absent: the caller. */
function findAgent(ctx: ToolContext, ref: string | undefined): Agent | undefined {
  const wanted = ref?.trim();
  if (!wanted || wanted.toLowerCase() === 'self' || wanted.toLowerCase() === 'me') return ctx.agent;
  const all = ctx.services.org.list({ includeArchived: true });
  return all.find((agent) => agent.id === wanted) ?? all.find((agent) => agent.name.toLowerCase() === wanted.toLowerCase());
}

function clock(zone: string): { day: (ms: number) => string; time: (ms: number) => string } {
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false });
  return { day: (ms) => day.format(ms), time: (ms) => time.format(ms) };
}

/** One item as its line (without the time); '' for an item nobody reads (an empty thought, an answer's later part). */
export function itemLine(item: RunItem, result: RunItem | undefined): string {
  const data = item.data;
  if (item.kind === 'tool_call') {
    const step = itemStep(item);
    const failed = result?.data.ok === false || item.effectStatus === 'failed';
    const outcome = !result ? ' (no result)' : failed ? ` FAILED: ${flat(str(result.data.summary) || str(result.data.preview) || str(result.data.error) || 'error', 200)}` : '';
    return `${step.verb || item.name || 'Tool'} ${step.target}`.trim() + (item.name ? ` [${item.name}]` : '') + outcome;
  }
  if (item.kind === 'reasoning') { const headline = reasoningHeadline(str(data.summary)); return headline ? `Thought · ${headline}` : ''; }
  if (item.kind === 'note' && data.commentary === true) return `Update: ${flat(str(data.text), WORDS_MAX)}`;
  if (item.kind === 'note' && data.answer === true) {
    if (typeof data.part === 'number' && data.part > 1) return '';
    const where = data.visibility === 'internal' ? 'kept internal' : data.visibility === 'silent' || data.visibility === 'quiet' ? 'posted quietly' : 'posted';
    return `Answer (${where}): ${flat(str(data.text), WORDS_MAX)}`;
  }
  if (item.kind === 'plan') { const steps = Array.isArray(data.steps) ? data.steps.length : 0; return `Plan · ${steps} ${steps === 1 ? 'step' : 'steps'}`; }
  if (item.kind === 'error') return `Error: ${flat(str(data.message) || JSON.stringify(data), 300)}`;
  const note = systemNoteText(item);
  if (note) return `[system] ${flat(note, 300)}`;
  return `${item.kind}${item.name ? ` · ${item.name}` : ''}`;
}

/** Where a turn worked: its chat's title, its task's title. */
function placeOf(ctx: ToolContext, run: Run): string {
  const chat = run.conversationId ? ctx.services.chats.get(run.conversationId) : undefined;
  const task = run.taskId ? ctx.services.tasks.get(run.taskId) : undefined;
  return [chat ? `chat "${chat.title || run.conversationId}" (${run.conversationId})` : '', task ? `task "${task.title}" (${task.id})` : ''].filter(Boolean).join(' · ');
}

/** The log page as lines, oldest first. */
export function logText(ctx: ToolContext, runs: readonly Run[], items: readonly RunItem[], zone: string): string[] {
  const { day, time } = clock(zone);
  const byRun = new Map<string, RunItem[]>();
  for (const item of items) { const list = byRun.get(item.runId); if (list) list.push(item); else byRun.set(item.runId, [item]); }
  const lines: string[] = [];
  for (const run of runs) {
    const head = [triggerLabel(run), run.splitId ? `split ${run.splitId}` : '', placeOf(ctx, run), run.model, run.effort].filter(Boolean).join(' · ');
    lines.push(`── ${run.startedAt ? day(run.startedAt) : '?'} · ${head}`);
    const own = (byRun.get(run.id) ?? []).slice().sort((a, b) => a.seq - b.seq);
    const results = new Map<string, RunItem>();
    for (const item of own) if (item.kind === 'tool_result' && typeof item.data.callId === 'string') results.set(item.data.callId, item);
    for (const item of own) {
      if (item.kind === 'tool_result') continue;
      const line = itemLine(item, typeof item.data.callId === 'string' ? results.get(item.data.callId) : undefined);
      if (line) lines.push(`${time(item.createdAt)} ${line}`);
    }
    const end = [RUN_STATUS_LABELS[run.status], durationText(run.startedAt, run.endedAt), run.error ? flat(run.error, 200) : '', tokenLine(run)].filter(Boolean).join(' · ');
    lines.push(`── ${end}`);
  }
  return lines;
}

const logTool = defineTool<{ agentId?: string; before?: string; turns?: number }>({
  name: 'agents.log',
  description: 'Shows what an agent or I did lately, turn by turn. Each turn with what started it, thoughts, tool calls, answers and how it ended; I read it to know what someone really did.',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: { type: 'string', description: 'Id or name; default me.' },
      before: { type: 'string', description: 'Turns started before this time; each page names the next.' },
      turns: { type: 'integer', minimum: 1, maximum: MAX_TURNS, description: `Default ${DEFAULT_TURNS}.` },
    },
    additionalProperties: false,
  },
  category: 'read',
  anyMode: true,
  describe: (args) => internal(`Read the activity log of ${args.agentId?.trim() || 'myself'}`),
  async run(args, ctx) {
    const agent = findAgent(ctx, args.agentId);
    if (!agent) return failure(`No agent "${args.agentId}" (agents.list names them).`);
    const before = args.before === undefined ? undefined : parseWhen(args.before, ctx.services.clock.now());
    if (args.before !== undefined && before === undefined) return failure('`before` is no time I can read (ISO, e.g. 2026-11-13T09:12:00Z).');
    const page = readAgentLog(ctx.services.db, agent.id, { maxRuns: Math.min(MAX_TURNS, Math.max(1, Math.floor(args.turns ?? DEFAULT_TURNS))), maxItems: 300, splits: true, ...(before === undefined ? {} : { before }) });
    const who = agent.id === ctx.agent.id ? `${agent.name} (me)` : `${agent.name} (${agent.role || 'agent'}, ${agent.id})`;
    if (!page.runs.length) return text(`${who} has no turns recorded${before === undefined ? ' yet' : ' before that time'}.`);
    const lines = logText(ctx, page.runs, page.items, profileZone(ctx.services));
    let body = lines.join('\n');
    if (body.length > OUTPUT_MAX) body = `…\n${body.slice(body.length - OUTPUT_MAX)}`; // the newest stays whole
    const earlier = page.before === undefined ? '' : `\nEarlier turns: agents.log {"agentId": "${agent.id}", "before": "${new Date(page.before).toISOString()}"}`;
    return text(`Activity log of ${who}, oldest first:\n${body}${earlier}`);
  },
});

export const agentLogTools = [logTool];
