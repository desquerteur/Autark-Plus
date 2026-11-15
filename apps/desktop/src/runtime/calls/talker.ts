// The call talker: where a call has no realtime model (the chat's voice conversation, shared/voice/conversation.ts) a fast
// small model answers each spoken line at once as the agent's live voice, while the agent keeps working. The device's speech
// recognition and reading voice stay; only the brain in between is new:
//   messages.send stores a live line quiet and hands it here (heard) when the chat has an agent the voice speaks as
//   (B-081: the agent who rang this call, call-log.ts record; else realtime/setup.ts voiceAgent: its one agent; in a
//   default 1:1 with more members, the agent of its pair, else its lead). A line that names someone outside the call goes
//   the normal way. Lines that arrive while the talker still thinks are answered together (the running ask is cancelled
//   and asked again with all of them). One clean-context call on the Decisions use (decision/engine-runner.ts;
//   routing.decision) gets what talker-prompt.ts gives it and answers {say, relay}.
//   `say` becomes the agent's line in the call (meta.call.voice 'talker': the device reads it aloud; the agent's next context
//   shows it as "(your live voice said: …)"). relay: 'none' nothing more, the agent reads the lines in its next turn;
//   'next' the line goes through the normal delivery after all (a queued wake); 'now' it is steered into the running turn
//   in this chat, else delivered with this chat next (dispatcher.urgent).
//   B-081: an agent's call in a chat with more agents has a team (talker-prompt.ts TalkTeam) and the answer is
//   {as, say, relay}: `as` speaks – an agent of the call, or a listening one whose work the line concerns (it joins the
//   call, CallLog.join) – and the relay goes to that agent only (a mention, its steer, its urgent); as "" with say ""
//   is nobody: the lines stay quiet in the chat. No per-agent subconscious run, no wake for listeners.
// A failed, empty or invalid answer, or a line that cannot be stored, also goes through the normal delivery: the agent answers
// as it does without the talker (with a team: the caller). voice.talker false turns the talker off.
// Owns: when the talker answers, who speaks, the answer's validation and passing on. Never: tools, a second answer to the
// same lines, a wake for 'none', or chat text taken as instructions (talker-prompt.ts owns the texts).

import type { CallRecord } from '../../shared/model/call.ts';
import type { Message } from '../../shared/model/chat.ts';
import type { RuntimeServices } from '../contracts.ts';
import type { StructuredRunner } from '../decision/types.ts';
import { voiceAgent } from './realtime/setup.ts';
import { flat, talkerInput, talkerSystem, type TalkTeam } from './talker-prompt.ts';

export { talkerInput, talkerSystem, type TalkTeam } from './talker-prompt.ts';

/** One ask ends after this at the latest; then the agent answers. */
export const TALKER_TIMEOUT_MS = 12_000;
const SAY_MAX = 600;
const WORDS_MAX = 1200;
const RELAYS = ['none', 'next', 'now'] as const;

export const TALKER_SCHEMA = {
  type: 'object',
  properties: { say: { type: 'string' }, relay: { type: 'string', enum: [...RELAYS] } },
  required: ['say', 'relay'],
  additionalProperties: false,
} as const;

/** B-081: the answer with a team – who speaks ("" nobody). */
export const TEAM_SCHEMA = {
  type: 'object',
  properties: { as: { type: 'string' }, say: { type: 'string' }, relay: { type: 'string', enum: [...RELAYS] } },
  required: ['as', 'say', 'relay'],
  additionalProperties: false,
} as const;

/** `as`: with a team, the agent (id) who speaks – '' nobody. */
export interface TalkerDecision { say: string; relay: (typeof RELAYS)[number]; as?: string }

const quiet = <T>(read: () => T, fallback: T): T => { try { return read(); } catch { return fallback; } };

/** The model's answer, or undefined when it says nothing or names no relay. */
export function parseDecision(raw: unknown): TalkerDecision | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const answer = raw as Record<string, unknown>;
  const say = typeof answer.say === 'string' ? flat(answer.say, SAY_MAX) : '';
  const relay = RELAYS.find((mode) => mode === answer.relay);
  return say && relay ? { say, relay } : undefined;
}

