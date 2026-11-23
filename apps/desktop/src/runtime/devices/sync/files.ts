// Files between the CEO's own PCs (mesh method 'sync.file'): whole files by sha256 – from <data> theme.css, prompts/,
// modes/, agents/** (SYSTEM.md, Main Skills, agent.json, images; not the generated agents/README.md), memory/**,
// connectors/mcp.json and mail.json, and the workspace's skills/**. A manifest (kv ns 'sync.files': path → sha, size,
// mtime, at; sha '' = removed) says what this PC has; a scan finds changes by size and mtime, then by hash. A link-up
// sends the entries stored after that PC's cursor (all the first time; what is left when its link goes, the next one),
// a change seen later goes at once ('have': the data folder watcher's tap when it has one, else the owners' events).
// The other PC pulls what is newer (`at`:
// the file's mtime, a removal's time) in pieces of at most 1 MiB like send-file.ts into a *.tmp file (the watcher
// ignores those) and puts it in place (file-io.ts: a rename, a copy where Windows refuses it) – so the file's owner
// (agent core, memory, theme …) takes it like an edit. A pull that failed leaves the link-up incomplete, so the
// next one offers it again; while that PC stays linked it is tried again after 2, 10 and 60 s. A file that changed
// here while its pull ran stays (the pull is dropped). What a 'have' finds changed here and does not replace goes out
// at once, to its sender too; a look that a pull overtook leaves the entry to the pull. B-087 for agents/<id>/SYSTEM.md,
// whose text also travels in the agents row: one that came before its row is taken over at once as the echo of that
// PC's change (stamps.ts) – unless the row here had already brought newer instructions, then the row stands –, and a
// rewrite with the same bytes (a save back to what the file says) is a new version. settings.json travels here as op 'settings'
// (settings.ts), stored files' bytes as op 'blob' (blobs.ts).
// Owns: the manifest, scans, pulls and which paths may be written. Never: writes outside these roots, follows a
// link, or talks to a PC that is no 'ceo' link.

import { randomUUID } from 'node:crypto';
import { lstatSync, type Stats } from 'node:fs';
import { lstat, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeServices } from '../../contracts.ts';
import { WorkforceError } from '../../../shared/errors.ts';
import { KvRepo } from '../../store/kv.ts';
import { DevicesRepo } from '../repo.ts';
import { blobPiece } from './blobs.ts';
import { hashFile, pullPieces, readPiece, replaceWithSync } from './file-io.ts';
import { linkOf, links } from './home.ts';
import { SettingsSync, type SettingsMessage } from './settings.ts';
import { wins, type Stamps } from './stamps.ts';

const DATA_ROOTS = ['theme.css', 'prompts', 'modes', 'agents', 'memory', 'connectors/mcp.json', 'connectors/mail.json'];
const WORKSPACE_ROOTS = ['skills'];
const NEVER: ReadonlySet<string> = new Set(['agents/README.md']);
const NS = 'sync.files';
const PAGE = 500;
const MAX_FILES = 200_000;
/** Waits before each new try of a pull that failed while its PC stays linked. */
const RETRY_MS: readonly number[] = [2_000, 10_000, 60_000];
const SYSTEM_MD = /^agents\/([^/]+)\/SYSTEM\.md$/;

interface Entry { sha: string; size: number; mtime: number; at: number }
interface Have { rel: string; sha: string; at: number }
/** A planned new try of a failed pull: the newest offer for its path, from which PC; `fired`: it ran. */
interface Retry { step: number; fired: boolean; have: Have; from: string; joined: boolean; timer: ReturnType<typeof setTimeout> }

/** An owner's watcher tap (RootWatcher.tap when it exists): `name` the data folder entry, `parts` below it. */
export type WatcherTap = (listener: (name: string, parts?: readonly string[]) => void) => () => void;

const errorText = (error: unknown) => String((error as Error)?.message ?? error);

