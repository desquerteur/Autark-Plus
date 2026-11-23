// A call is one value in its chat (owner 04.11.2026: "ein Anrufprotokoll … auf diese Bubble … draufklicken und dann sieht
// man das"): one quiet status row per call, written only here – by the PC of the device the person calls from. calls.start
// opens it (or returns the device's call already open in that chat); its meta.call (shared/model/call.ts CallRecord) is the
// call: id, the device (participant 'device:<key>', name), startedAt, endedAt and the lines. While it is open, every line
// that comes after the row in that chat is appended – the person's spoken and typed lines and every agent's answer, also an
// answer synced from the agent's home PC (the bus events fire for synced rows too); a quiet line only when it carries this
// call's id (the talker's held line, realtime transcripts, the hand-over note). The newest CALL_LINES stay. The row syncs like
// any message, and one writer means no conflicts. The call ends with calls.end, its device's connection closing, or this
// runtime stopping: what is open then is ended at the next start (endLeftOpen, at its last line) so the end travels too.
// A line follows its row for good, also after the call: an edit gives it the new text, a deletion takes it out – in every
// call row this PC wrote (CallRecord.pc), also when the change arrives by sync.
// B-081: a device takes a call (take – it answers an agent's ring, ring.ts, or takes over a running call from another
// device): the row becomes that device's (participant, name, pc) and this PC writes it from then on. A PC whose open call
// shows another holder in the synced row lets it go without an end (`taken`): a late line of the old device still joins
// that call (start returns its id) instead of opening a second bubble. A row another PC holds now is not ended here at
// the next start.
// KI-Runde 17.11.2026: the calls open here are the live state everything else reads – `running` and `inCall` say which
// calls run on this PC and whether an agent is in one (the context fold starts no turn then), and `onEnd` tells the call's
// voice that it ended, so it can do its last act with the whole call in its session (talker.ts) – `onStart` that it opened,
// so the voice's session opens with it. A call that leaves this PC without an end (another PC took it, its row was
// deleted) is told as such: its voice closes without a hand-over.
// Owns: the open calls, their rows and lines, the takes, the list of them kept for the next start (kv 'calls'/'open') and
// who is told of an end. Never: audio, wakes, rings, another PC's call row while it holds it, or a line's own row.

import { WorkforceError } from '../../shared/errors.ts';
import { HUMAN_ID, SYSTEM_ID, newId } from '../../shared/ids.ts';
import { CALL_LINES, CALL_LINE_TEXT, callHolder, callRecord, callState, type CallDevice, type CallLine, type CallRecord } from '../../shared/model/call.ts';
import type { Message } from '../../shared/model/chat.ts';
import type { RuntimeServices } from '../contracts.ts';
import { MessageRepo } from '../chat/message-repo.ts';
import { DevicesRepo } from '../devices/repo.ts';
import { KvRepo } from '../store/kv.ts';

const KV_NS = 'calls';
const KV_KEY = 'open';
/** The call rows of a chat whose lines name a message (its id in quotes). */
const LISTING = `SELECT id FROM messages WHERE conversation_id = ? AND kind = 'status' AND instr(meta, ?) > 0`;

interface OpenCall { id: string; rowId: string; conversationId: string; device: CallDevice; seq: number; off: () => void }

/** KI-Runde 17.11.2026: a call running on this PC right now – its chat, so the fold and the voice can read the live state. */
export interface RunningCall { callId: string; conversationId: string }

const quiet = <T>(read: () => T, fallback: T): T => { try { return read(); } catch { return fallback; } };

/** Who said a line, as the transcript names them. */
function speaker(s: RuntimeServices, call: OpenCall, message: Message): Pick<CallLine, 'from' | 'name'> {
  if (message.authorKind === 'agent') return { from: `agent:${message.authorId}`, name: quiet(() => s.org.get(message.authorId)?.name, undefined) ?? 'Agent' };
  if (message.authorId === HUMAN_ID) {
    const said = message.meta.call?.participant;
    return { from: said ?? `device:${call.device.key}`, name: quiet(() => s.settings.get().profile?.name?.trim(), undefined) || 'You' };
  }
  return { from: `${message.authorKind}:${message.authorId}`, name: quiet(() => s.people?.get(message.authorId)?.name, undefined) ?? message.authorId };
}

