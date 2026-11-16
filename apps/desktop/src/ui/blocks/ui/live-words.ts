// F23 (owner 16.11.2026: "währenddessen irgendwie was ablesen … Die Transkription, die blitzschnell ist, dass man es dann
// praktisch sieht, ob man schneller oder langsamer reden muss"): the words heard so far while recording – under the timer
// of the composer's RecordBar and of the `record` widget, where a script follows them (prompter.ts). One microphone: the
// recorder's own stream (recorder.ts) also feeds a Dictation of its own (lib/dictation.ts through lib/microphone.ts's
// `stream`), cut short by LiveCutter – a piece from LIVE_MIN_MS on ends at the next pause of LIVE_PAUSE_MS, at the
// latest at LIVE_MAX_MS at its quietest block; silence and a lone click make no piece – and each piece is heard as a
// `live` line (no second model, no marks). So the words come honestly 1–4 s behind: a piece's length plus its hearing.
// They are a view only: nothing of them is kept, and the first piece that cannot be heard ends them for this take,
// its reason shown instead.
// Owns: the short cut, the hook and what it shows. Never: records, keeps or attaches anything, or opens a device.

import { effect } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { Dictation, DictationCancelled, dictationNote, recordingProblem } from '../../lib/dictation.ts';
import type { DictationDeps, HeardPiece } from '../../lib/dictation.ts';
import { uploadRef } from '../../lib/files.ts';
import { openMicrophone } from '../../lib/microphone.ts';
import { PCM_RATE } from '../../lib/pcm.ts';
import { rpc } from '../../lib/rpc.ts';
import { settings } from '../../lib/store.ts';
import { pcmLevel } from '../../lib/take-pieces.ts';
import type { Piece } from '../../lib/take-pieces.ts';
import { wordsPerMinute } from './prompter.ts';

/** A piece is at least this long before a pause ends it. */
export const LIVE_MIN_MS = 1_500;
/** The pause that ends a piece. */
export const LIVE_PAUSE_MS = 200;
/** Without such a pause a piece is cut here, at its quietest block of the last SEARCH_MS. */
export const LIVE_MAX_MS = 3_500;
const SEARCH_MS = 800;
/** A piece starts this long before its first sound, so its first word is whole. */
const LEAD_MS = 200;
/** Less sound than this in a piece (a click, a breath) is no piece. */
const SOUND_MIN_MS = 150;
const BYTES_PER_MS = 32; // 16 kHz × 2 bytes
// The quiet rule of take-pieces.ts: three times the room's floor (falls at once, rises over FLOOR_RISE_MS), within QUIET_MIN..QUIET_MAX.
const FLOOR_RISE_MS = 10_000;
const QUIET_MIN = 0.003;
const QUIET_MAX = 0.012;
const BLOCK_MS = 32;

interface Block { pcm: Uint8Array; ms: number; level: number; quiet: boolean }

const msOf = (blocks: readonly Block[]) => blocks.reduce((total, block) => total + block.ms, 0);

/** Cuts a running take into short pieces for the live words (16 kHz PCM16 blocks in, pieces out). */
export class LiveCutter {
  private blocks: Block[] = [];
  private ms = 0;
  /** Quiet ms at the end. */
  private run = 0;
  private floor = Infinity;

  push(pcm: Uint8Array): Piece | null {
    if (!pcm.byteLength) return null;
    const ms = pcm.byteLength / BYTES_PER_MS;
    const level = pcmLevel(pcm);
    const quiet = this.isQuiet(level, ms);
    this.blocks.push({ pcm, ms, level, quiet });
    this.ms += ms;
    this.run = quiet ? this.run + ms : 0;
    if (this.run >= this.ms) { // nothing but quiet yet: only the lead-in is kept
      while (this.blocks.length > 1 && this.ms - this.blocks[0].ms >= LEAD_MS) this.ms -= this.blocks.shift()!.ms;
      this.run = this.ms;
      return null;
    }
    if (this.ms >= LIVE_MIN_MS && this.run >= LIVE_PAUSE_MS) return this.cut(this.blocks.length);
    if (this.ms >= LIVE_MAX_MS) return this.cut(this.quietest() + 1);
    return null;
  }