export class FileSync {
  private readonly s: RuntimeServices;
  private readonly kv: KvRepo;
  private readonly stamps: Stamps;
  readonly settings: SettingsSync;
  private readonly roots = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  /** Pulls that failed, by path: the next try while their PC stays linked. */
  private readonly retries = new Map<string, Retry>();
  /** The rename that puts a pulled file in place (tests make it refuse; default file-io.ts's). */
  move?: (from: string, to: string) => void;
  /** The waits before each new try of a failed pull (tests shorten them). */
  retryMs: readonly number[] = RETRY_MS;

  constructor(s: RuntimeServices, stamps: Stamps) {
    this.s = s;
    this.kv = new KvRepo(s.db);
    this.stamps = stamps;
    this.settings = new SettingsSync(s, stamps, (message, except) => { void this.toCeo({ op: 'settings', ...message }, except); });
  }

  /** Change triggers: the watcher tap (if any) and the owners' events; returns the off switch. */
  attach(tap?: WatcherTap): () => void {
    const bus = this.s.bus;
    const offs = [
      this.settings.attach(),
      bus.on('theme.updated', () => this.soon('theme.css')),
      bus.on('modes.changed', () => this.soon('modes')),
      bus.on('apps.changed', () => { this.soon('connectors/mcp.json'); this.soon('connectors/mail.json'); }),
      bus.on('skills.changed', () => this.soon('skills')),
      bus.on('agent.upserted', (agent) => this.soon(`agents/${agent.id}`)),
    ];
    if (tap) offs.push(tap((name, parts) => this.soon([name, ...(parts ?? [])].join('/'))));
    return () => {
      for (const off of offs) off();
      if (this.timer) clearTimeout(this.timer);
      for (const rel of [...this.retries.keys()]) this.retried(rel);
    };
  }

