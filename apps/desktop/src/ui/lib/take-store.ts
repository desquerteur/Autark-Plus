// B-082 (decision 6): a dictation piece whose upload failed (link down, phone offline) waits here – in this page's
// IndexedDB ('dictation:<key>' in pwa/idb.ts's store) and in memory, so it plays at once and also survives a page
// without IndexedDB (private window, blocked storage: then only until the page closes). flush() uploads the held
// pieces, oldest first, once the link is back; each one uploaded leaves the store and is reported (composer/voice.ts
// swaps its chip for the uploaded file). In a draft a held piece is an audio chip whose fileId is HELD_PREFIX + key
// (no file id: the runtime never stores it in a draft). Every storage call is caught: storage trouble keeps nothing
// in IndexedDB, it never fails a take.
// Owns: the held pieces and their object URLs. Never: hears, keeps a piece after it was uploaded or deleted, or holds
// anything but dictation audio.

import type { Attachment } from '../../shared/model/chat.ts';
import type { FileRef } from '../../shared/model/system.ts';
import { idbDelete, idbGet, idbSet, idbSweep } from '../pwa/idb.ts';

/** A held piece's chip fileId starts with this ('/' never occurs in a file id). */
export const HELD_PREFIX = 'held/';
const KEY_PREFIX = 'dictation:';

export interface HeldTake {
  key: string;
  name: string;
  size: number;
  /** When it was held (epoch ms). */
  at: number;
  /** The draft whose chip it is; absent for a field that cannot hold a chip. */
  owner?: string;
}

interface Stored extends HeldTake { blob: Blob }

/** The storage underneath (IndexedDB in the page, a map in tests). */
export interface KeyValue {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** Every value under `prefix`. */
  values(prefix: string): Promise<unknown[]>;
}

function valid(value: unknown): value is Stored {
  const entry = value as Partial<Stored> | null;
  return !!entry && typeof entry.key === 'string' && typeof entry.name === 'string' && typeof entry.at === 'number'
    && typeof Blob !== 'undefined' && entry.blob instanceof Blob && entry.blob.size > 0;
}

const view = ({ blob: _blob, ...held }: Stored): HeldTake => held;

export class TakeStore {
  private readonly memory = new Map<string, Stored>();
  private readonly urls = new Map<string, string>();
  private readonly dropped = new Set<string>();
  private flushing: Promise<void> | null = null;
  private seq = 0;
  private readonly kv: KeyValue | null;
  private readonly now: () => number;

  constructor(kv: KeyValue | null, now: () => number = Date.now) {
    this.kv = kv;
    this.now = now;
  }

  /** Holds a piece (memory at once, IndexedDB when it can). */
  async hold(blob: Blob, name: string, owner?: string): Promise<HeldTake> {
    const at = this.now();
    const key = `${at.toString(36)}-${(++this.seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const entry: Stored = { key, name, size: blob.size, at, ...(owner ? { owner } : {}), blob };
    this.memory.set(key, entry);
    await this.safe(() => this.kv?.set(KEY_PREFIX + key, entry));
    return view(entry);
  }

  /** Every held piece, oldest first. */
  async list(): Promise<HeldTake[]> {
    return (await this.entries()).map(view);
  }

  /** A held piece's audio as an object URL (made once), for its chip's play button. */
  async url(key: string): Promise<string | undefined> {
    const known = this.urls.get(key);
    if (known) return known;
    const entry = this.memory.get(key) ?? await this.safe(async () => { const value = await this.kv?.get(KEY_PREFIX + key); return valid(value) ? value : undefined; });
    if (!entry || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return undefined;
    const url = URL.createObjectURL(entry.blob);
    this.urls.set(key, url);
    return url;
  }

  /** Deletes a held piece (the person removed its chip, or its take was discarded). */
  async drop(key: string): Promise<void> {
    this.dropped.add(key);
    await this.forget(key);
  }

  /**
   * Uploads the held pieces, oldest first; each uploaded one leaves the store and goes to `onUploaded` (unless it was
   * deleted meanwhile). The first failed upload ends the round: the link is still down. One round at a time.
   */
  flush(upload: (blob: Blob, name: string) => Promise<FileRef>, onUploaded: (held: HeldTake, ref: FileRef) => void): Promise<void> {
    this.flushing ??= (async () => {
      try {
        for (const entry of await this.entries()) {
          if (this.dropped.has(entry.key)) continue;
          let ref: FileRef;
          try { ref = await upload(entry.blob, entry.name); } catch { return; }
          if (this.dropped.has(entry.key)) continue;
          await this.forget(entry.key);
          onUploaded(view(entry), ref);
        }
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  private async entries(): Promise<Stored[]> {
    const all = new Map(this.memory);
    const stored = await this.safe(() => this.kv?.values(KEY_PREFIX)) ?? [];
    for (const value of stored) if (valid(value) && !all.has(value.key) && !this.dropped.has(value.key)) all.set(value.key, value);
    return [...all.values()].sort((a, b) => a.at - b.at);
  }

  private async forget(key: string): Promise<void> {
    this.memory.delete(key);
    const url = this.urls.get(key);
    if (url) { this.urls.delete(key); try { URL.revokeObjectURL(url); } catch { /* gone already */ } }
    await this.safe(() => this.kv?.remove(KEY_PREFIX + key));
  }

  private async safe<T>(run: () => Promise<T> | T | undefined): Promise<T | undefined> {
    try { return await run(); } catch { return undefined; }
  }
}

/** A held piece as the draft's audio chip. */
export function heldAttachment(held: HeldTake): Attachment {
  return { fileId: HELD_PREFIX + held.key, name: held.name, mime: 'audio/wav', size: held.size };
}

/** The held piece's key of a chip's fileId, or undefined for an uploaded file. */
export function heldKey(fileId: string): string | undefined {
  return fileId.startsWith(HELD_PREFIX) ? fileId.slice(HELD_PREFIX.length) : undefined;
}

/** This page's IndexedDB as the store underneath (pwa/idb.ts's one key/value store). */
const pageStorage: KeyValue = {
  get: (key) => idbGet(key),
  set: (key, value) => idbSet(key, value),
  remove: (key) => idbDelete(key),
  values: async (prefix) => {
    const out: unknown[] = [];
    await idbSweep(prefix, (value) => { out.push(value); return false; }); // a read: nothing is deleted
    return out;
  },
};

/** This page's held pieces. */
export const takeStore = new TakeStore(typeof indexedDB === 'undefined' ? null : pageStorage);
