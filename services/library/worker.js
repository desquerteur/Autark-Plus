// The public library of Autark (owner 14.11.2026: "öffentliche Skills … die praktisch jeder reinschicken kann …
// bewerten … Wortsuche … ein einfaches System"): skills and notes anyone shares, found by their words, rated by those
// who used them. No accounts: each Autark sends a random installation id (only its sha256 is kept) that owns what it
// shared and counts one rating per entry. What people share is CC0 (free for everyone, no conditions); seeded entries
// keep their own open license and source. A shared text holding something like a key is refused; an entry with at
// least three ratings averaging below 2 is hidden; the OpenAutark key (env ADMIN_KEY) seeds and removes entries.
// No IP address is stored. The hourly limits (shares and ratings) count a keyed hash of the address and the day, kept one
// day. A rating keeps a keyed hash of the address and the month: only ratings from different places count towards an
// entry's rating, its ranking and hiding, so one place cannot pump or bury an entry; OpenAutark's own entries are never
// hidden by ratings. (IP_SALT, a worker secret, keys the hashes; without it they are plain sha256 and can be reversed.)
// GET /find?q=&kind=&limit= · GET /get/<id> · POST /share · POST /rate · DELETE /get/<id> (admin)

const MAX_BODY = 60_000;
const MAX_FILES = 30;
const MAX_FILES_CHARS = 200_000;
const SHARES_PER_HOUR = 20;
const RATES_PER_HOUR = 30;
const MAX_REQUEST_BYTES = 300_000;
const SUFFIX = 16; // hex characters of the owner hash in a second sharer's id (64 bits)
const HOUR = 3_600_000;
const SECRET = /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|\b[sr]k_live_[0-9A-Za-z]{16,}|\bya29\.[0-9A-Za-z_-]{20,}|\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type, authorization' };
const COLUMNS = 'e.id, e.kind, e.name, e.description, e.license, e.source, e.author, e.rev, e.stars, e.votes, e.uses, e.updated';
// The ranking's average: 3 until three places rated, then damped towards 3 (as if five more 3-star votes), so a single
// rating cannot lift an entry above the unrated ones.
const AVERAGE = '(CASE WHEN e.votes >= 3 THEN (e.stars + 15.0) / (e.votes + 5) ELSE 3 END)';

class Refused extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });

async function sha256(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function text(value, min, max, field) {
  const out = typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
  if (out.length < min || out.length > max) throw new Refused(`${field}: between ${min} and ${max} characters.`);
  return out;
}

const slug = (value) => (typeof value === 'string' ? value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) : '');

/** {relative path: text} beside SKILL.md: plain relative paths, no "..", within the limits. */
function filesOf(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Refused('files: an object of path → text.');
  const entries = Object.entries(value);
  if (entries.length > MAX_FILES) throw new Refused(`files: at most ${MAX_FILES}.`);
  let size = 0;
  const out = {};
  for (const [file, content] of entries) {
    const clean = file.replace(/\\/g, '/');
    if (!/^[\w.-]+(\/[\w.-]+)*$/.test(clean) || clean.split('/').some((part) => part === '..' || part === '.') || /^skill\.md$/i.test(clean)) throw new Refused(`files: "${file.slice(0, 80)}" is no plain relative path.`);
    if (typeof content !== 'string') throw new Refused(`files: "${clean}" is no text.`);
    size += content.length;
    out[clean] = content.replace(/\r\n?/g, '\n');
  }
  if (size > MAX_FILES_CHARS) throw new Refused(`files: at most ${MAX_FILES_CHARS} characters in all.`);
  return out;
}

function admin(env, request) {
  const given = request.headers.get('authorization') ?? '';
  return typeof env.ADMIN_KEY === 'string' && env.ADMIN_KEY.length >= 32 && given === `Bearer ${env.ADMIN_KEY}`;
}

async function body(request) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_REQUEST_BYTES) throw new Refused('The body is too large.', 413);
  let raw;
  try { raw = await request.text(); } catch { throw new Refused('The body is no JSON.'); }
  if (raw.length > MAX_REQUEST_BYTES) throw new Refused('The body is too large.', 413);
  try { return JSON.parse(raw); } catch { throw new Refused('The body is no JSON.'); }
}

const view = (row) => ({
  id: row.id, kind: row.kind, name: row.name, description: row.description, license: row.license, source: row.source,
  author: row.author, rev: row.rev, rating: row.votes ? Math.round((row.stars / row.votes) * 10) / 10 : null, votes: row.votes,
  uses: row.uses, updated: new Date(row.updated).toISOString().slice(0, 10),
});

