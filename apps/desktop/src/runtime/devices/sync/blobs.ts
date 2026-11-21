// Stored files (attachments, avatars: <blobs>/ab/cd/<sha256>) between the CEO's own PCs: their `files` rows travel
// as rows (tables.ts), the bytes when they are first needed – a reader that finds a blob missing awaits needBlob(),
// which pulls it by its sha from a CEO PC (op 'blob' of 'sync.file', files.ts) into <blobs>/tmp (mode 0600),
// checks the hash and puts it in place. B-080: every CEO PC is asked, the online ones first – devices.call dials one
// without a live link (a flapping link's gap no longer ends the pull). One pull per blob at a time; false when no CEO PC had it.
// B-080 F4 (live: 9 of 10 recordings of 05.11. never got their length – their bytes came later, by a reader's pull,
// which never reached the media hook): bytes that landed here are reported to the file store's arrival listener
// (onArrival; compose/services.ts: the media library probes them then).
// Owns: these pulls and the pieces this PC serves. Never: serves a blob without its files row, asks a PC that is no
// 'ceo' link, passes a request on to a third PC, or logs content.

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeServices } from '../../contracts.ts';
import { hashFile, pullPieces, readPiece, replaceWith, type Piece } from './file-io.ts';
import { links } from './home.ts';

const SHA256 = /^[a-f0-9]{64}$/;
/** Running pulls by blob path (one data folder per runtime, so one entry per blob). */
const pulling = new Map<string, Promise<boolean>>();

export type BlobServices = Pick<RuntimeServices, 'db' | 'files' | 'devices' | 'log' | 'paths'>;

const errorText = (error: unknown) => String((error as Error)?.message ?? error);

/** Who hears that pulled bytes landed here, per file store (one runtime's store, never another's). */
const arrivals = new WeakMap<object, (id: string) => void>();

/** B-080 F4: `listener` hears each blob id whose bytes a pull put in place for `files` (the media library's probe). */
export function onArrival(files: RuntimeServices['files'], listener: (id: string) => void): void {
  arrivals.set(files, listener);
}

/** A piece of a blob this PC has (its files row and its bytes); undefined: not here. */
export async function blobPiece(s: Pick<RuntimeServices, 'files'>, id: string, offset: number): Promise<Piece | undefined> {
  if (!SHA256.test(id) || !s.files.get(id)) return undefined;
  return readPiece(s.files.path(id), offset);
}

/** Makes sure the bytes of stored file `id` are here: true when they are (now). */
export function needBlob(s: BlobServices, id: string): Promise<boolean> {
  if (!SHA256.test(id)) return Promise.resolve(false);
  const file = s.files.path(id);
  let running = pulling.get(file);
  if (!running) {
    running = pull(s, id, file).finally(() => pulling.delete(file));
    pulling.set(file, running);
  }
  return running;
}

async function pull(s: BlobServices, id: string, file: string): Promise<boolean> {
  if ((await lstat(file).catch(() => undefined))?.isFile()) return true;
  const peers = links(s.db).filter(({ link }) => link.kind === 'ceo').map(({ record }) => record.id)
    .sort((a, b) => Number(s.devices.online(b)) - Number(s.devices.online(a)));
  for (const peer of peers) {
    const temp = path.join(s.paths.blobs, 'tmp', `${randomUUID()}.part`); // a crash leaves it to the blob clean-up
    try {
      await mkdir(path.dirname(temp), { recursive: true });
      await pullPieces(temp, (offset) => s.devices.call(peer, 'sync.file', { op: 'blob', id, offset }));
      if (await hashFile(temp) !== id) throw new Error('other bytes arrived');
      await mkdir(path.dirname(file), { recursive: true });
      await replaceWith(temp, file);
      try { arrivals.get(s.files)?.(id); } catch (error) { s.log.info('stored file arrival not heard', { id, error: errorText(error) }); }
      return true;
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      s.log.info('stored file not pulled', { id, peer, error: errorText(error) });
    }
  }
  return false;
}
