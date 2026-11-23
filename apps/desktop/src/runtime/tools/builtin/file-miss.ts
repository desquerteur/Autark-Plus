// B-080 (live 05.–08.11.2026: 198 reads through files.read, files.list and files.search hit a path that does not exist;
// the answer named only the miss, so the next step was the next guess – 54 times another read, 50 times an extra
// listing): a miss shows what is there. missText answers files.read, files.list (files.ts), files.search's path
// (files-search.ts) and media.view's file (media-view.ts), in this order:
// 1. the miss itself, as before ("No file at <given>." / "No folder at <given>."), for a relative path with the folder
//    it counts from (the workspace – files.ts resolvePath); a path that is the other kind says so, one of the right
//    kind that cannot be read too (then nothing more);
// 2. the nearest folder that exists with what it holds: folders first (name/), at most LISTED, then "+N more"; hidden
//    entries left out;
// 3. the entries of exactly that name (case ignored), up to HITS absolute paths, below the nearest folder, my own folder
//    (a split part's folder, else my home project – git/records.ts turnCwd) and the workspace – files-search.ts's walk
//    within MISS_MS and MISS_ENTRIES (no links, hidden or dependency folders); with none, the folders it looked in.
//    B-080 review (a guess at C:\AGENTS.md walked C:\ first and spent the bounds before the workspace's own AGENTS.md):
//    a nearest folder that holds my own folder or the workspace is walked after them (searchRoots).
//    B-080 wave 3 (live 09.11.2026: a guessed root that skipped middle folders, a file moved from outbox to journal and a
//    miss in the workspace beside a big own folder all ended at the bounds): the first missing folder of the path is
//    looked for too – a folder of that name holding the rest of the path is named first ("The file lies at:"), one
//    without it as "A folder named …"; the walk also covers the folder above the nearest one; the workspace itself counts
//    as no broad folder.
//    B-080 wave 3 review (probe: five unrelated src folders pushed src/report-2026.md's file out; a miss at D:\foo\x
//    walked D:\ first): a first missing folder without the rest of the path is named but takes none of the HITS slots,
//    and the nearest folder is walked first, the one above it next unless that is a drive root, the home folder or
//    holds my own folder or the workspace.
// A call from a linked PC (ctx.fromPc) gets 1 and 2 only – files.search walks for this PC's agents alone.
// Owns: the miss text, its order and bounds. Never: writes, keeps an index or state, or follows links.

import { statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ToolContext } from '../types.ts';
import { turnCwd } from '../../git/records.ts';
import { walk } from './files-search.ts';

/** The name search of a miss ends after this long … */
export const MISS_MS = 1_500;
/** … or after this many entries. */
export const MISS_ENTRIES = 15_000;
/** Entries the listing names (beyond: "+N more"). */
const LISTED = 40;
/** Paths a name search names. */
const HITS = 5;

type Kind = 'file' | 'folder';

/** What lies at `target` (one stat – the walk's matcher asks too, for a first missing folder it meets). */
function kindOf(target: string): Kind | undefined {
  let info;
  try { info = statSync(target); } catch { return undefined; }
  return info.isDirectory() ? 'folder' : info.isFile() ? 'file' : undefined;
}

/** `target` when it is a folder, else its nearest ancestor that is one (undefined: none). */
function nearestFolder(target: string): string | undefined {
  for (let probe = path.resolve(target); ; probe = path.dirname(probe)) {
    if (kindOf(probe) === 'folder') return probe;
    if (path.dirname(probe) === probe) return undefined;
  }
}

/** "<dir> holds: g01/, BRIEF.md, … +N more" – folders first, each group by name; hidden entries left out. */
async function listing(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined);
  if (!entries) return `${dir} cannot be listed.`;
  const names = entries.filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, folder: entry.isDirectory() }))
    .sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, 'en'))
    .map((entry) => (entry.folder ? `${entry.name}/` : entry.name));
  if (!names.length) return `${dir} is empty.`;
  const more = names.length > LISTED ? `, +${names.length - LISTED} more` : '';
  return `${dir} holds: ${names.slice(0, LISTED).join(', ')}${more}`;
}

