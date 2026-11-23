// B-075: an agent reads an attachment uploaded on another of the person's PCs – the files row came with the chat
// (devices/sync), the bytes did not. prepare() ahead of the turn brings them from a linked CEO PC
// (devices/sync/blobs.ts needBlob), so the delta has the image input and the text file's text; a text file whose bytes
// are still away goes the async way instead of showing nothing. B-080: the missing bytes of several attachments are
// pulled at once (one shared dial of a PC that is away).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addFile, fixture } from './fixture.ts';
import { DevicesRepo, type DeviceRecord } from '../../../src/runtime/devices/repo.ts';
import { readPiece } from '../../../src/runtime/devices/sync/file-io.ts';

const record = (id: string, extra: Partial<DeviceRecord> = {}): DeviceRecord => ({
  id, name: id, kind: 'pc', role: 'home', fingerprint: `fp_${id}`, addresses: [], caps: {}, status: 'online', self: false, ...extra,
});
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('prepare brings an attachment\'s bytes from the PC it was uploaded on; the delta then has the image and the text', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wf-remote-files-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture();
  const blobs = path.join(root, 'blobs');
  const laptop = path.join(root, 'laptop'); // the other PC's blobs, by id
  mkdirSync(laptop, { recursive: true });
  const at = (id: string) => path.join(blobs, id.slice(0, 2), id.slice(2, 4), id);
  const photo = Buffer.from('\x89PNG pretend picture');
  const notes = Buffer.from('Budget: 400 EUR');
  for (const bytes of [photo, notes]) writeFileSync(path.join(laptop, sha(bytes)), bytes);
  const pulled: string[] = [];
  const read: string[] = []; // files.text: the store reads what is here
  Object.assign(f.services, {
    files: { ...f.services.files, path: at, text: async (id: string) => { read.push(id); return readFile(at(id), 'utf8').catch(() => undefined); } },
    paths: { ...f.services.paths, blobs },
    devices: {
      online: (peer: string) => peer === 'dev_laptop',
      call: async (_peer: string, _method: string, params: { id: string; offset: number }) => { pulled.push(params.id); return readPiece(path.join(laptop, params.id), params.offset); },
    },
  });
  const repo = new DevicesRepo(f.db);
  repo.upsert(record('dev_self', { self: true }));
  repo.upsert(record('dev_laptop', { joinedAs: 'ceo' }));
  addFile(f.db, sha(photo), 'shot.png', 'image/png');
  addFile(f.db, sha(notes), 'notes.txt', 'text/plain');
  const chat = f.chats.create({ agentIds: [f.vid.id], createdBy: 'human' });
  f.chats.send({
    conversationId: chat.id, body: 'From the laptop', authorId: 'human',
    attachments: [{ fileId: sha(photo), name: 'shot.png', mime: 'image/png', size: photo.length }, { fileId: sha(notes), name: 'notes.txt', mime: 'text/plain', size: notes.length }],
  });

  await f.context.prepare({ agentId: f.vid.id, conversationId: chat.id, sinceSeq: 0 });
  assert.deepEqual(pulled.sort(), [sha(notes), sha(photo)].sort());
  assert.ok(existsSync(at(sha(photo))) && existsSync(at(sha(notes))), 'both are here now');
  const delta = f.context.delta({ agent: f.vid, conversationId: chat.id, sinceSeq: 0 });
  assert.deepEqual(delta.images, [{ path: at(sha(photo)), mime: 'image/png' }]);
  assert.match(delta.text, /\[Attached file: notes\.txt\][^\n]*\nBudget: 400 EUR/);
  assert.equal(delta.lastSeq, 1);

  // A text file whose bytes are still away: its text is read the async way (files.text), never left out.
  const later = Buffer.from('Arrives later');
  addFile(f.db, sha(later), 'later.txt', 'text/plain');
  f.chats.send({ conversationId: chat.id, body: 'One more', authorId: 'human', attachments: [{ fileId: sha(later), name: 'later.txt', mime: 'text/plain', size: later.length }] });
  const waiting = f.context.delta({ agent: f.vid, conversationId: chat.id, sinceSeq: 1 });
  assert.match(waiting.text, /Text extraction is still running/);
  assert.equal(waiting.lastSeq, 1, 'the message stays unseen until its text is there');
  assert.ok(read.includes(sha(later)), 'read the async way');
});

test('B-080: the missing bytes of several attachments are pulled at once – they share the one dial of a PC that is away', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wf-remote-files-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture();
  const blobs = path.join(root, 'blobs');
  const notebook = path.join(root, 'notebook');
  mkdirSync(notebook, { recursive: true });
  const at = (id: string) => path.join(blobs, id.slice(0, 2), id.slice(2, 4), id);
  const shots = [1, 2, 3].map((n) => Buffer.from(`\x89PNG picture ${n}`));
  for (const bytes of shots) writeFileSync(path.join(notebook, sha(bytes)), bytes);
  let dialed!: () => void;
  const dial = new Promise<void>((resolve) => { dialed = resolve; }); // one dial of the sleeping notebook, every pull waits on it
  const waiting: string[] = [];
  Object.assign(f.services, {
    files: { ...f.services.files, path: at },
    paths: { ...f.services.paths, blobs },
    devices: {
      online: () => false,
      call: async (_peer: string, _method: string, params: { id: string; offset: number }) => {
        if (params.offset === 0) waiting.push(params.id);
        await dial;
        return readPiece(path.join(notebook, params.id), params.offset);
      },
    },
  });
  const repo = new DevicesRepo(f.db);
  repo.upsert(record('dev_self', { self: true }));
  repo.upsert(record('dev_notebook', { joinedAs: 'ceo', status: 'offline' }));
  shots.forEach((bytes, index) => addFile(f.db, sha(bytes), `shot${index + 1}.png`, 'image/png'));
  const chat = f.chats.create({ agentIds: [f.vid.id], createdBy: 'human' });
  f.chats.send({
    conversationId: chat.id, body: 'Three from the notebook', authorId: 'human',
    attachments: shots.map((bytes, index) => ({ fileId: sha(bytes), name: `shot${index + 1}.png`, mime: 'image/png', size: bytes.length })),
  });

  const prepared = f.context.prepare({ agentId: f.vid.id, conversationId: chat.id, sinceSeq: 0 });
  for (let i = 0; i < 200 && waiting.length < 3; i++) await new Promise((resolve) => setTimeout(resolve, 10)); // the pulls' own file checks run first
  assert.deepEqual(waiting.sort(), shots.map(sha).sort(), 'all three pulls wait on the same dial, none after another');
  dialed();
  await prepared;
  assert.ok(shots.every((bytes) => existsSync(at(sha(bytes)))), 'all three are here now');
  assert.equal(f.context.delta({ agent: f.vid, conversationId: chat.id, sinceSeq: 0 }).images.length, 3);
});
