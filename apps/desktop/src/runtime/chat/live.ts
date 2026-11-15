// The chat's live bar (owner 13.11.2026: "eine Leiste über dem Textfeld … dass eine KI arbeitet"; a run is no row in
// the history any more – three working agents had pushed the person's newest line far up). Who works for a chat right
// now, one entry per running turn or split part, by ONE rule: a running run (or part) shows in a chat when it came
// from that chat (its conversationId: the chat whose line woke it, a part's the chat its group came from) or when it
// posted a message into that chat during this run (a message carrying its runId). Nothing else – a chat nothing comes
// from right now shows nothing.
// Fed by what this PC runs: the dispatcher's activity snapshot (agent.activity: the running runs and parts, their note,
// model · effort), the run journal (run.item: the step it is on – itemStep, thoughtStep) and posted messages
// (message.created). A chat whose entries changed gets its summary announced again (`announce`: conversation.upserted
// with ConversationSummary.live) – the first change after a quiet moment at once, further ones together after GAP_MS –
// so windows, phones and runtime readers all read the same list. A run on another linked PC is not here (runs do not
// travel between PCs; OFFEN).
// Owns: that rule, each running run's current step and the chats it posted into, and the announcements. Never: writes a
// message or a run, keeps anything after its run ended, or copies a tool's input or output (only the step label).

import type { Bus } from '../bus.ts';
import type { LiveRun, LiveStep } from '../../shared/model/chat.ts';
import type { AgentActivity, RunItem } from '../../shared/model/runs.ts';
import { oneLine, reasoningHeadline, stepLabel, stepText, type StepKind } from '../../shared/text/step-label.ts';

/** At most one announcement of a chat per this many ms. */
export const GAP_MS = 500;

