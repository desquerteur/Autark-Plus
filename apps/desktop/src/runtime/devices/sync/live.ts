// Live work between the CEO's own PCs (feedback F10, 16.11.2026: "Der arbeitet gerade, obwohl ich hier nichts vom
// Arbeiten sehe"). Runs do not travel between PCs (tables.ts), so each PC sends its whole current live state – every
// running run or split part with its activity, its step and the chats it shows in (chat/live.ts snapshot) – over the
// mesh method 'sync.live' to its online 'ceo' links: once at link-up and again whenever its own work changes, the
// changes of GAP_MS gathered into one message and one message per PC in flight at a time (a newer state follows when it
// lands; a message that fails while the link stays – a replaced channel, a timeout – goes once more with the newest
// state, so a run's end is not lost). The receiver replaces that PC's last state with each message
// (ChatLive.setRemote: the live bar, the header line and the chat list of that chat are announced) and drops it when
// the link goes (device.upserted not online,
// device.removed – a lost link is noticed within ~20 s), so no timer of its own runs. A change from another PC
// re-announces this PC's own activity on the bus – its local listeners see the same runs and do nothing – and windows
// and phones hear it with the other PCs' runs added (rpc/server.ts, chat/live.ts allActivity): the Team page, tasks
// and phones of either PC show the same work. F21: 'sync.live.cancel' stops one run on the PC that runs it
// (runs.cancel forwards a run it does not have here – cancelThere). A PC on an older version has neither method; it
// is asked again only after its next link-up.
// Owns: this exchange and the forwarding of a Stop. Never: talks to a PC that is no 'ceo' link, stores anything, or
// sends more than the live bar's own fields (no tool input or output, no message text).

import { WorkforceError } from '../../../shared/errors.ts';
import type { AgentActivity } from '../../../shared/model/runs.ts';
import { GAP_MS, type ChatLive, type LiveShare } from '../../chat/live.ts';
import type { RuntimeServices } from '../../contracts.ts';
import { DevicesRepo } from '../repo.ts';
import { linkOf, links } from './home.ts';

export const LIVE_METHOD = 'sync.live';
export const CANCEL_METHOD = 'sync.live.cancel';
/** The runs of one PC's message taken (more would be a fault there); the chats per run. */
const MAX_RUNS = 100;
const MAX_CHATS = 20;
/** How long a message or a forwarded Stop may take once it is sent. */
const CALL_MS = 15_000;

export interface LiveMessage { runs: LiveShare[] }
type Live = Pick<ChatLive, 'snapshot' | 'onChange' | 'setRemote' | 'remoteActivity'>;
type Services = Pick<RuntimeServices, 'db' | 'devices' | 'bus' | 'log' | 'dispatcher'>;

type Plain = Record<string, unknown>;
const plain = (value: unknown): value is Plain => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const errorText = (error: unknown) => String((error as Error)?.message ?? error);
const isCeo = (s: Pick<RuntimeServices, 'db'>, peer: string) => linkOf(new DevicesRepo(s.db).get(peer))?.kind === 'ceo';

/** One run of another PC's message, or undefined when it is no run (the live bar's fields only; never a deviceId of its own). */
export function shareOf(value: unknown): LiveShare | undefined {
  if (!plain(value) || !plain(value.activity)) return undefined;
  const { deviceId: _device, toolCalls: _calls, ...activity } = value.activity;
  if (typeof activity.agentId !== 'string' || typeof activity.runId !== 'string' || typeof activity.startedAt !== 'number') return undefined;
  const chats = Array.isArray(value.chats) ? value.chats.filter((chat): chat is string => typeof chat === 'string').slice(0, MAX_CHATS) : [];
  const step = typeof value.step === 'string' && value.step ? value.step.slice(0, 300) : undefined;
  return { activity: { ...activity, note: typeof activity.note === 'string' ? activity.note.slice(0, 300) : '' } as unknown as AgentActivity, ...(step ? { step } : {}), chats };
}

export class LiveSync {
  private readonly s: Services;
  private readonly live: Live;
  private readonly cancelHere: (runId: string) => Promise<boolean>;
  private readonly gapMs: number;
  private off?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private sentAt = 0;
  private sending = false;
  private again = false;
  /** PCs that answered without the method (an older version): asked again after their next link-up. */
  private readonly older = new Set<string>();
  /** PCs whose last message failed and went once more; the next message that lands clears it. */
  private readonly resent = new Set<string>();
  /** PCs whose live state is here. */
  private readonly peers = new Set<string>();

  /** `cancelHere`: stops a run of this PC (rpc/handlers/org.ts cancelRunHere) – false when it has no such run. */
  constructor(s: Services, live: Live, cancelHere: (runId: string) => Promise<boolean>, gapMs = GAP_MS) {
    this.s = s;
    this.live = live;
    this.cancelHere = cancelHere;
    this.gapMs = gapMs;
  }