/** A row's words as its call line keeps them (a status row: its line), capped; undefined when it says nothing. */
function lineText(message: Message): string | undefined {
  const clean = (message.kind === 'status' ? message.meta.status?.text : message.body)?.trim();
  return clean && clean.length > CALL_LINE_TEXT ? `${clean.slice(0, CALL_LINE_TEXT - 1)}…` : clean || undefined;
}

/** The line a chat row adds to an open call, or undefined. */
function lineOf(s: RuntimeServices, call: OpenCall, message: Message): CallLine | undefined {
  if (message.conversationId !== call.conversationId || message.id === call.rowId || message.state !== 'final' || message.seq <= call.seq) return undefined;
  const marked = message.meta.call?.id === call.id || message.meta.status?.details?.callId === call.id;
  const counts = message.kind === 'status' ? marked : message.kind === 'text' && (marked || !message.silent);
  const text = counts ? lineText(message) : undefined;
  return text ? { at: message.createdAt, ...speaker(s, call, message), text, messageId: message.id } : undefined;
}

/** This PC's device id (CallRecord.pc), undefined without a device record. */
export const thisPc = (s: Pick<RuntimeServices, 'db'>) => quiet(() => new DevicesRepo(s.db).self()?.id, undefined);

/** B-081: the call row of `callId` in a chat (its id), else undefined. */
export function callRowId(s: Pick<RuntimeServices, 'db'>, conversationId: string, callId: string): string | undefined {
  return quiet(() => s.db.get<{ id: string }>(`SELECT id FROM messages WHERE conversation_id = ? AND kind = 'status' AND json_extract(meta, '$.call.id') = ? LIMIT 1`, [conversationId, callId])?.id, undefined);
}

/**
 * KI-Runde 17.11.2026 (decision 8.3): whether that call is still running – a ring nobody took yet counts, an ended call
 * does not. Read from the call's own row, so it holds on every PC. Unknown call: false.
 */
export function callRunning(s: Pick<RuntimeServices, 'db' | 'chats' | 'clock'>, conversationId: string, callId: string): boolean {
  const rowId = callRowId(s, conversationId, callId);
  const row = rowId ? quiet(() => s.chats.message(rowId), undefined) : undefined;
  const record = row ? callRecord(row) : undefined;
  if (!record) return false;
  const state = callState(record, quiet(() => s.clock.now(), Date.now()));
  return state === 'running' || state === 'ringing';
}

/** Changes a call row's record; the row is saved and announced (it syncs) when it changed. False without such a row. */
export function writeCallRow(s: RuntimeServices, rowId: string, change: (record: CallRecord) => CallRecord): boolean {
  try {
    const row = s.chats.message(rowId);
    const record = row ? callRecord(row) : undefined;
    if (!row || !record) return false;
    const next = change(record);
    if (next === record) return true;
    const updated: Message = { ...row, meta: { ...row.meta, call: next } };
    new MessageRepo(s.db).update(updated);
    s.bus.emit('message.updated', updated);
    return true;
  } catch (error) {
    s.log.warn('call row not written', { rowId, error: String(error) });
    return false;
  }
}

/** What a take gave: the call, its holder now, whether it answered a ring, and the row as it reads now. */
export interface Taken { callId: string; holder: string; answered: boolean; record: CallRecord }

export class CallLog {
  private readonly services: () => RuntimeServices;
  private readonly calls = new Map<string, OpenCall>();
  private readonly listening: Array<() => void>;
  /** Calls another device took from this PC (newest last, bounded): a late line of the old device joins them. */
  private taken: string[] = [];
  /** Who is told that a call of this PC ended (the call voice's hand-over; `handOver` false: it left this PC another way). */
  private ending: Array<(conversationId: string, callId: string, handOver: boolean) => void> = [];
  /** Who is told that a call opened on this PC (the call voice opens its session). */
  private starting: Array<(conversationId: string, callId: string) => void> = [];

