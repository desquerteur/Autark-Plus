// The chat's live bar (owner 13.11.2026: "eine Leiste über dem Textfeld … dass eine KI arbeitet"; a run is no row in
// the history any more – three working agents had pushed the person's newest line far up). Who works for a chat right
// now, one entry per running turn or split part, by ONE rule: a running run (or part) shows in a chat when it came
// from that chat (its conversationId: the chat whose line woke it, a part's the chat its group came from) or when it
// posted a message into that chat during this run (a message carrying its runId) – that second way only POST_CHAT_MS
// after its last post there (Konrad 17.11.2026: a run that posted into sixteen chats over a day is not "working" in
// all sixteen). A run with no chat of its own (a schedule's) shows in the chat of its last post for as long as it runs.
// Nothing else – a chat nothing comes from right now shows nothing.
// Fed by what this PC runs: the dispatcher's activity snapshot (agent.activity: the running runs and parts, their note,
// model · effort), the run journal (run.item: the step it is on – itemStep, thoughtStep, and the agent's own sentence:
// the first sentence of its newest working note 'Update' outside its <chat> blocks, which stays the step until its next one, so the bar says in
// the agent's words what it is on instead of its newest tool label – KI-Runde 17.11.2026) and posted messages
// (message.created). A chat whose entries changed gets its summary announced again (`announce`: conversation.upserted
// with ConversationSummary.live) – the first change after a quiet moment at once, further ones together after GAP_MS –
// so windows, phones and runtime readers all read the same list. Feedback F10 (16.11.2026): what the person's other PCs
// run comes in as their whole live state (devices/sync/live.ts, sync.live: `snapshot()` there, `setRemote` here – each
// entry marked with its PC's `deviceId`) and is merged into the same list; it leaves with the next state of that PC or
// when its link goes. `onChange` tells the sync when this PC's own work changed. One ChatLive per runtime, found by its
// bus (chatLiveOf), so the RPC side adds the other PCs' runs to what windows and phones hear (allActivity).
// Owns: that rule, each running run's current step and the chats it posted into, the other PCs' last live state, and
// the announcements. Never: writes a message or a run, keeps anything after its run ended, or copies a tool's input or
// output (only the step label).

import type { Bus } from '../bus.ts';
import type { LiveRun, LiveStep } from '../../shared/model/chat.ts';
import type { AgentActivity, RunItem } from '../../shared/model/runs.ts';
import { chatBlocks } from '../agents/chat-out.ts';
import { firstSentence, oneLine, reasoningHeadline, stepLabel, stepText, type StepKind } from '../../shared/text/step-label.ts';

/** At most one announcement of a chat per this many ms. */
export const GAP_MS = 500;
/** A chat a run only posted into counts as one it works for this long after its last post there. */
export const POST_CHAT_MS = 3 * 60_000;

/** A step's target (the journal keeps the longer one). */
const TARGET_MAX = 100;
/** The agent's own sentence in the bar. */
const SENTENCE_MAX = 120;
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

/** True for the agent's own working note between its steps (turn-attempt.ts journals it as note 'Update'). */
export function isSaid(item: Pick<RunItem, 'kind' | 'name'>): boolean {
  return item.kind === 'note' && item.name === 'Update';
}

/** The bar's step text for one journaled item: a call while it runs ("Reading a.pdf"), after it ("Read a.pdf"), a thought's headline, the agent's own sentence. */
export function stepOf(item: RunItem): string | undefined {
  if (isSaid(item)) return firstSentence(chatBlocks(str(item.data.text), { final: true }).rest, SENTENCE_MAX) || undefined; // its words outside <chat> blocks
  if (item.kind === 'tool_call') return stepText(itemStep(item), true);
  if (item.kind === 'tool_result') return undefined; // the call's own line stays until the next step
  if (item.kind === 'reasoning') return thoughtStep(item)?.target;
  return undefined;
}

/** `said`: the step is the agent's own sentence – only its next sentence replaces it. */
interface Work { activity: AgentActivity; step?: string; said?: boolean; posted: Map<string, number>; lastPosted?: string }

/** One running run as it travels to the person's other PCs (sync.live): its activity, its step and the chats it shows in. */
export interface LiveShare { activity: AgentActivity; step?: string; chats: string[] }