  /** A PC is linked: this PC's changes go out; returns the off switch (the other PCs' states go with it). */
  attach(): () => void {
    this.off ??= this.live.onChange(() => this.changed());
    return () => {
      this.off?.();
      this.off = undefined;
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      for (const peer of [...this.peers]) this.linkDown(peer);
    };
  }

  /** A CEO PC came online: it gets this PC's live state at once. */
  linkUp(peer: string): void {
    this.older.delete(peer);
    this.resent.delete(peer);
    if (this.off && isCeo(this.s, peer)) void this.post(peer, this.message());
  }

  /** A PC's link went: what it ran leaves the live bars here. */
  linkDown(peer: string): void {
    if (!this.peers.delete(peer)) return;
    this.live.setRemote(peer, undefined);
    this.announce();
  }

  /** 'sync.live' from a CEO PC: its whole live state replaces the one before. */
  receive(params: unknown, from: string): { ok: true } {
    if (!isCeo(this.s, from)) throw new WorkforceError('forbidden', 'Live work comes only from the CEO\'s own PCs.');
    const runs = plain(params) && Array.isArray(params.runs) ? params.runs.slice(0, MAX_RUNS).map(shareOf).filter((share): share is LiveShare => Boolean(share)) : [];
    if (runs.length) this.peers.add(from);
    else if (!this.peers.has(from)) return { ok: true };
    else this.peers.delete(from);
    this.live.setRemote(from, runs);
    this.announce();
    return { ok: true };
  }

  /** 'sync.live.cancel' from a CEO PC: the Stop of one of this PC's runs. */
  async cancel(params: unknown, from: string): Promise<{ ok: boolean }> {
    if (!isCeo(this.s, from)) throw new WorkforceError('forbidden', 'A Stop comes only from the CEO\'s own PCs.');
    const runId = plain(params) && typeof params.runId === 'string' ? params.runId : '';
    if (!runId) throw new WorkforceError('bad_request', 'runId names the run to stop.');
    return { ok: await this.cancelHere(runId) };
  }

  /** F21: the Stop of a run another PC runs (its live state named it) – true when that PC knew the run. */
  async cancelThere(runId: string): Promise<boolean> {
    const peer = this.live.remoteActivity().find((entry) => entry.runId === runId)?.deviceId;
    if (!peer) return false;
    const answer = await this.s.devices.call(peer, CANCEL_METHOD, { runId }, undefined, CALL_MS) as { ok?: unknown } | undefined;
    return answer?.ok === true;
  }

  private message(): LiveMessage {
    return { runs: this.live.snapshot().map((share) => ({ ...share, activity: { ...share.activity, toolCalls: undefined } })) };
  }

  private changed(): void {
    if (!this.off || this.timer) return;
    if (this.sending) { this.again = true; return; }
    const wait = Math.max(0, this.sentAt + this.gapMs - Date.now());
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, wait);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private async flush(): Promise<void> {
    this.sending = true;
    this.sentAt = Date.now();
    try {
      const message = this.message();
      const peers = links(this.s.db).filter(({ record, link }) => link.kind === 'ceo' && !this.older.has(record.id) && this.s.devices.online(record.id));
      await Promise.all(peers.map(({ record }) => this.post(record.id, message)));
    } finally {
      this.sending = false;
      if (this.again) { this.again = false; this.changed(); }
    }
  }

  private async post(peer: string, message: LiveMessage): Promise<void> {
    try {
      await this.s.devices.call(peer, LIVE_METHOD, message, undefined, CALL_MS);
      this.resent.delete(peer);
    } catch (error) {
      const text = errorText(error);
      if (/Unknown (peer|device) method/.test(text)) this.older.add(peer);
      else if (!this.resent.has(peer) && this.s.devices.online(peer)) { this.resent.add(peer); this.changed(); } // the newest state, once
      this.s.log.info('live work not sent', { peer, error: text.slice(0, 200) });
    }
  }

  /** Windows and phones hear agent.activity again (the RPC side adds the other PCs' runs); local listeners see no change. */
  private announce(): void {
    try { this.s.bus.emit('agent.activity', { active: this.s.dispatcher.activity() }); } catch (error) {
      this.s.log.warn('live work not announced', { error: errorText(error) });
    }
  }
}

// ------------------------------------------------------------------ per runtime

const bound = new WeakMap<object, LiveSync>();

/** Binds this runtime's live sync (sync/service.ts), keyed by its RuntimeServices. */
export function bindLiveSync(services: object, live: LiveSync | undefined): void {
  if (live) bound.set(services, live);
  else bound.delete(services);
}

/** This runtime's live sync, while it has one (runs.cancel reaches it through ctx.services). */
export function liveSyncOf(services: object): LiveSync | undefined {
  return bound.get(services);
}