  constructor(services: () => RuntimeServices) {
    this.services = services;
    const bus = this.s.bus;
    this.listening = [
      bus.on('message.created', (message) => this.heard(message)),
      bus.on('message.updated', (message) => {
        this.left(message);
        this.heard(message);
        if (message.editedAt !== undefined && message.state === 'final' && !callRecord(message)) this.follow(message.conversationId, message.id, message);
      }),
      bus.on('message.removed', ({ id, conversationId }) => this.follow(conversationId, id)),
    ];
  }

  private get s(): RuntimeServices { return this.services(); }

  /**
   * This device's call in the chat: the one `callId` names or the one open there, else a new row. `signal`: the device's
   * connection – its closing ends a new call. Throws not_found for an unknown chat.
   */
  start(conversationId: string, device: CallDevice, signal?: AbortSignal, callId?: string): string {
    const mine = (call: OpenCall | undefined) => call && call.conversationId === conversationId && call.device.key === device.key ? call : undefined;
    const open = mine(callId ? this.calls.get(callId) : undefined) ?? [...this.calls.values()].find((call) => mine(call));
    if (open) return open.id;
    if (callId && this.taken.includes(callId)) return callId; // B-081: another device holds it now; this late line joins it there
    const s = this.s;
    if (!s.chats.get(conversationId)) throw new WorkforceError('not_found', 'Chat not found.', { details: { conversationId } });
    const now = s.clock.now();
    const id = newId('call', now);
    const text = `Call from ${device.name}`;
    const pc = thisPc(s);
    const record: CallRecord = { id, participant: `device:${device.key}`, name: device.name, ...(pc ? { pc } : {}), startedAt: now, lines: [] };
    const row = s.chats.send({ conversationId, body: text, kind: 'status', silent: true, authorId: SYSTEM_ID, authorKind: 'system', mentions: [], meta: { status: { type: 'note', text }, call: record } });
    this.open({ id, rowId: row.id, conversationId, device, seq: row.seq }, signal);
    return id;
  }

  /**
   * B-081: this device takes the call `callId` of the chat – it answers a ring or takes the call over from another device
   * (also one on another PC: the synced row tells that PC). Refused when the call already ended (a ring that rang out too).
   */
  take(conversationId: string, callId: string, device: CallDevice, signal?: AbortSignal): Taken {
    const s = this.s;
    const rowId = this.calls.get(callId)?.rowId ?? callRowId(s, conversationId, callId);
    const row = rowId ? quiet(() => s.chats.message(rowId), undefined) : undefined;
    const record = row ? callRecord(row) : undefined;
    if (!row || !record || row.conversationId !== conversationId) throw new WorkforceError('not_found', 'Call not found.', { details: { callId } });
    const now = s.clock.now();
    const state = callState(record, now);
    if (state !== 'ringing' && state !== 'running') throw new WorkforceError('conflict', 'The call already ended.', { details: { callId } });
    const pc = thisPc(s);
    const participant = `device:${device.key}`;
    const held = this.calls.get(callId);
    if (held && held.device.key === device.key && record.participant === participant) return { callId, holder: callHolder(record), answered: false, record };
    if (held) this.letGo(held); // another device of this PC had it
    const answered = state === 'ringing';
    const next: CallRecord = { ...record, participant, name: device.name, ...(pc ? { pc } : {}), ...(answered && record.ring ? { ring: { ...record.ring, answeredAt: now } } : {}) };
    if (!pc) delete next.pc;
    writeCallRow(s, row.id, () => next);
    this.open({ id: callId, rowId: row.id, conversationId, device, seq: row.seq }, signal);
    return { callId, holder: callHolder(next), answered, record: next };
  }