async function find(db, params) {
  const kind = ['skill', 'note'].includes(params.get('kind')) ? params.get('kind') : '';
  const limit = Math.min(Math.max(Number(params.get('limit')) || 10, 1), 30);
  const words = ((params.get('q') ?? '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 12);
  const of = kind ? ' AND e.kind = ?' : '';
  const kinds = kind ? [kind] : [];
  const rows = words.length
    ? await db.prepare(`SELECT ${COLUMNS} FROM entries_fts JOIN entries e ON e.id = entries_fts.id WHERE entries_fts MATCH ? AND e.hidden = 0${of}
        ORDER BY bm25(entries_fts, 0, 8, 4, 1) - (${AVERAGE} - 3) * 0.3 LIMIT ?`).bind(words.map((word) => `"${word}"*`).join(' OR '), ...kinds, limit).all()
    : await db.prepare(`SELECT ${COLUMNS} FROM entries e WHERE e.hidden = 0${of} ORDER BY ${AVERAGE} DESC, (e.owner = 'openautark') DESC, e.votes DESC, e.updated DESC LIMIT ?`).bind(...kinds, limit).all();
  return { entries: (rows.results ?? []).map(view) };
}

async function get(db, id) {
  const row = await db.prepare('SELECT * FROM entries WHERE id = ? AND hidden = 0').bind(id).first();
  if (!row) throw new Refused('No such entry.', 404);
  await db.prepare('UPDATE entries SET uses = uses + 1 WHERE id = ?').bind(id).run();
  const notes = await db.prepare(`SELECT stars, note, at FROM ratings WHERE entry = ? AND note <> '' ORDER BY at DESC LIMIT 5`).bind(id).all();
  let files = {};
  try { files = JSON.parse(row.files); } catch { files = {}; }
  return { ...view(row), body: row.body, files, notes: (notes.results ?? []).map((note) => ({ stars: note.stars, note: note.note, day: new Date(note.at).toISOString().slice(0, 10) })) };
}

/** The part of an address that stands for one place: IPv4 whole, IPv6 its /64 (one connection gets a whole /64), a mapped IPv4 as IPv4. */
function addressOf(ip) {
  const text = String(ip ?? '').trim().toLowerCase().split('%')[0];
  if (!text.includes(':')) return text || 'local';
  const mapped = /^(?:0{0,4}:){2,5}(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (mapped) return mapped[1];
  const [head, tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return text;
  return `v6:${groups.slice(0, 4).map((group) => group.padStart(4, '0')).join(':')}`;
}

/** A keyed hash of the caller's address and a period (HMAC with IP_SALT; plain sha256 only where no secret is set, as in tests). */
async function place(env, request, period) {
  const input = `${addressOf(request.headers.get('cf-connecting-ip'))}|${period}`;
  if (typeof env.IP_SALT !== 'string' || env.IP_SALT.length < 16) return sha256(input);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.IP_SALT), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** At most `max` actions of one kind an hour from one place (429); the action is counted here. */
async function limited(env, request, scope, max) {
  const db = env.DB;
  const now = Date.now();
  const key = `${scope}|${await place(env, request, new Date(now).toISOString().slice(0, 10))}`;
  const count = await db.prepare('SELECT COUNT(*) AS n FROM recent WHERE key = ? AND at > ?').bind(key, now - HOUR).first();
  if ((count?.n ?? 0) >= max) throw new Refused(`At most ${max} ${scope === 'rate' ? 'ratings' : 'shares'} an hour from one place.`, 429);
  await db.batch([db.prepare('INSERT INTO recent (key, at) VALUES (?, ?)').bind(key, now), db.prepare('DELETE FROM recent WHERE at < ?').bind(now - 24 * HOUR)]);
}

async function share(env, request) {
  const input = await body(request);
  const seeding = admin(env, request);
  const kind = input.kind === 'note' ? 'note' : 'skill';
  const name = slug(input.name);
  if (name.length < 2) throw new Refused('name: words of letters or digits.');
  const description = text(input.description, 10, 1024, 'description');
  const content = text(input.body, 20, MAX_BODY, 'body');
  const files = filesOf(input.files);
  if (SECRET.test([description, content, ...Object.values(files)].join('\n'))) throw new Refused('The text holds something that looks like a key or token, so it stays out of the public library.', 422);
  const owner = seeding ? 'openautark' : await sha256(text(input.voter, 16, 128, 'voter'));
  if (!seeding) await limited(env, request, 'share', SHARES_PER_HOUR);
  const db = env.DB;
  // The same owner updates its entry; someone else's entry of that name stays theirs and mine gets an id of its own.
  const taken = await db.prepare('SELECT owner FROM entries WHERE id = ?').bind(name).first();
  const mine = taken && taken.owner !== owner ? await db.prepare('SELECT id FROM entries WHERE owner = ? AND name = ?').bind(owner, name).first() : null;
  const id = !taken || taken.owner === owner ? name : mine?.id ?? `${name}-${owner.slice(0, SUFFIX)}`;
  // Never write over someone else's entry, however the id came about.
  const held = await db.prepare('SELECT owner FROM entries WHERE id = ?').bind(id).first();
  if (held && held.owner !== owner) throw new Refused('That name is taken by someone else.', 409);
  const rev = (await sha256(`${description}\n${content}\n${JSON.stringify(files)}`)).slice(0, 12);
  const license = seeding ? text(input.license, 2, 80, 'license') : 'CC0-1.0';
  const source = seeding ? text(input.source ?? '', 0, 300, 'source') : '';
  const author = seeding ? text(input.author ?? '', 0, 120, 'author') : '';
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO entries (id, kind, name, description, body, files, license, source, author, owner, rev, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, description = excluded.description, body = excluded.body, files = excluded.files,
        license = excluded.license, source = excluded.source, author = excluded.author, rev = excluded.rev, updated = excluded.updated
      WHERE entries.owner = excluded.owner`)
      .bind(id, kind, name, description, content, JSON.stringify(files), license, source, author, owner, rev, now, now),
    db.prepare('DELETE FROM entries_fts WHERE id = ?1 AND EXISTS (SELECT 1 FROM entries WHERE id = ?1 AND owner = ?2)').bind(id, owner),
    db.prepare('INSERT INTO entries_fts (id, name, description, body) SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM entries WHERE id = ?1 AND owner = ?5)').bind(id, name.replace(/-/g, ' '), description, content, owner),
  ]);
  return { id, rev, license };
}

async function rate(env, request, input) {
  const db = env.DB;
  const id = text(input.id, 1, 80, 'id');
  const stars = Number(input.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new Refused('stars: 1 to 5.');
  const note = typeof input.note === 'string' ? text(input.note, 0, 300, 'note') : '';
  if (SECRET.test(note)) throw new Refused('The note holds something that looks like a key or token.', 422);
  const voter = await sha256(text(input.voter, 16, 128, 'voter'));
  if (!(await db.prepare('SELECT 1 AS hit FROM entries WHERE id = ?').bind(id).first())) throw new Refused('No such entry.', 404);
  await limited(env, request, 'rate', RATES_PER_HOUR);
  const where = await place(env, request, new Date().toISOString().slice(0, 7));
  // One rating per place counts (installations behind one address count once, as their mean); OpenAutark's own
  // entries are never hidden by ratings.
  await db.batch([
    db.prepare(`INSERT INTO ratings (entry, voter, stars, note, at, place) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(entry, voter) DO UPDATE SET stars = excluded.stars, note = excluded.note, at = excluded.at, place = excluded.place`).bind(id, voter, stars, note, Date.now(), where),
    db.prepare(`UPDATE entries SET stars = (SELECT COALESCE(SUM(mean), 0) FROM (SELECT AVG(stars) AS mean FROM ratings WHERE entry = ?1 GROUP BY place)),
      votes = (SELECT COUNT(DISTINCT place) FROM ratings WHERE entry = ?1) WHERE id = ?1`).bind(id),
    db.prepare("UPDATE entries SET hidden = CASE WHEN owner <> 'openautark' AND votes >= 3 AND stars * 1.0 / votes < 2 THEN 1 ELSE 0 END WHERE id = ?").bind(id),
  ]);
  const row = await db.prepare('SELECT stars, votes FROM entries WHERE id = ?').bind(id).first();
  return { id, rating: Math.round((row.stars / row.votes) * 10) / 10, votes: row.votes };
}

async function remove(env, request, id) {
  if (!admin(env, request)) throw new Refused('Only OpenAutark removes entries.', 403);
  await env.DB.batch(['DELETE FROM entries WHERE id = ?', 'DELETE FROM entries_fts WHERE id = ?', 'DELETE FROM ratings WHERE entry = ?'].map((sql) => env.DB.prepare(sql).bind(id)));
  return { id, removed: true };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      let at = '';
      if (url.pathname.startsWith('/get/')) {
        try { at = decodeURIComponent(url.pathname.slice(5)); } catch { throw new Refused('The address is not valid.'); }
      }
      if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
      if (request.method === 'GET' && url.pathname === '/') return json({ name: 'The public library of Autark', find: '/find?q=words&kind=skill|note', get: '/get/<id>', share: 'POST /share', rate: 'POST /rate', license: 'shared entries: CC0-1.0' });
      if (request.method === 'GET' && url.pathname === '/find') return json(await find(env.DB, url.searchParams));
      if (request.method === 'GET' && at) return json(await get(env.DB, at));
      if (request.method === 'POST' && url.pathname === '/share') return json(await share(env, request));
      if (request.method === 'POST' && url.pathname === '/rate') return json(await rate(env, request, await body(request)));
      if (request.method === 'DELETE' && at) return json(await remove(env, request, at));
      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      if (error instanceof Refused) return json({ error: error.message }, error.status);
      return json({ error: 'The library could not answer.' }, 500);
    }
  },
};