/** A step's target (the journal keeps the longer one). */
const TARGET_MAX = 100;
const KINDS: ReadonlySet<string> = new Set<StepKind>([
  'command', 'read', 'edit', 'search', 'list', 'web', 'browser', 'computer', 'chat', 'task', 'agent', 'memory', 'image', 'mcp', 'plan', 'tool',
]);

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function parsedArgs(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

/** A tool call's step: the step the runtime journaled (engine-native calls), else its label from name, arguments and summary. */
export function itemStep(call: Pick<RunItem, 'name' | 'data'>): LiveStep {
  const journaled = call.data.step as Partial<LiveStep> | undefined;
  const step = journaled && typeof journaled === 'object' && KINDS.has(str(journaled.kind)) && typeof journaled.target === 'string'
    ? { kind: journaled.kind as StepKind, verb: str(journaled.verb), active: str(journaled.active), target: journaled.target }
    : stepLabel(call.name, parsedArgs(call.data.args), { own: call.data.own === true, summary: str(call.data.summary) || undefined, title: str(call.data.title) || undefined });
  return { kind: step.kind, verb: step.verb, active: step.active, target: oneLine(step.target, TARGET_MAX) };
}

/** A reasoning summary's step ("Thought · <headline>"); undefined while it has no words. */
export function thoughtStep(item: Pick<RunItem, 'data'>): LiveStep | undefined {
  const headline = reasoningHeadline(str(item.data.summary));
  if (!headline) return undefined;
  return { kind: 'plan', verb: 'Thought', active: 'Thinking', target: headline, thought: true, ...(item.data.live === true ? { running: true as const } : {}) };
}

/** The bar's step text for one journaled item: a call while it runs ("Reading a.pdf"), after it ("Read a.pdf"), a thought's headline. */
export function stepOf(item: RunItem): string | undefined {
  if (item.kind === 'tool_call') return stepText(itemStep(item), true);
  if (item.kind === 'tool_result') return undefined; // the call's own line stays until the next step
  if (item.kind === 'reasoning') return thoughtStep(item)?.target;
  return undefined;
}

interface Work { activity: AgentActivity; step?: string; posted: Set<string> }

/** The entry a running run is in a chat's live bar. */
function entryOf(work: Work): LiveRun {
  const a = work.activity;
  return {
    runId: a.runId, agentId: a.agentId, startedAt: a.startedAt,
    ...(work.step ? { step: work.step } : {}), ...(a.note ? { note: a.note } : {}),
    ...(a.modelName ?? a.model ? { model: a.modelName ?? a.model } : {}), ...(a.effort ? { effort: a.effort } : {}),
    ...(a.temperature !== undefined ? { temperature: a.temperature, temperatureSent: a.temperatureSent === true } : {}),
    ...(a.taskId ? { taskId: a.taskId } : {}), ...(a.split ? { split: { ...a.split } } : {}),
  };
}

/** The chats a running run shows in (the rule in the header). */
function chatsOf(work: Work): string[] {
  return [...new Set([...(work.activity.conversationId ? [work.activity.conversationId] : []), ...work.posted])];
}

export class ChatLive {
  private readonly runs = new Map<string, Work>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly last = new Map<string, number>();
  private readonly offs: Array<() => void>;
  private readonly announce: (chatId: string) => void;
  private readonly gapMs: number;

  /** `announce`: the chat's entries changed (the chat service sends its summary). */
  constructor(bus: Bus, announce: (chatId: string) => void, gapMs = GAP_MS) {
    this.announce = announce;
    this.gapMs = gapMs;
    this.offs = [
      bus.on('agent.activity', ({ active }) => this.activity(active)),
      bus.on('run.item', (item) => {
        const work = this.runs.get(item.runId);
        const step = work ? stepOf(item) : undefined;
        if (!work || !step || step === work.step) return;
        work.step = step;
        this.changed(chatsOf(work));
      }),
      bus.on('message.created', (message) => {
        const work = message.runId ? this.runs.get(message.runId) : undefined;
        if (!work || work.posted.has(message.conversationId)) return;
        work.posted.add(message.conversationId);
        this.changed([message.conversationId]);
      }),
    ];
  }

  /** The chat's live bar: every running run or part that shows there, in start order. */
  of(chatId: string): LiveRun[] {
    return [...this.runs.values()].filter((work) => chatsOf(work).includes(chatId))
      .sort((a, b) => a.activity.startedAt - b.activity.startedAt).map(entryOf);
  }

  dispose(): void {
    for (const off of this.offs) off();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** A new snapshot of what runs: runs that ended go, new ones come, changed ones are announced in their chats. */
  private activity(active: readonly AgentActivity[]): void {
    const chats = new Set<string>();
    const now = new Set(active.map((entry) => entry.runId));
    for (const [runId, work] of this.runs) {
      if (now.has(runId)) continue;
      this.runs.delete(runId);
      for (const chat of chatsOf(work)) chats.add(chat);
    }
    for (const entry of active) {
      const work = this.runs.get(entry.runId);
      if (work && JSON.stringify(entryOf(work)) === JSON.stringify(entryOf({ ...work, activity: entry })) && work.activity.conversationId === entry.conversationId) continue;
      const next: Work = { activity: entry, posted: work?.posted ?? new Set(), ...(work?.step ? { step: work.step } : {}) };
      for (const chat of [...(work ? chatsOf(work) : []), ...chatsOf(next)]) chats.add(chat);
      this.runs.set(entry.runId, next);
    }
    this.changed([...chats]);
  }

  private changed(chats: readonly string[]): void {
    for (const chat of chats) {
      if (this.timers.has(chat)) continue;
      const wait = (this.last.get(chat) ?? 0) + this.gapMs - Date.now();
      if (wait <= 0) { this.send(chat); continue; }
      const timer = setTimeout(() => { this.timers.delete(chat); this.send(chat); }, wait);
      (timer as { unref?: () => void }).unref?.();
      this.timers.set(chat, timer);
    }
  }

  private send(chat: string): void {
    this.last.set(chat, Date.now());
    if (this.last.size > 500) this.last.delete(this.last.keys().next().value!);
    this.announce(chat);
  }
}