  /** B-081: the holder of an open call of this PC (callHolder of its row), else undefined. */
  holder(callId: string): string | undefined {
    const call = this.calls.get(callId);
    if (!call) return undefined;
    const pc = thisPc(this.s);
    return callHolder({ ...(pc ? { pc } : {}), participant: `device:${call.device.key}` });
  }

  /** B-081: the call's record (open here or in the chat), else undefined. */
  record(conversationId: string, callId: string): CallRecord | undefined {
    const rowId = this.calls.get(callId)?.rowId ?? callRowId(this.s, conversationId, callId);
    const row = rowId ? quiet(() => this.s.chats.message(rowId), undefined) : undefined;
    return row ? callRecord(row) : undefined;
  }

  /** B-081: an agent joins a call of this PC (the talker gave it a line): it is in record.agents from now on. */
  join(conversationId: string, callId: string, agentId: string): void {
    const rowId = this.calls.get(callId)?.rowId ?? callRowId(this.s, conversationId, callId);
    if (rowId) writeCallRow(this.s, rowId, (record) => (record.agents?.includes(agentId) ? record : { ...record, agents: [...(record.agents ?? []), agentId] }));
  }

  /** Ends an open call (a device key: only that device's – another device's call is not its to end). */
  end(callId: string, deviceKey?: string): void {
    const call = this.calls.get(callId);
    if (!call) return;
    if (deviceKey !== undefined && call.device.key !== deviceKey) throw new WorkforceError('forbidden', 'This call belongs to another device.');
    this.calls.delete(callId);
    call.off();
    this.write(call.rowId, (record) => ({ ...record, endedAt: this.s.clock.now() }));
    this.keep(call.rowId, false);
    // KI-Runde 17.11.2026 (decision 8.4): the call's voice does its last act with the whole call in its session.
    this.tell(call, true);
  }

  /** The listeners of a call's end; `handOver` false: it left this PC without an end here (taken by another PC, its row deleted). */
  private tell(call: OpenCall, handOver: boolean): void {
    for (const listener of this.ending) { try { listener(call.conversationId, call.id, handOver); } catch (error) { this.s.log.warn('call end listener failed', { callId: call.id, error: String(error) }); } }
  }

  /** KI-Runde 17.11.2026: told when a call of this PC ends (the voice's hand-over, wiring.ts); returns its end. */
  onEnd(listener: (conversationId: string, callId: string, handOver: boolean) => void): () => void {
    this.ending.push(listener);
    return () => { this.ending = this.ending.filter((other) => other !== listener); };
  }

  /** KI-Runde 17.11.2026 (decision 7.1): told when a call opens on this PC – started or taken (the voice opens its session); returns its end. */
  onStart(listener: (conversationId: string, callId: string) => void): () => void {
    this.starting.push(listener);
    return () => { this.starting = this.starting.filter((other) => other !== listener); };
  }

  /** KI-Runde 17.11.2026: the calls running on this PC right now (the fold asks whether its agent is in one). */
  running(): RunningCall[] {
    return [...this.calls.values()].map((call) => ({ callId: call.id, conversationId: call.conversationId }));
  }

  /** Whether an agent of this company is in a call running on this PC right now (a member of its chat). */
  inCall(agentId: string): boolean {
    return this.running().some((call) => quiet(() => this.s.chats.members(call.conversationId), []).some((member) => member.memberId === agentId && member.kind === 'agent' && member.leftAt === undefined));
  }

  /** Shutdown: the calls are let go; their rows end at the next start (endLeftOpen), when the end can travel. */
  stop(): void {
    for (const call of this.calls.values()) call.off();
    this.calls.clear();
    this.ending = []; // a shutdown is no end of a call: the voice's own stop() handles its open lines
    this.starting = [];
    for (const off of this.listening.splice(0)) off();
  }

