// 17.11.2026 (Konrad task_d4pdwppg): a video's light preview copy (media.preview_file_id, a blob with no message of its own) may be fetched by whoever may fetch
// the video: a person who may read a message that attaches the video (people/access.ts mayReadFile), no one else – the copy opens nothing the video did not.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Attachment } from '../../../src/shared/model/chat.ts';
import { mayReadFile } from '../../../src/runtime/people/access.ts';
import { peopleRig } from './rig.ts';

const ORIGINAL = 'd'.repeat(64);
const COPY = 'e'.repeat(64);
const OTHER_COPY = 'f'.repeat(64);

test('a person fetches the preview copy of a video they may read, and no other video\'s', async (t) => {
  const r = peopleRig();
  t.after(() => r.cleanup());
  const cara = await r.join('Cara');
  const chat = r.chats.create({ title: 'Work', agentIds: [], createdBy: 'human' });
  r.chats.setMembers(chat.id, { add: [cara.person.id] }, 'human');
  const stored = (id: string, name: string) => r.db.run('INSERT INTO files (id, name, mime, size, created_at) VALUES (?, ?, ?, ?, 1)', [id, name, 'video/mp4', 10]);
  for (const [id, name] of [[ORIGINAL, 'export.mp4'], [COPY, 'export-preview.mp4'], [OTHER_COPY, 'other-preview.mp4'], ['9'.repeat(64), 'other.mp4']] as const) stored(id, name);
  r.db.run(`INSERT INTO media (file_id, conversation_id, kind, mime, name, created_at, updated_at, preview_file_id) VALUES (?, ?, 'video', 'video/mp4', 'export.mp4', 1, 1, ?)`, [ORIGINAL, chat.id, COPY]);
  r.db.run(`INSERT INTO media (file_id, conversation_id, kind, mime, name, created_at, updated_at, preview_file_id) VALUES (?, NULL, 'video', 'video/mp4', 'other.mp4', 1, 1, ?)`, ['9'.repeat(64), OTHER_COPY]);
  r.clock.advance(1000);
  const attachment: Attachment = { fileId: ORIGINAL, name: 'export.mp4', mime: 'video/mp4', size: 10 };
  assert.equal(mayReadFile(r.db, cara.person.id, ORIGINAL), false, 'not attached yet');
  assert.equal(mayReadFile(r.db, cara.person.id, COPY), false, 'so the copy is closed too');
  r.chats.send({ conversationId: chat.id, body: 'the cut', authorId: 'human', attachments: [attachment] });
  assert.equal(mayReadFile(r.db, cara.person.id, ORIGINAL), true);
  assert.equal(mayReadFile(r.db, cara.person.id, COPY), true, 'the copy follows its video');
  assert.equal(mayReadFile(r.db, cara.person.id, OTHER_COPY), false, 'another video\'s copy stays closed');
  assert.equal(mayReadFile(r.db, cara.person.id, 'c'.repeat(64)), false);
});

test('rows that name each other as copies (a fault or a hash collision) end the check: one step from a copy to its video, never a loop', async (t) => {
  const r = peopleRig();
  t.after(() => r.cleanup());
  const cara = await r.join('Cara');
  const stored = (id: string) => r.db.run('INSERT INTO files (id, name, mime, size, created_at) VALUES (?, ?, ?, ?, 1)', [id, 'x.mp4', 'video/mp4', 10]);
  stored(ORIGINAL);
  stored(COPY);
  r.db.run(`INSERT INTO media (file_id, conversation_id, kind, mime, name, created_at, updated_at, preview_file_id) VALUES (?, NULL, 'video', 'video/mp4', 'a.mp4', 1, 1, ?)`, [ORIGINAL, COPY]);
  r.db.run(`INSERT INTO media (file_id, conversation_id, kind, mime, name, created_at, updated_at, preview_file_id) VALUES (?, NULL, 'video', 'video/mp4', 'b.mp4', 1, 1, ?)`, [COPY, ORIGINAL]);
  assert.equal(mayReadFile(r.db, cara.person.id, ORIGINAL), false);
  assert.equal(mayReadFile(r.db, cara.person.id, COPY), false);
  r.db.run(`UPDATE media SET preview_file_id = ? WHERE file_id = ?`, [ORIGINAL, ORIGINAL]); // a row naming itself
  assert.equal(mayReadFile(r.db, cara.person.id, ORIGINAL), false);
});