/** The entry a running run is in a chat's live bar. */
function entryOf(work: Pick<Work, 'activity' | 'step'>): LiveRun {
  const a = work.activity;
  return {
    runId: a.runId, agentId: a.agentId, startedAt: a.startedAt,
    ...(work.step ? { step: work.step } : {}), ...(a.note ? { note: a.note } : {}),
    ...(a.modelName ?? a.model ? { model: a.modelName ?? a.model } : {}), ...(a.effort ? { effort: a.effort } : {}),
    ...(a.temperature !== undefined ? { temperature: a.temperature, temperatureSent: a.temperatureSent === true } : {}),
    ...(a.taskId ? { taskId: a.taskId } : {}), ...(a.split ? { split: { ...a.split } } : {}),
  };
}

/** The chats a running run shows in at `at` (the rule in the header). */
function chatsOf(work: Work, at: number): string[] {
  const origin = work.activity.conversationId;
  if (!origin) return work.lastPosted ? [work.lastPosted] : [];
  const out = [origin];
  for (const [chat, postedAt] of work.posted) if (chat !== origin && at - postedAt < POST_CHAT_MS) out.push(chat);
  return out;
}

const sameChats = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((chat) => b.includes(chat));

/** One runtime's ChatLive, by its bus (the RPC side reaches it through ctx.services.bus). */
const lives = new WeakMap<object, ChatLive>();

export function chatLiveOf(bus: object): ChatLive | undefined {
  return lives.get(bus);
}

/** What windows and phones hear as agent.activity: this PC's running runs, then those of the person's other PCs. */
export function allActivity(bus: object, local: readonly AgentActivity[]): AgentActivity[] {
  const remote = lives.get(bus)?.remoteActivity() ?? [];
  if (!remote.length) return [...local];
  const here = new Set(local.map((entry) => entry.runId));
  return [...local, ...remote.filter((entry) => !here.has(entry.runId))];
}

export class ChatLive {
  private readonly runs = new Map<string, Work>();
  /** The person's other PCs: deviceId → that PC's running runs as it last sent them. */
  private readonly remote = new Map<string, LiveShare[]>();
  private readonly listeners = new Set<() => void>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** `<runId>|<chatId>`: when a chat the run only posted into stops counting (POST_CHAT_MS after its last post there). */
  private readonly expiries = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly last = new Map<string, number>();
  private readonly offs: Array<() => void>;
  private readonly bus: Bus;
  private readonly announce: (chatId: string) => void;
  private readonly gapMs: number;

  /** `announce`: the chat's entries changed (the chat service sends its summary). */
  constructor(bus: Bus, announce: (chatId: string) => void, gapMs = GAP_MS) {
    this.bus = bus;
    this.announce = announce;
    this.gapMs = gapMs;
    lives.set(bus, this);
    this.offs = [
      bus.on('agent.activity', ({ active }) => this.activity(active)),
      bus.on('run.item', (item) => {
        const work = this.runs.get(item.runId);
        const step = work ? stepOf(item) : undefined;
        if (!work || !step || step === work.step || (work.said && !isSaid(item))) return;
        work.step = step;
        work.said = isSaid(item);
        this.changed(chatsOf(work, Date.now()));
        this.moved();
      }),
      bus.on('message.created', (message) => {
        const work = message.runId ? this.runs.get(message.runId) : undefined;
        if (!work || !message.runId) return;
        const at = Date.now();
        const before = chatsOf(work, at);
        work.posted.set(message.conversationId, at);
        work.lastPosted = message.conversationId;
        this.expireLater(message.runId, work, message.conversationId);
        const after = chatsOf(work, at);
        if (sameChats(before, after)) return; // the chat already counted: its timer starts over, nothing to announce
        this.changed([...new Set([...before, ...after])]);
        this.moved();
      }),
    ];
  }

  /** The chat's live bar: every running run or part that shows there – this PC's and the other PCs' –, in start order. */
  of(chatId: string): LiveRun[] {
    const at = Date.now();
    const here = [...this.runs.values()].filter((work) => chatsOf(work, at).includes(chatId)).map(entryOf);
    const there = [...this.remote].flatMap(([deviceId, shares]) => remoteIn(shares, chatId)
      .filter((share) => !this.runs.has(share.activity.runId)).map((share) => ({ ...entryOf(share), deviceId })));
    return [...here, ...there].sort((a, b) => a.startedAt - b.startedAt);
  }