  /** The rest as the last piece (null: nothing worth hearing). */
  flush(): Piece | null {
    return this.cut(this.blocks.length);
  }

  private isQuiet(level: number, ms: number): boolean {
    if (level < this.floor) this.floor = level;
    else this.floor += (level - this.floor) * Math.min(1, ms / FLOOR_RISE_MS);
    return level <= Math.min(QUIET_MAX, Math.max(QUIET_MIN, this.floor * 3));
  }

  /** The index of the quietest block of the last SEARCH_MS. */
  private quietest(): number {
    let best = this.blocks.length - 1;
    for (let index = best, ms = 0; index >= 0 && ms < SEARCH_MS; ms += this.blocks[index--].ms) {
      if (this.blocks[index].level < this.blocks[best].level) best = index;
    }
    return best;
  }

  private cut(index: number): Piece | null {
    const piece = this.blocks.slice(0, index);
    this.blocks = this.blocks.slice(index);
    this.ms = msOf(this.blocks);
    this.run = 0;
    for (let at = this.blocks.length - 1; at >= 0 && this.blocks[at].quiet; at--) this.run += this.blocks[at].ms;
    const sound = msOf(piece.filter((block) => !block.quiet));
    return sound >= SOUND_MIN_MS ? { pcm: piece.map((block) => block.pcm), ms: msOf(piece) } : null;
  }
}

/** What the record views show under the timer. */
export interface LiveWords {
  /** The words heard so far ('' before the first). */
  text: string;
  /** The speaker's words per minute of about the last half minute (once enough words were heard). */
  wpm?: number;
  /** Why no words come: this page cannot hear, or a piece could not be heard. */
  note?: string;
}

/** A Dictation of its own on the recorder's stream: short pieces, each heard as a live line. */
export function liveDeps(stream: MediaStream): DictationDeps {
  return {
    problem: recordingProblem,
    openMicrophone: (onSamples) => openMicrophone(onSamples, { sampleRate: PCM_RATE, blockMs: BLOCK_MS, stream }),
    upload: (blob, name) => uploadRef(blob, name),
    transcribe: (params) => rpc.call('voice.transcribe', { ...params, live: true }),
    now: () => Date.now(),
    cutter: () => new LiveCutter(),
  };
}

/** The pieces' words as one line. */
export function liveText(pieces: readonly HeardPiece[]): string {
  return pieces.flatMap((piece) => (piece.text?.trim() ? [piece.text.trim()] : [])).join(' ');
}

/** The line under the timer: the words, else why none come, else "Listening…" once the recorder records. */
export function liveLine(words: LiveWords, started: boolean): string {
  return words.text || words.note || (started ? 'Listening…' : '');
}

/** The line's tooltip: what it is and how late. */
export const LIVE_TITLE = 'Heard so far, a few seconds behind';

/** The words heard on `stream` while `on` (recording; `chatId`: context for a listening model). */
export function useLiveWords(stream: MediaStream | null, on: boolean, chatId?: string): LiveWords {
  const [pieces, setPieces] = useState<readonly HeardPiece[]>([]);
  const [note, setNote] = useState<string | undefined>(undefined);
  useEffect(() => {
    setPieces([]);
    setNote(undefined);
    if (!on || !stream) return;
    const blocked = dictationNote();
    if (blocked) { setNote(blocked); return; }
    const hearing = new Dictation(liveDeps(stream));
    const watch = effect(() => {
      const heard = hearing.heardPieces.value;
      const failed = heard.find((piece) => piece.error);
      if (failed) { hearing.cancel(); setNote(failed.error); }
      setPieces(heard);
    });
    hearing.start(undefined, { language: settings.peek()?.profile.language, ...(chatId ? { chatId } : {}) }).catch((error: unknown) => {
      if (!(error instanceof DictationCancelled)) setNote('Live words are not available for this recording.');
    });
    return () => { watch(); hearing.cancel(); };
  }, [on, stream]);
  const wpm = wordsPerMinute(pieces);
  return { text: liveText(pieces), ...(wpm ? { wpm: Math.round(wpm) } : {}), ...(note ? { note } : {}) };
}