/** B-081: the answer with a team: who speaks (by name or id; unknown → the caller), or nobody (an empty say). */
export function parseTeamDecision(raw: unknown, team: TalkTeam): TalkerDecision | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const answer = raw as Record<string, unknown>;
  const as = typeof answer.as === 'string' ? answer.as.trim().toLowerCase() : '';
  if (typeof answer.say === 'string' && !answer.say.trim()) return { as: '', say: '', relay: 'none' };
  const decision = parseDecision(raw);
  if (!decision) return undefined;
  const who = [...team.inCall, ...team.listening].find((agent) => agent.id.toLowerCase() === as || agent.name.toLowerCase() === as);
  return { ...decision, as: who?.id ?? team.inCall[0]?.id ?? '' };
}

export interface CallTalkerDeps {
  services: () => RuntimeServices;
  run: StructuredRunner;
  timeoutMs?: number;
  /** B-081: the call rows (call-log.ts): who rang a call, and an agent joining it. */
  calls?: { record(conversationId: string, callId: string): CallRecord | undefined; join(conversationId: string, callId: string, agentId: string): void };
}

/** One chat's unanswered lines. */
interface Pending { conversationId: string; agentId: string; team?: TalkTeam; lines: Message[]; seq: number; controller?: AbortController }

export class CallTalker {
  private readonly deps: CallTalkerDeps;
  private readonly pending = new Map<string, Pending>(); // conversation → its unanswered lines
  private stopped = false;

  constructor(deps: CallTalkerDeps) {
    this.deps = deps;
  }

  private get s(): RuntimeServices { return this.deps.services(); }

  /** Whether the talker answers the live lines of this chat's call: voice.talker not off, an agent its voice speaks as. */
  serves(conversationId: string, callId?: string): boolean {
    if (this.stopped || quiet(() => this.s.settings.get().voice?.talker, undefined) === false) return false;
    return this.voiceOf(conversationId, callId).agentId !== undefined;
  }

  /** A live line messages.send stored quiet: answered soon (never throws). One that names someone outside the call goes the normal way. */
  heard(message: Message): void {
    const { agentId, team } = this.voiceOf(message.conversationId, message.meta.call?.id);
    const speakers = team ? [...team.inCall, ...team.listening].map((agent) => agent.id) : [agentId];
    if (this.stopped || !agentId || message.mentions.some((id) => !speakers.includes(id) && id !== message.authorId)) { this.deliver(message); return; }
    const entry = this.pending.get(message.conversationId) ?? { conversationId: message.conversationId, agentId, lines: [], seq: 0 };
    this.pending.set(message.conversationId, entry);
    Object.assign(entry, { agentId, team });
    entry.lines.push(message);
    entry.controller?.abort(); // a newer line: asked again with every unanswered one
    void this.answer(entry, ++entry.seq).catch((error: unknown) => this.s.log.warn('call talker failed', { conversationId: entry.conversationId, error: String(error) }));
  }

  /** Shutdown: running asks are cancelled; their lines get the agent's durable wake. */
  stop(): void {
    this.stopped = true;
    for (const entry of this.pending.values()) {
      entry.controller?.abort();
      const last = entry.lines.at(-1);
      if (last) this.deliver(last, entry.team ? entry.agentId : undefined);
    }
    this.pending.clear();
  }

  /** Who the voice speaks as: the agent who rang the call (with a team when the chat has more agents), else voiceAgent. */
  private voiceOf(conversationId: string, callId: string | undefined): { agentId?: string; team?: TalkTeam } {
    const s = this.s;
    const record = callId ? quiet(() => this.deps.calls?.record(conversationId, callId), undefined) : undefined;
    const active = quiet(() => s.chats.members(conversationId), []).filter((member) => member.kind === 'agent' && member.leftAt === undefined)
      .map((member) => s.org.get(member.memberId)).filter((agent) => agent && agent.archivedAt === undefined).map((agent) => ({ id: agent!.id, name: agent!.name }));
    const caller = record?.ring?.by ?? undefined;
    if (!caller || !active.some((agent) => agent.id === caller)) return { agentId: quiet(() => voiceAgent(s, conversationId), undefined) };
    if (active.length < 2) return { agentId: caller };
    const inCall = [caller, ...(record?.agents ?? []).filter((id) => id !== caller)].flatMap((id) => active.filter((agent) => agent.id === id));
    return { agentId: caller, team: { callId: callId!, inCall, listening: active.filter((agent) => !inCall.includes(agent)), why: record?.ring?.why } };
  }