  /** Start-up: the calls this PC left open (a stop or a crash) end at their last line. Returns how many. */
  endLeftOpen(): number {
    const kv = new KvRepo(this.s.db);
    const left = kv.get<string[]>(KV_NS, KV_KEY) ?? [];
    const pc = thisPc(this.s);
    let ended = 0;
    for (const rowId of Array.isArray(left) ? left : []) {
      // B-081: a row another PC holds by now (it took the call) is that PC's to end.
      if (this.write(rowId, (record) => (record.endedAt === undefined && record.pc === pc ? { ...record, endedAt: record.lines.at(-1)?.at ?? record.startedAt } : record))) ended++;
    }
    kv.delete(KV_NS, KV_KEY);
    return ended;
  }

  /** The rows of open calls, kept for the next start (endLeftOpen): a call row joins on start (or a ring) and leaves when it ends. */
  keep(rowId: string, open: boolean): void {
    const kv = new KvRepo(this.s.db);
    const known = kv.get<string[]>(KV_NS, KV_KEY);
    const rows = [...(Array.isArray(known) ? known : []).filter((entry) => entry !== rowId), ...(open ? [rowId] : [])];
    if (rows.length) kv.set(KV_NS, KV_KEY, rows, this.s.clock.now()); else kv.delete(KV_NS, KV_KEY);
  }

  /** A final row of an open call's chat after its row joins its lines (once; edits come through follow). */
  private heard(message: Message): void {
    for (const call of [...this.calls.values()]) {
      const line = lineOf(this.s, call, message);
      if (line) this.write(call.rowId, (record) => (record.lines.some((entry) => entry.messageId === line.messageId) ? record : { ...record, lines: [...record.lines, line].slice(-CALL_LINES) }));
    }
  }

  /**
   * A row was edited (`message`) or deleted: its line follows in every call row of this PC that names it – open or ended –
   * with the new text, or out. A deleted open call row ends that call here: nothing is left to write.
   */
  private follow(conversationId: string, messageId: string, message?: Message): void {
    for (const call of [...this.calls.values()]) {
      if (!message && call.rowId === messageId) { this.calls.delete(call.id); call.off(); this.keep(call.rowId, false); this.tell(call, false); }
    }
    const s = this.s;
    const rows = quiet(() => s.db.all<{ id: string }>(LISTING, [conversationId, JSON.stringify(messageId)]), []);
    if (!rows.length) return;
    const pc = thisPc(s);
    const text = message ? lineText(message) : undefined;
    for (const { id } of rows) {
      this.write(id, (record) => {
        const at = record.pc === pc ? record.lines.findIndex((line) => line.messageId === messageId) : -1;
        if (at < 0 || record.lines[at].text === text) return record;
        return { ...record, lines: text ? record.lines.map((line, index) => (index === at ? { ...line, text } : line)) : record.lines.filter((_, index) => index !== at) };
      });
    }
  }

  /** An open call of this device: lines join it, its connection closing ends it, the next start knows it. */
  private open(call: Omit<OpenCall, 'off'>, signal?: AbortSignal): void {
    const ended = () => this.end(call.id);
    signal?.addEventListener('abort', ended, { once: true });
    this.calls.set(call.id, { ...call, off: () => signal?.removeEventListener('abort', ended) });
    this.keep(call.rowId, true);
    if (signal?.aborted) { this.end(call.id); return; }
    for (const listener of this.starting) { try { listener(call.conversationId, call.id); } catch (error) { this.s.log.warn('call start listener failed', { callId: call.id, error: String(error) }); } }
  }

  /** B-081: an open call's row shows another holder (another device took it, here or by sync): it goes without an end. */
  private left(message: Message): void {
    const record = callRecord(message);
    const call = record ? this.calls.get(record.id) : undefined;
    if (record && call && call.rowId === message.id && this.holder(call.id) !== callHolder(record)) { this.letGo(call); this.tell(call, false); }
  }

  /** The call is another device's now: no end is written, and a late line of the old device still joins it (start). */
  private letGo(call: OpenCall): void {
    this.calls.delete(call.id);
    call.off();
    this.keep(call.rowId, false);
    this.taken = [...this.taken.filter((id) => id !== call.id), call.id].slice(-50);
  }

  private write(rowId: string, change: (record: CallRecord) => CallRecord): boolean {
    return writeCallRow(this.s, rowId, change);
  }
}
