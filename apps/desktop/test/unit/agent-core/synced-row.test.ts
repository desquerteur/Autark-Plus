// B-087 (review 10.11.2026): a linked PC's agents row lands before its SYSTEM.md (rows go every 300 ms, files a
// second later). While SYSTEM.md is still the app's own last write, it is no change: the row stands, a turn's prompt
// uses it, a reconcile in that gap never sets it back, and a save writes over the file. The linked PC's file then
// lands and is the app's own from then on; a real edit outside the app is still taken over, and a save over one is
// still a conflict. Which file is the app's own survives a restart; a save back to what the app's own stale file says
// writes it again (a new version for the file sync); files written from the cache into a folder that had none are
// dated before the agent existed, so a linked PC's real ones win.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WorkforceError } from '../../../src/shared/errors.ts';
import { coreFixture, fakeWatch } from './fixture.ts';

const read = (file: string) => readFileSync(file, 'utf8');

function setup() {
  const fake = fakeWatch();
  const f = coreFixture({ watch: fake.watch });
  const writer = f.org.create({ name: 'Writer', instructions: 'A.', createdBy: 'human' });
  f.org.setCoreFiles(f.core);
  f.core.start();
  /** The row as devices/sync/tables.ts writes it: straight into the table, then announced. */
  const syncedRow = (instructions: string) => {
    f.db.run('UPDATE agents SET instructions = ? WHERE id = ?', [instructions, writer.id]);
    f.events.bus.emit('agent.upserted', f.org.get(writer.id)!);
  };
  /** The file as devices/sync/files.ts puts it in place: a temp file renamed over it, then the watcher's event. */
  const syncedFile = (text: string) => {
    const temp = `${f.file(writer.id)}.pull.tmp`;
    writeFileSync(temp, text);
    renameSync(temp, f.file(writer.id));
    fake.fire(`agents/${writer.id}/SYSTEM.md`);
    f.core.flush();
  };
  return { f, fake, writer, syncedRow, syncedFile };
}

test('a linked PC\'s row ahead of the app\'s own SYSTEM.md stands until that PC\'s file lands', () => {
  const { f, fake, writer, syncedRow, syncedFile } = setup();
  try {
    assert.equal(read(f.file(writer.id)), 'A.\n');
    syncedRow('B.');
    assert.equal(f.core.instructions(f.org.get(writer.id)!), 'B.', 'a turn in the gap uses the row');
    assert.equal(f.core.reconcile(writer.id), 'same');
    f.runDeferred();
    fake.fire(`agents/${writer.id}/SYSTEM.md`);
    f.core.flush();
    assert.equal(f.org.get(writer.id)!.instructions, 'B.', 'never set back to the old file');
    assert.equal(read(f.file(writer.id)), 'A.\n', 'the file waits for the linked PC\'s');

    syncedFile('B.\n');
    assert.equal(f.org.get(writer.id)!.instructions, 'B.');
    syncedRow('C.'); // the next edit there: the file that landed is the app's own now
    assert.equal(f.core.reconcile(writer.id), 'same');
    assert.equal(f.org.get(writer.id)!.instructions, 'C.');

    writeFileSync(f.file(writer.id), 'D from my editor.'); // a real edit outside the app
    fake.fire(`agents/${writer.id}/SYSTEM.md`);
    f.core.flush();
    assert.equal(f.org.get(writer.id)!.instructions, 'D from my editor.', 'still taken over');
  } finally { f.cleanup(); }
});

test('a save over the app\'s own stale SYSTEM.md is no conflict; over an edit outside the app it still is', () => {
  const { f, writer, syncedRow } = setup();
  try {
    syncedRow('B.');
    f.org.update(writer.id, { instructions: 'C.' });
    assert.equal(read(f.file(writer.id)), 'C.\n');
    assert.equal(f.org.get(writer.id)!.instructions, 'C.');

    writeFileSync(f.file(writer.id), 'D from my editor.');
    assert.throws(() => f.org.update(writer.id, { instructions: 'E.' }), (error: unknown) => error instanceof WorkforceError && error.code === 'conflict');
    assert.equal(read(f.file(writer.id)), 'D from my editor.', 'never overwritten unseen');
  } finally { f.cleanup(); }
});

