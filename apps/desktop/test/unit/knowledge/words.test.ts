// The word index (knowledge/words.ts): bm25 over folded title, description and text with the title weighing most, scores relative
// to the best kept hit, `keep` picks the hits, sync reads only a new or changed text and drops what is gone; German folding,
// light stems, compounds by their parts and the small DE/EN vocabulary.
// Owns: these assertions only. Never: files, models or the runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WordIndex, wordQuery, type WordDoc } from '../../../src/runtime/knowledge/words.ts';

const reads: string[] = [];
const doc = (id: string, title: string, body: string, version = '1', description = ''): WordDoc => ({
  id, version, text: () => { reads.push(id); return { title, description, body }; },
});

test('the word index: the title weighs most, scores are relative to the best kept hit, keep picks, only changed texts are read', () => {
  const index = new WordIndex();
  reads.length = 0;
  const others = [doc('d', 'Oma Hilde', 'Schalentierallergie.'), doc('e', 'Dr. Amrein', 'Documents only through the client portal.'), doc('f', 'Baustelle Hafenkante', 'Material nimmt nur Frau Okonkwo an.')];
  index.sync([doc('a', 'Larsen Marine AS', 'Preise und Rechnungen nur in NOK.'), doc('b', 'Studio Bellavista', 'No calls before 10:00, video preferred.'), doc('c', 'Wochenplan', 'Larsen kommt am Montag vorbei.'), ...others]);
  assert.deepEqual(reads, ['a', 'b', 'c', 'd', 'e', 'f']);
  const hits = index.search('Mach mir eine Preisübersicht für Larsen Marine', 5);
  assert.deepEqual(hits.map((hit) => hit.id), ['a', 'c'], 'the title match first, the text match after');
  assert.equal(hits[0].score, 1);
  assert.ok(hits[1].score > 0 && hits[1].score < 1, String(hits[1].score));
  assert.deepEqual(index.search('Larsen', 5, (id) => id === 'c').map((hit) => [hit.id, hit.score]), [['c', 1]], 'relative to the best kept hit');
  reads.length = 0;
  index.sync([doc('a', 'Larsen Marine AS', 'Preise nur in NOK.', '2'), doc('b', 'Studio Bellavista', 'No calls before 10:00, video preferred.'), ...others]);
  assert.deepEqual(reads, ['a'], 'the others unchanged: not read again');
  assert.equal(index.size, 5, 'c is gone');
  assert.deepEqual(index.search('Wochenplan Montag', 5), []);
  assert.deepEqual(index.search('und der die', 5), [], 'stopwords only: nothing to search');
});

test('German folding, light stems, a compound by its parts and the DE/EN vocabulary', () => {
  const index = new WordIndex();
  index.sync([
    doc('foundry', 'Zahlungsregel Hartwig Gießerei', 'Die Hartwig Gießerei bekommt Angebote nur gegen Vorkasse.'),
    doc('video', 'captions', 'Burn captions into a video export.'),
    doc('invoice', 'invoice-check', 'Check every invoice before it goes out.'),
  ]);
  assert.deepEqual(index.search('Giessereien von Hartwig', 5).map((hit) => hit.id), ['foundry'], 'ß folded, the plural stemmed');
  assert.deepEqual(index.search('der Videoexport', 5).map((hit) => hit.id), ['video'], 'a compound found by its two parts');
  assert.deepEqual(index.search('offene Rechnungen', 5).map((hit) => hit.id), ['invoice'], 'Rechnung ↔ invoice');
  assert.equal(wordQuery('Videoexport', new Set(['video', 'export'])), '"videoexport"* OR "video"* OR "export"*');
  assert.equal(wordQuery('?!', new Set()), undefined);
});
