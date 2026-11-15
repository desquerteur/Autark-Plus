// Dictation becomes text (B-078, live analysis 06.11.: voice messages kept an empty body, every agent transcribed
// late on its own, one blob was never found): a person's message that is only a recording is transcribed once on
// arrival (RuntimeServices.stt.transcript – one at a time, redacted, cached in the file row) and the transcript is
// written into the message body, marked meta.dictation { fileId } – that mark travels with the row, so every linked PC's
// agent context reads the stored text instead of the recording (context/attachments.ts, dictated()). Only the PC where
// the message was written transcribes it: there the recording's bytes are stored before the message is posted, while a
// PC that took the row by sync has only the files row (bytes come when first needed, devices/sync/blobs.ts) and gets
// the body with the row. A busy decoder is tried again a few times, further apart each time (RETRY_MS, the steps the
// media probe uses for a missing blob, service.ts). A recording that yields no transcript (silence, a failure, speech
// to text not ready, the last busy try) is marked meta.dictation { fileId, failed } so nothing waits for it. A quick task posted with only a recording (origin intake, titled
// with the file's name) gets its title and notes from the transcript. B-082: the body is plain text; the hearing's unsure
// places travel beside it as meta.marks (spans, shared/voice/marks.ts), and a failed one can be heard again on the
// person's word (retry – RPC voice.retranscribe, rpc/handlers/voice-retry.ts).
// Owns: those transcriptions and the body/title writes. Never: transcribes when speech to text is not ready or, on
// arrival, a message another PC wrote (a retry pulls its bytes), overwrites a body or title someone already wrote, retries without end, or logs a transcript.

import { existsSync } from 'node:fs';
import { SYSTEM_ID } from '../../shared/ids.ts';
import type { Attachment, Message } from '../../shared/model/chat.ts';
import { ORIGINS } from '../../shared/model/origin.ts';
import type { TaskView } from '../../shared/model/tasks.ts';
import { excerpt } from '../../shared/text/chat-names.ts';
import { WorkforceError } from '../../shared/errors.ts';
import { cleanMarks, spansFromInline, type MarkedText } from '../../shared/voice/marks.ts';
import type { RuntimeServices } from '../contracts.ts';
import { MessageRepo } from '../chat/message-repo.ts';
import { needBlob } from '../devices/sync/blobs.ts';
import { quickFiles } from '../tasks/quick.ts';

/** The waits before each further try while the decoder is busy (and, in service.ts, while a probed blob is missing). */
export const RETRY_MS = [2_000, 10_000, 30_000, 120_000, 600_000];
const MAX_BODY = 20_000;

export interface DictationDeps {
  services: () => RuntimeServices;
  /** Timer (tests pass their own); default an unref'd setTimeout. */
  later?: (fn: () => void, ms: number) => void;
}

interface Job { key: string; file: Attachment; write: (heard: MarkedText) => void; unheard?: () => void; chatId?: string; once?: (heard: boolean) => void }

const isRecording = (mime: string) => /^(audio|video)\//i.test(mime.split(';')[0].trim());
const defaultLater = (fn: () => void, ms: number) => { const timer = setTimeout(fn, ms); (timer as { unref?: () => void }).unref?.(); };
const dictations = new WeakMap<object, Dictation>();

/** The runtime's dictation (RPC voice.retranscribe), or undefined (tests, headless setups). */
export const dictationOf = (services: object): Dictation | undefined => dictations.get(services);

/** Whether `fileId` was transcribed into a message's body (its text is there) – read from the synced row's meta. */
export function dictated(db: RuntimeServices['db'], fileId: string): boolean {
  try {
    return db.get(`SELECT 1 AS hit FROM messages WHERE attachments <> '[]' AND json_extract(meta, '$.dictation.fileId') = ?
      AND json_extract(meta, '$.dictation.failed') IS NULL LIMIT 1`, [fileId]) !== undefined;
  } catch { return false; }
}

/** The bytes of `fileId` are on this PC now (no pull). */
function bytesHere(s: RuntimeServices, fileId: string): boolean {
  try { return existsSync(s.files.path(fileId)); } catch { return false; }
}

/** Makes sure a blob is here (pulled from a linked PC when it is not); true when it is. */
export async function blobHere(s: RuntimeServices, fileId: string): Promise<boolean> {
  try { if (existsSync(s.files.path(fileId))) return true; } catch { return false; }
  try { return await needBlob(s, fileId); } catch { return false; }
}

export class Dictation {
  private readonly deps: DictationDeps;
  private readonly running = new Set<string>();

  constructor(deps: DictationDeps) {
    this.deps = deps;
    const s = deps.services();
    dictations.set(s, this);
    s.bus.on('message.created', (message) => this.onMessage(message));
    s.bus.on('task.upserted', (task) => this.onTask(task));
  }

  /**
   * A person's final text message whose body is empty and that carries a recording – written on this PC: its bytes are
   * here. A row another PC wrote arrives without them (synced rows bring the files row only); that PC transcribes it.
   */
  onMessage(message: Message): void {
    if (message.authorKind !== 'human' || message.kind !== 'text' || message.state !== 'final' || message.body.trim()) return;
    const file = (message.attachments ?? []).find((attachment) => isRecording(attachment.mime));
    if (file && bytesHere(this.deps.services(), file.fileId)) {
      this.start(`m:${message.id}`, file, (text) => this.writeBody(message.id, file.fileId, text), () => this.markUnheard(message.id, file.fileId), message.conversationId);
    }
  }