test('which SYSTEM.md is the app\'s own survives a restart; an edit while the app was closed is still taken over', () => {
  const { f, writer, syncedRow } = setup();
  try {
    syncedRow('B.');
    f.core.stop();
    const again = f.restart();
    again.start();
    assert.equal(f.org.get(writer.id)!.instructions, 'B.', 'the start-up reconcile keeps the row');
    assert.equal(again.instructions(f.org.get(writer.id)!), 'B.');
    again.stop();

    writeFileSync(f.file(writer.id), 'C while the app was closed.');
    const third = f.restart();
    third.start();
    assert.equal(f.org.get(writer.id)!.instructions, 'C while the app was closed.');
    third.stop();
  } finally { f.cleanup(); }
});

test('a save back to what the app\'s own stale SYSTEM.md says writes it again', () => {
  const { f, writer, syncedRow } = setup();
  try {
    const old = new Date(2026, 0, 1);
    utimesSync(f.file(writer.id), old, old);
    f.core.reconcile(writer.id); // the dated file is the app's own again
    syncedRow('B.');
    f.org.update(writer.id, { instructions: 'A.' });
    assert.equal(read(f.file(writer.id)), 'A.\n');
    assert.ok(statSync(f.file(writer.id)).mtimeMs > old.getTime(), 'a fresh write: the file sync sees a new version');
    assert.equal(f.org.get(writer.id)!.instructions, 'A.');
  } finally { f.cleanup(); }
});

test('files written from the cache into a folder that had none are dated before the agent existed', () => {
  const { f, writer } = setup();
  try {
    const folder = path.dirname(f.file(writer.id));
    rmSync(folder, { recursive: true, force: true });
    assert.equal(f.core.reconcile(writer.id), 'created');
    const created = f.org.get(writer.id)!.createdAt;
    for (const name of ['SYSTEM.md', 'agent.json']) assert.ok(statSync(path.join(folder, name)).mtimeMs < created, `${name} is older than the agent`);
    assert.equal(read(f.file(writer.id)), 'A.\n');
    assert.equal(f.core.reconcile(writer.id), 'same', 'and the app\'s own');
  } finally { f.cleanup(); }
});

test('a pulled SYSTEM.md older than the row here is the app\'s own, the row stands; one the row did not pass is taken over', () => {
  const { f, writer, syncedRow } = setup();
  const pulled = (text: string) => { const temp = `${f.file(writer.id)}.pull.tmp`; writeFileSync(temp, text); renameSync(temp, f.file(writer.id)); };
  try {
    syncedRow('V22.'); // the row came first and passed the app's own file ('A.')
    const ahead = f.core.rowAhead(writer.id);
    assert.equal(ahead, true);
    pulled('V1.\n'); // an older file from a third PC (lengths differ: two writes in one clock tick with one size read as one file)
    f.core.arrived(writer.id, ahead);
    assert.equal(f.org.get(writer.id)!.instructions, 'V22.', 'the row stands');
    assert.equal(f.core.reconcile(writer.id), 'same');

    syncedRow('V22.');
    assert.equal(f.core.rowAhead(writer.id), true, 'the pulled file is the app\'s own and behind the row');
    pulled('V22.\n');
    f.core.arrived(writer.id, false);
    assert.equal(f.core.rowAhead(writer.id), false);
    pulled('V333.\n'); // the next edit there, its file first
    f.core.arrived(writer.id, f.core.rowAhead(writer.id));
    assert.equal(f.org.get(writer.id)!.instructions, 'V333.', 'taken over');
  } finally { f.cleanup(); }
});

test('agent.json written again from the cache leaves an edit of SYSTEM.md outside the app to be taken over', () => {
  const { f, writer } = setup();
  try {
    rmSync(path.join(path.dirname(f.file(writer.id)), 'agent.json'), { force: true });
    writeFileSync(f.file(writer.id), 'B from my editor.');
    const again = f.restart(); // agent.json unknown in this run
    assert.equal(again.reconcile(writer.id), 'updated');
    assert.equal(f.org.get(writer.id)!.instructions, 'B from my editor.');
  } finally { f.cleanup(); }
});
