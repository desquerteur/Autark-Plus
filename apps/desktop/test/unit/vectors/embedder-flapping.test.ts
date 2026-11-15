// When the embedding model changes: only a choice in settings re-embeds the existing files, once, also across a restart; a model
// that changes without a choice re-embeds nothing; files embedded with another model on purpose are found, with a note. (Auto
// mode's stand-in for a failed local model ended with the word index, lane find 14.11.2026: "auto" embeds with nothing.)
// Owns: these assertions only. Never: real models or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../../../src/runtime/db/database.ts';
import { migrate } from '../../../src/runtime/db/migrate.ts';
import { unit, type Embedder } from '../../../src/runtime/vectors/embedders.ts';
import { VectorSystem } from '../../../src/runtime/vectors/service.ts';

class Fake implements Embedder {
  batch = 4;
  documents: string[] = [];
  queries: string[] = [];
  readonly id: string;
  readonly remote: boolean;
  constructor(id: string, remote: boolean) { this.id = id; this.remote = remote; }
  async embed(texts: string[], purpose: 'query' | 'document'): Promise<Float32Array[]> {
    (purpose === 'query' ? this.queries : this.documents).push(...texts);
    return texts.map((text) => unit([text.includes('Angebot') ? 1 : 0, text.includes('Firma') ? 1 : 0, 0.01]));
  }
}

const settled = async (system: VectorSystem) => { await new Promise((resolve) => setTimeout(resolve, 5)); await system.settled(); };

function world(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wf-vector-flap-'));
  const db = new Db(path.join(dir, 'test.db'));
  migrate(db);
  const memoryRoot = path.join(dir, 'memory');
  mkdirSync(path.join(memoryRoot, 'company'), { recursive: true });
  const local = new Fake('local:mini', false);
  const paid = new Fake('openai:small', true);
  const state = { choice: 'local', current: local as Embedder | undefined };
  const systems: VectorSystem[] = [];
  /** A start of the app: everything in memory is new (the local model's failures too). */
  const start = () => {
    systems.at(-1)?.stop();
    const system = new VectorSystem({ db, memoryRoot, embedder: () => state.current, choice: () => state.choice, changeDelayMs: 0 });
    systems.push(system);
    system.start();
    return system;
  };
  t.after(() => { systems.at(-1)?.stop(); db.raw.close(); rmSync(dir, { recursive: true, force: true }); });
  const write = (name: string, body: string) => {
    const file = path.join(memoryRoot, 'company', name);
    writeFileSync(file, body);
    return file;
  };
  return { db, memoryRoot, local, paid, state, start, write };
}

test('files embedded on purpose with another model are found, with a note', async (t) => {
  const w = world(t);
  const system = w.start();
  w.write('firma.md', 'Die Firma heißt Teydra Lab.');
  await system.embed(['memory']);
  const offer = w.write('angebot.md', 'Das Angebot ging raus.');
  w.state.current = w.paid;
  await system.embed([offer]); // somebody asked for it: that is no background work
  assert.equal(w.paid.documents.length, 1);
  const found = await system.search({ query: 'Angebot', in: ['memory'] });
  assert.equal(found.hits[0]?.path, 'memory/company/angebot.md');
  assert.match(found.note ?? '', /^Files here were embedded with another embedding model/, 'rule (a): no count');
  assert.equal(w.paid.documents.length, 1);
  assert.deepEqual(w.paid.queries, ['Angebot']);
});

test('the model changing without a choice in settings (a server connected, a key removed) re-embeds nothing', async (t) => {
  const w = world(t);
  w.write('firma.md', 'Die Firma heißt Teydra Lab.');
  const system = w.start();
  await system.embed(['memory']);
  w.state.current = w.paid; // nobody chose anything
  w.local.documents.length = 0;
  system.settingsChanged();
  await settled(system);
  assert.deepEqual(w.paid.documents, []);
  assert.equal((await system.embed(['memory'], { notYet: true })).unchanged, 1);
  assert.deepEqual(w.paid.documents, []);
});

test('a model chosen in settings re-embeds the existing files once; the work survives a restart and ends', async (t) => {
  const w = world(t);
  w.write('firma.md', 'Die Firma heißt Teydra Lab.');
  w.write('angebot.md', 'Das Angebot ging raus.');
  let system = w.start();
  await system.embed(['memory']);

  // The app stops right after the choice, before any work.
  w.state.choice = 'openai:small';
  w.state.current = w.paid;
  system.settingsChanged();
  system.stop();
  w.paid.documents.length = 0;
  system = w.start();
  const during = await system.search({ query: 'Firma', in: ['memory'] });
  assert.match(during.note ?? '', /being re-embedded/);
  await settled(system);
  assert.equal(w.paid.documents.length, 2, 'both files, once');
  assert.equal((await system.search({ query: 'Angebot', in: ['memory'], k: 1 })).hits[0]?.path, 'memory/company/angebot.md');

  w.paid.documents.length = 0;
  system = w.start();
  await settled(system);
  assert.deepEqual(w.paid.documents, [], 'finished: a later start redoes nothing');

  // Back to this PC's model: another choice.
  w.state.choice = 'local';
  w.state.current = w.local;
  w.local.documents.length = 0;
  system.settingsChanged();
  await settled(system);
  assert.equal(w.local.documents.length, 2);
});