/** "a, b and c". */
const series = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** `dir` is `root` or below it (path.relative folds case on Windows). */
function inside(root: string, dir: string): boolean {
  const relative = path.relative(root, dir);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * The folders a name search looks below, each once: the nearest folder; the folder above it (B-080 wave 3: a file moved
 * to a sibling folder – outbox to journal – lies there) unless that is a broad folder – a drive root, the home folder or
 * one strictly above my own folder or the workspace (B-080 wave 3 review: it would spend the shared bounds first); my own
 * folder; the workspace. A nearest folder strictly above my own folder or the workspace comes last (B-080 review). The
 * walk skips a root it meets again inside another; the workspace itself is no broad folder.
 */
export function searchRoots(ctx: ToolContext, near: string | undefined): string[] {
  let own: string | undefined;
  try { own = ctx.split?.cwd ?? turnCwd(ctx.services, undefined, ctx.agent?.id); } catch { own = undefined; }
  const workspace = ctx.services.paths.workspace;
  const holds = (dir: string) => [own, workspace].some((d) => d && path.relative(dir, path.resolve(d)) !== '' && inside(dir, path.resolve(d)));
  const broad = (dir: string) => path.dirname(dir) === dir || path.relative(os.homedir(), dir) === '' || holds(dir);
  const up = near && path.dirname(near);
  const roots: string[] = [];
  for (const dir of near && holds(near) ? [own, workspace, near] : [near, up && !broad(up) ? up : undefined, own, workspace]) {
    if (dir && !roots.some((root) => path.relative(root, path.resolve(dir)) === '')) roots.push(path.resolve(dir));
  }
  return roots;
}

/**
 * The answer to a path that holds no `what` (default a file): `given` as the call named it, `target` the path it
 * resolved to. Lines: the miss, the nearest folder's listing, the entries of that exact name (or that there are none).
 */
export async function missText(ctx: ToolContext, given: string, target: string, what: Kind = 'file'): Promise<string> {
  const workspace = path.resolve(ctx.services.paths.workspace);
  const found = kindOf(target);
  if (found === what) return `No ${what} can be read at ${given} – no access.`;
  const other = found;
  const relative = !path.isAbsolute(given) && !other ? ` (a relative path counts from the workspace ${workspace})` : '';
  const lines = [`No ${what} at ${given}${relative}${other ? ` – that is a ${other}` : ''}.`];
  const near = nearestFolder(other === 'folder' ? target : path.dirname(path.resolve(target)));
  if (near) lines.push(await listing(near));
  const base = path.basename(path.resolve(target));
  if (other || ctx.fromPc !== undefined || !base) return lines.join('\n');
  const roots = searchRoots(ctx, near);
  const wanted = base.toLowerCase();
  // B-080 wave 3: the first missing folder of the path is looked for too, and the rest of the path below each one found.
  // Review: one without the rest is kept aside (up to HITS) – it never takes a slot from the file asked for.
  const rest = near ? path.relative(near, path.resolve(target)).split(path.sep) : [];
  const head = rest.length > 1 ? rest[0].toLowerCase() : undefined;
  const heads: string[] = [];
  const result = await walk(ctx, roots.map((dir) => ({ dir, home: false })), base, false, HITS, MISS_ENTRIES, {
    matches: (name, folder, full) => {
      const lower = name.toLowerCase();
      if (folder === (what === 'folder') && lower === wanted) return true;
      if (!folder || lower !== head) return false;
      if (kindOf(path.join(full, ...rest.slice(1))) === what) return true;
      if (heads.length < HITS) heads.push(full);
      return false;
    },
    ms: MISS_MS, absolute: true,
  }).catch(() => undefined); // the answer keeps its first lines whatever the walk meets
  if (!result) return lines.join('\n');
  const whole: string[] = [];
  const named: string[] = [];
  for (const hit of result.hits) {
    const folder = hit.endsWith('/');
    const dir = hit.replace(/\/$/, '');
    const name = path.basename(dir).toLowerCase();
    const full = path.join(dir, ...rest.slice(1));
    if (folder && name === head && kindOf(full) === what) whole.push(full);
    if (folder === (what === 'folder') && name === wanted) named.push(dir);
  }
  const others = named.filter((dir) => !whole.some((full) => path.relative(full, dir) === '')); // named once
  const first = (count: number) => (count >= HITS ? ` (the first ${HITS} found)` : '');
  if (whole.length) lines.push(`The ${what} lies at:`, ...whole);
  if (others.length) lines.push(`A ${what} named ${base} lies at${first(result.hits.length)}:`, ...others);
  if (!result.hits.length) lines.push(`No ${what} named ${base} below ${series(roots)}${result.stopped ? ` – the search stopped after ${result.stopped}` : ''}.`);
  if (heads.length) lines.push(`A folder named ${rest[0]} lies at${first(heads.length)}:`, ...heads);
  return lines.join('\n');
}