  private async answer(entry: Pending, run: number): Promise<void> {
    const controller = new AbortController();
    entry.controller = controller;
    const lines = [...entry.lines];
    const answer = await this.ask(entry, lines, controller.signal).catch(() => undefined);
    if (this.stopped || entry.seq !== run) return; // a newer line asked again: that run answers these too
    entry.controller = undefined;
    entry.lines = [];
    if (this.pending.get(entry.conversationId) === entry) this.pending.delete(entry.conversationId);
    const last = lines.at(-1)!;
    const fallback = entry.team ? entry.agentId : undefined;
    const speaker = answer?.decision.as ?? entry.agentId;
    if (answer && speaker === '') return; // nobody speaks: the lines stay quiet in the chat, the agents read them next turn
    if (answer && entry.team && !entry.team.inCall.some((agent) => agent.id === speaker)) quiet(() => this.deps.calls?.join(entry.conversationId, entry.team!.callId, speaker), undefined);
    if (!answer || !this.say(entry, last, answer.decision.say, answer.by, speaker)) { this.deliver(last, fallback); return; }
    await this.passOn(entry, lines, answer.decision, speaker);
  }

  private async ask(entry: Pending, lines: Message[], signal: AbortSignal): Promise<{ decision: TalkerDecision; by: string } | undefined> {
    const s = this.s;
    const timeoutMs = this.deps.timeoutMs ?? TALKER_TIMEOUT_MS;
    const result = await this.deps.run({
      purpose: 'call talker',
      system: talkerSystem(s, entry.agentId, entry.conversationId, entry.team),
      prompt: s.secrets.redact(JSON.stringify(talkerInput(s, entry.agentId, entry.conversationId, lines, entry.team))),
      schema: (entry.team ? TEAM_SCHEMA : TALKER_SCHEMA) as unknown as Record<string, unknown>,
      signal, deadlineMs: timeoutMs,
    });
    const raw = result.structured ?? quiet(() => JSON.parse(result.text) as unknown, undefined);
    const decision = entry.team ? parseTeamDecision(raw, entry.team) : parseDecision(raw);
    return decision ? { decision, by: result.by } : undefined;
  }

  /** The live voice's line in the chat, as `agentId`; false when it could not be stored. */
  private say(entry: Pending, last: Message, say: string, by: string, agentId: string): boolean {
    const s = this.s;
    try {
      s.chats.send({
        conversationId: entry.conversationId, body: s.secrets.redact(say), authorId: agentId, authorKind: 'agent', mentions: [],
        meta: { via: 'voice', model: by, call: { id: last.meta.call?.id ?? '', participant: `agent:${agentId}`, name: s.org.get(agentId)?.name ?? 'Agent', voice: 'talker' } },
      });
      return true;
    } catch (error) {
      s.log.warn('call talker line not stored', { conversationId: entry.conversationId, error: String(error) });
      return false;
    }
  }

  private async passOn(entry: Pending, lines: Message[], decision: TalkerDecision, agentId: string): Promise<void> {
    if (decision.relay === 'none') return;
    const s = this.s;
    const last = lines.at(-1)!;
    const to = entry.team ? agentId : undefined; // with a team the line goes to the one who spoke
    if (decision.relay === 'next') { this.deliver(last, to); return; }
    const words = flat(lines.map((line) => line.body).join(' / '), WORDS_MAX).replace(/"/g, "'");
    const text = `[Live call: my live voice passes this on now] I take it into account in this work now; the person hears what I post in this chat.\nThe person said: "${words}"\nMy voice told them: "${decision.say.replace(/"/g, "'")}"`;
    const steered = await Promise.resolve(s.dispatcher.relay?.(agentId, entry.conversationId, text, 'now')).catch(() => false);
    if (steered) return;
    this.deliver(last, to);
    await s.dispatcher.urgent(agentId, entry.conversationId).catch((error: unknown) => s.log.warn('call talker: urgent failed', { conversationId: entry.conversationId, error: String(error) }));
  }

  /** The line goes the normal way after all: the delivery's wake (with a task that waits on the person); `to`: that agent only. */
  private deliver(line: Message, to?: string): void {
    try { this.s.delivery.onMessage({ ...line, silent: false, ...(to ? { mentions: [to] } : {}) }); } catch (error) {
      this.s.log.warn('call talker: delivery failed', { conversationId: line.conversationId, error: String(error) });
    }
  }
}
