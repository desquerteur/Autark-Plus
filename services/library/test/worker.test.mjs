// The library worker against a real SQLite (node:sqlite behind the few D1 calls the worker uses): share, find by words,
// open, rate, the owner rule, refusals, the hourly limits, one rating per place and the OpenAutark key (17.11.2026: also
// the review's two findings – nobody overwrites another's entry, no pumping or burying by one address).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    first: async () => db.prepare(sql).get(...values) ?? null,
    run: async () => { db.prepare(sql).run(...values); return {}; },
  });
  return { prepare: (sql) => statement(sql), batch: async (list) => { for (const item of list) await item.run(); return []; } };
}

const KEY = 'k'.repeat(40);
function rig(extraEnv = {}) {
  const env = { DB: d1(), ADMIN_KEY: KEY, ...extraEnv };
  const call = async (method, path, payload, headers = {}) => {
    const response = await worker.fetch(new Request(`https://library.test${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, ...(payload ? { body: JSON.stringify(payload) } : {}) }), env);
    return { status: response.status, body: await response.json() };
  };
  return { call, env };
}

const ME = 'install-aaaaaaaaaaaaaaaa';
const YOU = 'install-bbbbbbbbbbbbbbbb';
const SKILL = { kind: 'skill', name: 'PDF tables', description: 'Pull tables out of PDF files into CSV.', body: '# PDF tables\nI read each page with pdfplumber and write one CSV per table.', files: { 'scripts/extract.py': 'print(1)' } };

test('share, find by words, open with files, rate', async () => {
  const { call } = rig();
  const shared = await call('POST', '/share', { ...SKILL, voter: ME });
  assert.equal(shared.status, 200);
  assert.deepEqual([shared.body.id, shared.body.license], ['pdf-tables', 'CC0-1.0']);
  await call('POST', '/share', { kind: 'note', name: 'invoice dates', description: 'Invoices in Austria need the delivery date.', body: 'An Austrian invoice names the delivery date; without it the tax office refuses the deduction.', voter: ME });
  const found = await call('GET', '/find?q=extract%20pdf%20tabelle');
  assert.deepEqual(found.body.entries.map((entry) => entry.id), ['pdf-tables']);
  assert.equal((await call('GET', '/find?q=invoice&kind=skill')).body.entries.length, 0);
  assert.equal((await call('GET', '/find')).body.entries.length, 2, 'no words: the best rated and most used');
  const opened = await call('GET', '/get/pdf-tables');
  assert.equal(opened.body.body, SKILL.body);
  assert.deepEqual(opened.body.files, SKILL.files);
  assert.equal(opened.body.uses, 0, 'the count shown is before this open');
  const rated = await call('POST', '/rate', { id: 'pdf-tables', stars: 5, note: 'Worked on 40 bank statements.', voter: YOU });
  assert.deepEqual(rated.body, { id: 'pdf-tables', rating: 5, votes: 1 });
  await call('POST', '/rate', { id: 'pdf-tables', stars: 3, voter: YOU });
  assert.deepEqual((await call('GET', '/get/pdf-tables')).body.notes, [], 'one rating per installation: the second replaces the first');
});

test('the same owner updates its entry; another owner gets its own id', async () => {
  const { call } = rig();
  await call('POST', '/share', { ...SKILL, voter: ME });
  const again = await call('POST', '/share', { ...SKILL, body: `${SKILL.body}\nNow with merged cells.`, voter: ME });
  assert.equal(again.body.id, 'pdf-tables');
  const other = await call('POST', '/share', { ...SKILL, voter: YOU });
  assert.match(other.body.id, /^pdf-tables-[0-9a-f]{16}$/);
  assert.equal((await call('POST', '/share', { ...SKILL, voter: YOU })).body.id, other.body.id, 'and keeps it');
});

test('refusals: a key in the text, bad paths, no voter, the hourly limit; low ratings hide an entry', async () => {
  const { call } = rig();
  assert.equal((await call('POST', '/share', { ...SKILL, body: `${SKILL.body}\nkey sk-ant-api03-abcdefghijklmnopqrstuvwxyz`, voter: ME })).status, 422);
  assert.equal((await call('POST', '/share', { ...SKILL, files: { '../x.sh': 'rm' }, voter: ME })).status, 400);
  assert.equal((await call('POST', '/share', { ...SKILL })).status, 400);
  for (let i = 0; i < 20; i++) assert.equal((await call('POST', '/share', { ...SKILL, name: `n${i}`, voter: ME })).status, 200);
  assert.equal((await call('POST', '/share', { ...SKILL, name: 'one-more', voter: ME })).status, 429);
  const from = (n) => ({ 'cf-connecting-ip': `198.51.100.${n}` });
  for (const [n, voter] of [[1, 'v-111111111111111111'], [2, 'v-222222222222222222'], [3, 'v-333333333333333333']]) await call('POST', '/rate', { id: 'n1', stars: 1, voter }, from(n));
  assert.equal((await call('GET', '/get/n1')).status, 404, 'three places rating 1 star hide an entry');
});

test('the OpenAutark key seeds with license, source and author and removes', async () => {
  const { call } = rig();
  const auth = { authorization: `Bearer ${KEY}` };
  const seeded = await call('POST', '/share', { ...SKILL, license: 'MIT', source: 'https://github.com/obra/superpowers', author: 'Jesse Vincent' }, auth);
  assert.deepEqual([seeded.status, seeded.body.license], [200, 'MIT']);
  const opened = (await call('GET', '/get/pdf-tables')).body;
  assert.deepEqual([opened.license, opened.source, opened.author], ['MIT', 'https://github.com/obra/superpowers', 'Jesse Vincent']);
  assert.equal((await call('DELETE', '/get/pdf-tables')).status, 403);
  assert.equal((await call('DELETE', '/get/pdf-tables', undefined, auth)).status, 200);
  assert.equal((await call('GET', '/get/pdf-tables')).status, 404);
});

test('B1: nobody writes over another owner\'s entry – a clashing id is refused, the suffix is 64 bits', async () => {
  const { call, env } = rig();
  await call('POST', '/share', { ...SKILL, body: `${SKILL.body}\nThe first.`, voter: ME });
  const victim = (await call('POST', '/share', { ...SKILL, body: `${SKILL.body}\nThe victim's own.`, voter: YOU })).body.id;
  assert.match(victim, /^pdf-tables-[0-9a-f]{16}$/);
  // an attacker who reaches the victim's id through the same owner hash is no other owner: the guard is the owner check itself
  env.DB.prepare('UPDATE entries SET owner = ? WHERE id = ?').bind('not-the-victim', victim).run();
  const hit = await call('POST', '/share', { ...SKILL, body: `${SKILL.body}\nEVIL`, voter: YOU });
  assert.equal(hit.status, 409, 'an id held by another owner is refused');
  const now = (await call('GET', `/get/${victim}`)).body;
  assert.doesNotMatch(now.body, /EVIL/, 'the entry kept its text');
});

test('B2: ratings are limited per place, one rating per place counts, OpenAutark entries are never hidden', async () => {
  const { call } = rig();
  const auth = { authorization: `Bearer ${KEY}` };
  const seeded = (await call('POST', '/share', { ...SKILL, license: 'MIT', source: 'x', author: 'y' }, auth)).body.id;
  const mine = (await call('POST', '/share', { ...SKILL, name: 'my skill', body: `${SKILL.body}\nMine.`, voter: ME })).body.id;
  const place = (n) => ({ 'cf-connecting-ip': `203.0.113.${n}` });
  // many made-up voters from one place count once: they neither bury nor pump
  for (let i = 0; i < 6; i++) await call('POST', '/rate', { id: mine, stars: 1, voter: `made-up-voter-${i}-xxxxxxxx` }, place(7));
  const one = await call('GET', `/get/${mine}`);
  assert.equal(one.status, 200, 'not hidden by one place');
  assert.equal(one.body.votes, 1, 'six voters at one address are one place');
  // three different places do hide an entry that is not OpenAutark's ...
  for (const n of [11, 12, 13]) await call('POST', '/rate', { id: mine, stars: 1, voter: `other-voter-${n}-xxxxxxxx` }, place(n));
  assert.equal((await call('GET', `/get/${mine}`)).status, 404);
  // ... but never one of OpenAutark's
  for (const n of [21, 22, 23, 24]) await call('POST', '/rate', { id: seeded, stars: 1, voter: `seeded-voter-${n}-xxxxxxxx` }, place(n));
  assert.equal((await call('GET', `/get/${seeded}`)).status, 200, 'an OpenAutark entry stays');
  // the hourly limit: 30 ratings from one address, then 429
  let refused = 0;
  for (let i = 0; i < 40; i++) if ((await call('POST', '/rate', { id: seeded, stars: 5, voter: `pump-voter-${i}-xxxxxxxxxx` }, place(99))).status === 429) refused += 1;
  assert.equal(refused, 10, '30 pass, the rest is refused');
});

test('addresses are hashed with the worker secret when there is one, and never stored as they are', async () => {
  const { call, env } = rig({ IP_SALT: 's'.repeat(32) });
  await call('POST', '/share', { ...SKILL, voter: ME }, { 'cf-connecting-ip': '203.0.113.5' });
  await call('POST', '/rate', { id: 'pdf-tables', stars: 4, voter: YOU }, { 'cf-connecting-ip': '203.0.113.5' });
  const stored = [env.DB.prepare('SELECT key FROM recent').all(), env.DB.prepare('SELECT place FROM ratings').all()];
  const flat = JSON.stringify(await Promise.all(stored));
  assert.doesNotMatch(flat, /203\.0\.113\.5/, 'no address in the tables');
  const { createHash } = await import('node:crypto');
  const plain = createHash('sha256').update(`203.0.113.5|${new Date().toISOString().slice(0, 7)}`).digest('hex');
  assert.ok(!flat.includes(plain), 'not the plain sha256 an attacker could reverse over all IPv4 addresses');
});

test('hardening: a bad address is 400 not 500, a huge body is 413, more key shapes are refused', async () => {
  const { call } = rig();
  assert.equal((await call('GET', '/get/%E0')).status, 400);
  const huge = await call('POST', '/share', { ...SKILL, body: 'x'.repeat(400_000), voter: ME });
  assert.equal(huge.status, 413);
  for (const key of ['sk_live_' + 'a'.repeat(24), 'rk_live_' + 'b'.repeat(24), 'ya29.' + 'c'.repeat(30), 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop']) {
    assert.equal((await call('POST', '/share', { ...SKILL, name: 'key test', body: `${SKILL.body}\n${key}`, voter: ME })).status, 422, key.slice(0, 8));
  }
});

test('an IPv6 connection is one place: its /64 counts, however many addresses it has', async () => {
  const { call } = rig();
  const mine = (await call('POST', '/share', { ...SKILL, voter: ME })).body.id;
  let refused = 0;
  for (let i = 0; i < 40; i++) {
    const ip = `2001:db8:77:5:${(i + 1).toString(16)}:1:2:3`; // 40 addresses of one /64
    if ((await call('POST', '/rate', { id: mine, stars: 1, voter: `v6-voter-${i}-xxxxxxxxxxxx` }, { 'cf-connecting-ip': ip })).status === 429) refused += 1;
  }
  assert.equal(refused, 10, '30 pass from one /64, the rest is refused');
  const entry = await call('GET', `/get/${mine}`);
  assert.equal(entry.status, 200, 'one /64 does not hide an entry');
  assert.equal(entry.body.votes, 1, 'and counts once');
});

test('ranking: one rating does not lift an entry; from three places it counts, damped', async () => {
  const { call } = rig();
  const auth = { authorization: `Bearer ${KEY}` };
  const mine = (await call('POST', '/share', { ...SKILL, name: 'fresh skill', body: `${SKILL.body}
Fresh.`, voter: ME })).body.id;
  await new Promise((resolve) => setTimeout(resolve, 5)); // the curated entry is the newer one: in a tie it comes first
  const curated = (await call('POST', '/share', { ...SKILL, name: 'curated one', body: `${SKILL.body}
Curated.`, license: 'MIT', source: 'x', author: 'y' }, auth)).body.id;
  const order = async () => (await call('GET', '/find')).body.entries.map((entry) => entry.id);
  assert.deepEqual(await order(), [curated, mine]);
  await call('POST', '/rate', { id: mine, stars: 5, voter: 'self-rating-voter-aaaa' }, { 'cf-connecting-ip': '203.0.113.1' });
  assert.deepEqual(await order(), [curated, mine], 'one 5-star rating does not lift the new entry above the unrated curated one');
  for (const n of [2, 3]) await call('POST', '/rate', { id: mine, stars: 5, voter: `other-rating-voter-${n}-aaaa` }, { 'cf-connecting-ip': `203.0.113.${n}` });
  assert.deepEqual(await order(), [mine, curated], 'three places rating 5 stars do lift it');
});

test('a fresh unrated entry stays below the curated ones in the list without words, and opening entries does not rank them', async () => {
  const { call } = rig();
  const auth = { authorization: `Bearer ${KEY}` };
  for (let i = 0; i < 3; i++) await call('POST', '/share', { ...SKILL, name: `curated ${i}`, body: `${SKILL.body}
Curated ${i}.`, license: 'MIT', source: 'x', author: 'y' }, auth);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const fresh = (await call('POST', '/share', { ...SKILL, name: 'deploy helper', body: `${SKILL.body}
Fresh.`, voter: ME })).body.id;
  for (let i = 0; i < 20; i++) await call('GET', `/get/${fresh}`); // opening it many times does not move it
  const ids = (await call('GET', '/find')).body.entries.map((entry) => entry.id);
  assert.equal(ids[ids.length - 1], fresh, 'the unrated shared entry is last, below every curated one');
});