  /** A path (or a folder of them) changed: looked at once, a second later. */
  private soon(rel: string): void {
    if (!this.allowed(rel, true)) return;
    this.roots.add(rel);
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.scanQueued(); }, 1000);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private async scanQueued(): Promise<void> {
    const roots = [...this.roots];
    this.roots.clear();
    const changed: Have[] = [];
    for (const root of roots) changed.push(...await this.scan(root));
    if (changed.length) await this.toCeo({ op: 'have', entries: changed });
  }

  // ---------------------------------------------------------------- paths and the manifest

  /** Whether `rel` lies in a synced root (`prefix`: it may also be a folder above files). */
  private allowed(rel: string, prefix = false): boolean {
    const parts = rel.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.') || /[\\:\u0000]/.test(part)) || NEVER.has(rel)) return false;
    if (/\.(tmp|part)$/i.test(rel)) return false;
    return [...DATA_ROOTS, ...WORKSPACE_ROOTS].some((root) => rel === root || rel.startsWith(`${root}/`) || (prefix && root.startsWith(`${rel}/`)));
  }

  private abs(rel: string): string | undefined {
    if (!this.allowed(rel)) return undefined;
    const base = WORKSPACE_ROOTS.some((root) => rel === root || rel.startsWith(`${root}/`)) ? this.s.paths.workspace : this.s.paths.data;
    return path.join(base, ...rel.split('/'));
  }

  private toRel(file: string): string {
    const workspace = path.relative(this.s.paths.workspace, file);
    const rel = !workspace.startsWith('..') && !path.isAbsolute(workspace) && workspace.split(path.sep)[0] === 'skills' ? workspace : path.relative(this.s.paths.data, file);
    return rel.split(path.sep).join('/');
  }

  /** Looks at one file: a changed (or removed) one gets a new manifest entry, returned. */
  private async check(rel: string): Promise<Have | undefined> {
    const file = this.abs(rel);
    if (!file) return undefined;
    const old = this.kv.get<Entry>(NS, rel);
    // A pull (or another look) stored this path while this one waited: it looks again – a pulled file then matches its
    // entry, a newer state than an older look stored goes on top.
    const moved = () => JSON.stringify(this.kv.get<Entry>(NS, rel)) !== JSON.stringify(old);
    const info = await lstat(file).catch(() => undefined);
    const now = this.s.clock.now();
    if (!info?.isFile()) {
      if (!old?.sha) return undefined;
      if (moved()) return this.check(rel);
      const gone: Entry = { sha: '', size: 0, mtime: 0, at: Math.max(now, old.at + 1) };
      this.kv.set(NS, rel, gone, now);
      return { rel, sha: '', at: gone.at };
    }
    if (old?.sha && old.size === info.size && old.mtime === info.mtimeMs) return undefined;
    const sha = await hashFile(file);
    if (moved()) return this.check(rel);
    const rewritten = old?.sha === sha && SYSTEM_MD.test(rel) && Math.floor(info.mtimeMs) > old.at; // a save back to what SYSTEM.md says
    if (old?.sha === sha && !rewritten) { this.s.db.run('UPDATE kv SET value = ? WHERE ns = ? AND key = ?', [JSON.stringify({ ...old, size: info.size, mtime: info.mtimeMs }), NS, rel]); return undefined; }
    const entry: Entry = { sha, size: info.size, mtime: info.mtimeMs, at: Math.max(Math.floor(info.mtimeMs), (old?.at ?? 0) + 1) };
    this.kv.set(NS, rel, entry, now);
    return { rel, sha, at: entry.at };
  }

  /** Every file under `root` (a synced root, a folder in one, or one file) plus the removed ones it had. */
  private async scan(root: string): Promise<Have[]> {
    const rels = new Set<string>();
    for (const top of [...DATA_ROOTS, ...WORKSPACE_ROOTS].filter((name) => name === root || name.startsWith(`${root}/`) || root.startsWith(`${name}/`))) {
      const start = top.length >= root.length ? top : root;
      const file = this.abs(start);
      const info = file ? await lstat(file).catch(() => undefined) : undefined;
      if (info?.isFile()) rels.add(start);
      if (!info?.isDirectory()) continue;
      for (const entry of await readdir(file!, { recursive: true, withFileTypes: true }).catch(() => [])) {
        if (rels.size >= MAX_FILES) break;
        const rel = this.toRel(path.join(entry.parentPath, entry.name));
        if (entry.isFile() && this.allowed(rel)) rels.add(rel);
      }
    }
    for (const row of this.s.db.all<{ key: string }>('SELECT key FROM kv WHERE ns = ? AND (key = ? OR substr(key, 1, ?) = ?)', [NS, root, root.length + 1, `${root}/`])) rels.add(row.key);
    const changed: Have[] = [];
    for (const rel of rels) {
      try { const have = await this.check(rel); if (have) changed.push(have); } catch (error) { this.s.log.info('synced file not read', { rel, error: errorText(error) }); }
    }
    return changed;
  }

  // ---------------------------------------------------------------- sending

  private async toCeo(params: Record<string, unknown>, except?: string): Promise<void> {
    for (const { record, link } of links(this.s.db)) {
      if (link.kind !== 'ceo' || record.id === except || !this.s.devices.online(record.id)) continue;
      await this.post(record.id, params);
    }
  }

  /** False when the call failed or the other PC could not pull a file it wanted (it is offered again). */
  private async post(peer: string, params: Record<string, unknown>): Promise<boolean> {
    try {
      const answer = await this.s.devices.call(peer, 'sync.file', params) as { failed?: unknown } | undefined;
      return !(typeof answer?.failed === 'number' && answer.failed > 0);
    } catch (error) {
      this.s.log.info('sync files not sent', { peer, op: params.op, error: errorText(error) });
      return false;
    }
  }

  /** What the link-up owes a CEO PC: the settings, then the manifest entries stored after `since` (all the first time); false when not all arrived. */
  async catchUp(peer: string, since: number | undefined): Promise<boolean> {
    if (linkOf(new DevicesRepo(this.s.db).get(peer))?.kind !== 'ceo') return true;
    let ok = await this.post(peer, { op: 'settings', ...this.settings.current() });
    for (const root of [...DATA_ROOTS, ...WORKSPACE_ROOTS]) await this.scan(root);
    const rows = this.s.db.all<{ key: string; value: string }>('SELECT key, value FROM kv WHERE ns = ? AND updated_at > ? ORDER BY updated_at, key', [NS, since ?? -1]);
    for (let index = 0; index < rows.length; index += PAGE) {
      if (!this.s.devices.online(peer)) { ok = false; break; } // B-087: the link is gone – no dial per page; the next link-up offers the rest
      const entries = rows.slice(index, index + PAGE).map((row) => { const entry = JSON.parse(row.value) as Entry; return { rel: row.key, sha: entry.sha, at: entry.at }; });
      ok = (await this.post(peer, { op: 'have', entries })) && ok;
    }
    return ok;
  }

  // ---------------------------------------------------------------- receiving

  /** 'sync.file' from a CEO PC: settings, a list of what it has, one piece of a file or of a stored file's bytes. */
  async receive(params: unknown, from: string): Promise<unknown> {
    const record = new DevicesRepo(this.s.db).get(from);
    if (linkOf(record)?.kind !== 'ceo') throw new WorkforceError('forbidden', 'Files come only from the CEO\'s own PCs.');
    const p = (params ?? {}) as { op?: unknown; rel?: unknown; id?: unknown; offset?: unknown; entries?: unknown };
    if (p.op === 'settings') { this.settings.receive(p as unknown as SettingsMessage, from, Boolean(record?.joinedAs)); return { ok: true }; }
    if (p.op === 'have' && Array.isArray(p.entries)) return { ok: true, ...await this.have(p.entries, from, Boolean(record?.joinedAs)) };
    if (typeof p.offset !== 'number' || !(p.op === 'get' && typeof p.rel === 'string') && !(p.op === 'blob' && typeof p.id === 'string')) {
      throw new WorkforceError('bad_request', 'Unknown file sync request.');
    }
    const file = p.op === 'get' ? this.abs(p.rel as string) : undefined;
    const piece = p.op === 'blob' ? await blobPiece(this.s, p.id as string, p.offset) : file ? await readPiece(file, p.offset) : undefined;
    if (!piece) throw new WorkforceError('not_found', 'That file is not here.');
    return piece;
  }

  /** Takes every entry that is newer than this PC's (removes or pulls the file), then tells the other CEO PCs; `failed`: pulls that did not work. */
  private async have(list: unknown[], from: string, joined: boolean): Promise<{ taken: number; failed: number }> {
    const taken: Have[] = [];
    const own: Have[] = [];
    let failed = 0;
    for (const raw of list) {
      const entry = raw as Partial<Have>;
      if (typeof entry?.rel !== 'string' || typeof entry.sha !== 'string' || typeof entry.at !== 'number' || !this.abs(entry.rel)) continue;
      const have = entry as Have;
      try {
        const changed = await this.check(have.rel); // this PC's own state first
        const mine = this.kv.get<Entry>(NS, have.rel);
        if (mine?.sha === have.sha) this.later(have.rel, have.at);
        if (mine?.sha === have.sha || !wins({ at: have.at, h: have.sha }, mine && { at: mine.at, h: mine.sha }, joined)) {
          this.retried(have.rel);
          if (changed) own.push(changed);
          continue;
        }
        if (have.sha) {
          const got = await this.pull(from, have, mine);
          if (got === false) { failed++; this.retryLater(from, have, joined); continue; }
          if (got === undefined) { this.retried(have.rel); continue; } // an overlapping pull put it in place and passed it on
        } else {
          await rm(this.abs(have.rel)!, { force: true });
          this.kv.set(NS, have.rel, { sha: '', size: 0, mtime: 0, at: have.at }, this.s.clock.now());
        }
        this.retried(have.rel);
        taken.push(have);
      } catch (error) {
        failed++;
        this.s.log.info('synced file not taken', { rel: have.rel, error: errorText(error) });
        this.retryLater(from, have, joined);
      }
    }
    if (taken.length) void this.toCeo({ op: 'have', entries: taken }, from);
    if (own.length) void this.toCeo({ op: 'have', entries: own }); // newer here: the sender gets it too
    return { taken: taken.length, failed };
  }

  /** The next try of a pull that failed, while its PC stays linked (the next link-up offers it anyway); a try already planned stays and takes the newest offer. */
  private retryLater(from: string, have: Have, joined: boolean): void {
    const planned = this.retries.get(have.rel);
    if (planned && !planned.fired) {
      if (wins({ at: have.at, h: have.sha }, { at: planned.have.at, h: planned.have.sha }, joined)) Object.assign(planned, { have, from, joined });
      return;
    }
    const step = (planned?.step ?? -1) + 1;
    this.retried(have.rel);
    if (step >= this.retryMs.length) return;
    const retry = { step, fired: false, have, from, joined } as Retry;
    retry.timer = setTimeout(() => {
      retry.fired = true;
      if (this.s.devices.online(retry.from)) void this.have([retry.have], retry.from, retry.joined); else this.retried(retry.have.rel);
    }, this.retryMs[step]);
    (retry.timer as { unref?: () => void }).unref?.();
    this.retries.set(have.rel, retry);
  }

  /** The same bytes came with a later time: kept, so a later change here still counts as newer (also after a clock skew). */
  private later(rel: string, at: number): void {
    const entry = this.kv.get<Entry>(NS, rel);
    if (entry?.sha && at > entry.at) this.kv.set(NS, rel, { ...entry, at }, this.s.clock.now());
  }

  private retried(rel: string): void {
    const retry = this.retries.get(rel);
    if (retry) clearTimeout(retry.timer);
    this.retries.delete(rel);
  }

  /** `mine`: this PC's entry when the pull was decided – a file changed here since stays; undefined: an overlapping pull put this version in place. */
  private async pull(from: string, have: Have, mine: Entry | undefined): Promise<boolean | undefined> {
    const file = this.abs(have.rel)!;
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await pullPieces(temp, (offset) => this.s.devices.call(from, 'sync.file', { op: 'get', rel: have.rel, offset }));
      if (await hashFile(temp) !== have.sha) throw new Error('it changed on the way');
      if (this.kv.get<Entry>(NS, have.rel)?.sha === have.sha) { this.later(have.rel, have.at); await rm(temp, { force: true }); return undefined; }
      // From here on in one synchronous step: no save here can land between the last look and the file in place.
      if (this.changedHere(have.rel, file, mine)) throw new Error('it changed here meanwhile');
      const agentId = SYSTEM_MD.exec(have.rel)?.[1];
      const ahead = agentId !== undefined && this.s.agentCore?.rowAhead(agentId) === true;
      replaceWithSync(temp, file, this.move);
      const info = lstatSync(file);
      this.kv.set(NS, have.rel, { sha: have.sha, size: info.size, mtime: info.mtimeMs, at: have.at }, this.s.clock.now());
      if (agentId) this.arrived(agentId, ahead);
      return true;
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      this.s.log.info('synced file not pulled', { rel: have.rel, error: errorText(error) });
      return false;
    }
  }

  /** Whether the file changed here since `mine` was stored (a save while its pull ran): a scan stored another state, or it is not the file `mine` describes. */
  private changedHere(rel: string, file: string, mine: Entry | undefined): boolean {
    if (this.kv.get<Entry>(NS, rel)?.sha !== mine?.sha) return true;
    let info: Stats | undefined;
    try { info = lstatSync(file); } catch { info = undefined; }
    if (!info?.isFile()) return Boolean(mine?.sha);
    return !mine?.sha || info.size !== mine.size || info.mtimeMs !== mine.mtime;
  }

  /**
   * A SYSTEM.md in place now. `ahead`: the agents row here had already brought newer instructions than the app's own
   * file – the row stands and the pulled file is the app's own. Else the agent core takes it over at once, and that
   * change of the row is the echo of the change on the PC it came from (stamps.ts).
   */
  private arrived(agentId: string, ahead: boolean): void {
    if (ahead) { this.s.agentCore?.arrived(agentId, true); return; }
    const key = `agents/${agentId}`;
    this.stamps.echo.add(key);
    try { this.s.agentCore?.arrived(agentId); } finally { this.stamps.echo.delete(key); }
  }
}