  /** This PC's running runs as they travel to the person's other PCs. */
  snapshot(): LiveShare[] {
    const at = Date.now();
    return [...this.runs.values()].map((work) => ({ activity: work.activity, ...(work.step ? { step: work.step } : {}), chats: chatsOf(work, at) }));
  }

  /** `listener` hears every change of this PC's own running work (not the other PCs'); returns its off switch. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Another PC's whole live state (undefined: none, its link went); the chats whose entries changed are announced. */
  setRemote(deviceId: string, shares: readonly LiveShare[] | undefined): void {
    const before = this.remote.get(deviceId) ?? [];
    const after = shares ?? [];
    if (after.length) this.remote.set(deviceId, [...after]);
    else this.remote.delete(deviceId);
    const chats = new Set([...before, ...after].flatMap((share) => share.chats));
    const sig = (list: readonly LiveShare[], chat: string) => JSON.stringify(remoteIn(list, chat).map(entryOf));
    this.changed([...chats].filter((chat) => sig(before, chat) !== sig(after, chat)));
  }

  /** The other PCs' running runs, each with its PC's `deviceId`. */
  remoteActivity(): AgentActivity[] {
    return [...this.remote].flatMap(([deviceId, shares]) => shares.map((share) => ({ ...share.activity, deviceId })));
  }

  dispose(): void {
    for (const off of this.offs) off();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const timer of this.expiries.values()) clearTimeout(timer);
    this.expiries.clear();
    this.listeners.clear();
    if (lives.get(this.bus) === this) lives.delete(this.bus);
  }

  private moved(): void {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* a listener's failure stays its own */ }
    }
  }

  /** A new snapshot of what runs: runs that ended go, new ones come, changed ones are announced in their chats. */
  private activity(active: readonly AgentActivity[]): void {
    const chats = new Set<string>();
    const at = Date.now();
    const now = new Set(active.map((entry) => entry.runId));
    let moved = false;
    for (const [runId, work] of this.runs) {
      if (now.has(runId)) continue;
      this.runs.delete(runId);
      this.dropExpiries(runId);
      moved = true;
      for (const chat of chatsOf(work, at)) chats.add(chat);
    }
    for (const entry of active) {
      if (entry.deviceId) continue; // another PC's run never counts as this PC's
      const work = this.runs.get(entry.runId);
      if (work && JSON.stringify(entryOf(work)) === JSON.stringify(entryOf({ ...work, activity: entry })) && work.activity.conversationId === entry.conversationId) continue;
      const next: Work = { activity: entry, posted: work?.posted ?? new Map(), ...(work?.lastPosted ? { lastPosted: work.lastPosted } : {}), ...(work?.step ? { step: work.step } : {}), ...(work?.said ? { said: true } : {}) };
      for (const chat of [...(work ? chatsOf(work, at) : []), ...chatsOf(next, at)]) chats.add(chat);
      this.runs.set(entry.runId, next);
      moved = true;
    }
    this.changed([...chats]);
    if (moved) this.moved();
  }

  /** A chat the run only posted into stops counting POST_CHAT_MS after its last post: announce it then (a run with no chat of its own keeps its last one). */
  private expireLater(runId: string, work: Work, chat: string): void {
    const origin = work.activity.conversationId;
    if (!origin || chat === origin) return;
    const key = `${runId}|${chat}`;
    const old = this.expiries.get(key);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
      this.expiries.delete(key);
      if (!this.runs.has(runId)) return;
      this.changed([chat]);
      this.moved();
    }, POST_CHAT_MS + 50); // a little after, so `at - postedAt < POST_CHAT_MS` is false when it runs
    (timer as { unref?: () => void }).unref?.();
    this.expiries.set(key, timer);
  }

  private dropExpiries(runId: string): void {
    for (const [key, timer] of this.expiries) {
      if (!key.startsWith(`${runId}|`)) continue;
      clearTimeout(timer);
      this.expiries.delete(key);
    }
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

/** The shares of another PC that show in `chatId`, in start order. */
function remoteIn(shares: readonly LiveShare[], chatId: string): LiveShare[] {
  return shares.filter((share) => share.chats.includes(chatId)).sort((a, b) => a.activity.startedAt - b.activity.startedAt);
}