  /** A new quick task named after its only recording (it is read once its files are stored, after create). */
  onTask(task: TaskView): void {
    if (task.origin?.source !== ORIGINS.intake.source || task.rev !== 0 || task.notes) return;
    const later = this.deps.later ?? defaultLater;
    later(() => {
      const file = quickFiles(this.deps.services().db, task.id).find((attachment) => isRecording(attachment.mime));
      if (file && task.title === excerpt(file.name, 120)) this.start(`t:${task.id}`, file, (text) => this.writeTitle(task.id, file.name, text));
    }, 0);
  }

  /**
   * The person asks to hear a sent recording again whose hearing failed (meta.dictation.failed, body still empty): one
   * try, no busy retries; true when the text is in the body now (meta.dictation loses `failed`).
   */
  async retry(message: Message): Promise<boolean> {
    const fileId = (message.meta?.dictation as { fileId?: unknown; failed?: unknown } | undefined)?.fileId;
    const file = (message.attachments ?? []).find((attachment) => attachment.fileId === fileId && isRecording(attachment.mime));
    const key = `m:${message.id}`;
    if (!file || message.body.trim() || this.running.has(key)) return false;
    this.running.add(key);
    // Asked on a linked PC (the row came by sync), the bytes are pulled from the PC that holds them first.
    if (!(await blobHere(this.deps.services(), file.fileId))) { this.running.delete(key); return false; }
    return new Promise((resolve) => {
      void this.attempt({ key, file, write: (heard) => this.writeBody(message.id, file.fileId, heard), chatId: message.conversationId, once: resolve }, RETRY_MS.length);
    });
  }

  /** Resolves when nothing is being transcribed (tests). */
  busy(): boolean { return this.running.size > 0; }

  private start(key: string, file: Attachment, write: (heard: MarkedText) => void, unheard?: () => void, chatId?: string): void {
    if (this.running.has(key)) return;
    this.running.add(key);
    void this.attempt({ key, file, write, unheard, chatId }, 0);
  }

  /** One try; every end without a transcript (not ready, nothing heard, a failure, the last busy try) calls `unheard`. */
  private async attempt(job: Job, tries: number): Promise<void> {
    const { key, file, write } = job;
    const s = this.deps.services();
    const stt = s.stt;
    let state: string;
    try { state = stt ? stt.state() : 'missing'; } catch { state = 'missing'; }
    if (state !== 'ready') { this.finish(job, false); return; } // agents get the reason with the attachment
    let again = false;
    let wrote = false;
    try {
      if (bytesHere(s, file.fileId)) {
        // A voice message is heard as dictation: unsure places marked, its chat as a listener's context.
        const raw = (await (job.chatId ? stt.transcript(file.fileId, { chatId: job.chatId }) : stt.transcript(file.fileId))).trim();
        const heard = spansFromInline(raw); // B-082: plain text, the unsure places as spans beside it
        if (heard.text.trim()) { write(heard); wrote = true; }
      }
    } catch (error) {
      again = error instanceof WorkforceError && error.code === 'conflict'; // the decoder was busy: later
      if (!again) s.log.debug('dictation not transcribed', { fileId: file.fileId, error: error instanceof WorkforceError ? error.code : 'failed' });
    }
    if (!again || tries >= RETRY_MS.length) { this.finish(job, wrote); return; }
    (this.deps.later ?? defaultLater)(() => { void this.attempt(job, tries + 1); }, RETRY_MS[tries]);
  }

  private finish(job: Job, wrote: boolean): void {
    this.running.delete(job.key);
    job.once?.(wrote);
    if (wrote || !job.unheard) return;
    try { job.unheard(); } catch (error) { this.deps.services().log.debug('dictation end not marked', { error: String(error).slice(0, 120) }); }
  }

  /**
   * No transcript comes: the row is marked meta.dictation { fileId, failed } (body untouched) so a line held for its
   * transcript (chat/delivery-dictation.ts) goes out at once and the agents read the recording as they always did.
   */
  private markUnheard(messageId: string, fileId: string): void {
    const s = this.deps.services();
    const repo = new MessageRepo(s.db);
    const message = repo.get(messageId);
    if (!message || message.body.trim() || message.meta?.dictation) return;
    message.meta = { ...message.meta, dictation: { fileId, failed: true } };
    repo.update(message);
    s.bus.emit('message.updated', message);
  }

  /**
   * The transcript as the plain body (its unsure places as meta.marks), marked as dictation (a `failed` goes) – only
   * while the body is still empty.
   */
  private writeBody(messageId: string, fileId: string, heard: MarkedText): void {
    const s = this.deps.services();
    const repo = new MessageRepo(s.db);
    const message = repo.get(messageId);
    if (!message || message.body.trim()) return;
    const body = heard.text.length > MAX_BODY ? `${heard.text.slice(0, MAX_BODY)}…` : heard.text;
    const marks = heard.marks ? cleanMarks(body, heard.marks) : undefined;
    const { marks: _old, ...meta } = message.meta ?? {};
    message.body = body;
    message.meta = { ...meta, dictation: { fileId }, ...(marks ? { marks } : {}) };
    repo.update(message);
    s.bus.emit('message.updated', message);
  }

  /** The quick task's title and notes from the transcript – while it still carries the file's name. */
  private writeTitle(taskId: string, name: string, heard: MarkedText): void {
    const s = this.deps.services();
    const text = heard.text.trim().slice(0, MAX_BODY); // B-082: a task's text is plain
    const task = s.tasks.get(taskId);
    if (!task || task.title !== excerpt(name, 120) || task.notes) return;
    const first = text.split(/(?<=[.!?])\s|\n/)[0] ?? text;
    try { s.tasks.update(taskId, { title: excerpt(first, 120), notes: text }, SYSTEM_ID); } catch (error) { s.log.debug('dictated task not renamed', { taskId, error: String((error as Error)?.message ?? error).slice(0, 120) }); }
  }
}
