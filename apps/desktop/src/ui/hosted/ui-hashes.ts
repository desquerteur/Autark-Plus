// The iPhone web app's check of the PC's UI files (F29, 16.11.2026; the list: shared/model/ui-hashes.ts). shell.ts keeps
// the list the PC just sent over the tunnel in the worker's cache under <scope>ui-hashes.json before the PC UI mounts;
// sw.ts hands the page a file on that list only with exactly the listed bytes, and a script, stylesheet or worker that
// is not on it not at all – fresh from the PC or from its copy alike. A copy that differs counts as none and is fetched
// anew; a fresh file that differs is refused (sw.ts answers 403 with the reason and the shell page shows it). Before a
// no, the list is read again (a newer start kept one) and then asked of the PC through the same tunnel (it updated
// after this start), so the PC's own updates always pass.
// Owns: the list's place in the cache and the check of one answer. Never: takes a list from anywhere but the PC's
// answer over the tunnel, or decides which paths are the PC's (sw.ts does).

import { UI_HASHES_PATH, uiHashesOf } from '../../shared/model/ui-hashes.ts';

/** The worker's cache of the PC's files; the kept list sits there too. */
export const PC_CACHE = 'autark-pc';
/** Request destinations that run code in the page or style it: each must be a file on the PC's list. */
export const CODE = new Set(['script', 'style', 'worker', 'sharedworker', 'audioworklet', 'paintworklet', 'xslt']);

/** The few members of CacheStorage used here (the browser's `caches`, a fake in tests). */
export interface CacheStore { open(name: string): Promise<{ match(key: string): Promise<Response | undefined>; put(key: string, response: Response): Promise<void> }> }

/** Where the kept list sits for the app at `scope` (the shell's folder, e.g. 'https://app.example/app/'). */
export const hashesKey = (scope: string): string => new URL(UI_HASHES_PATH.slice(1), scope).href;

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Keeps the list the PC sent (shell.ts); false when `body` holds no list. */
export async function keepUiHashes(store: CacheStore, scope: string, body: Uint8Array<ArrayBuffer>): Promise<boolean> {
  let list: Map<string, string> | undefined;
  try { list = uiHashesOf(JSON.parse(new TextDecoder().decode(body))); } catch { return false; }
  if (!list) return false;
  await (await store.open(PC_CACHE)).put(hashesKey(scope), new Response(body.slice(), { headers: { 'content-type': 'application/json' } }));
  return true;
}

/** A list is kept here (shell.ts: without one the copies cannot be checked, so the start waits for the PC). */
export async function keptUiHashes(store: CacheStore, scope: string): Promise<boolean> {
  try { return Boolean(await (await store.open(PC_CACHE)).match(hashesKey(scope))); } catch { return false; }
}

/**
 * The PC's list as sw.ts checks against it: the list held, else the kept one (a newer start kept it), else the PC's own
 * answer through the tunnel (`ask`; the PC updated since the start – it is kept then).
 */
export class UiHashCheck {
  private readonly store: CacheStore;
  private readonly scope: string;
  private readonly ask: () => Promise<Response | undefined>;
  private list: Promise<Map<string, string>> | undefined;

  constructor(store: CacheStore, scope: string, ask: () => Promise<Response | undefined>) {
    this.store = store;
    this.scope = scope;
    this.ask = ask;
  }

  /** `file` is on the list held (read once; no round trip). */
  async held(file: string): Promise<boolean> {
    return (await (this.list ??= this.read())).has(file);
  }

  /** `file` is on the PC's list, looked up as far as needed. */
  listed(file: string): Promise<boolean> {
    return this.find((list) => list.has(file), true);
  }

  /**
   * `response` rebuilt from exactly the bytes checked, or undefined when they are not the PC's own `file` (`ask`: the PC
   * may be asked for its list). An answer that is not ok runs nothing (a browser runs no script or style from it) and
   * passes as it is.
   */
  async own(file: string, response: Response, ask = true): Promise<Response | undefined> {
    if (!response.ok) return response;
    const body = await response.arrayBuffer();
    const hash = await sha256Hex(body);
    if (!(await this.find((list) => list.get(file) === hash, ask))) return undefined;
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  private async find(test: (list: Map<string, string>) => boolean, ask: boolean): Promise<boolean> {
    if (test(await (this.list ??= this.read()))) return true;
    if (test(await (this.list = this.read()))) return true;
    return ask && test(await (this.list = this.fetch()));
  }

  private async fetch(): Promise<Map<string, string>> {
    try {
      const answer = await this.ask();
      if (answer?.status === 200) await keepUiHashes(this.store, this.scope, new Uint8Array(await answer.arrayBuffer()));
    } catch { /* not answered: the kept list stays */ }
    return this.read();
  }

  private async read(): Promise<Map<string, string>> {
    try {
      const kept = await (await this.store.open(PC_CACHE)).match(hashesKey(this.scope));
      return (kept && uiHashesOf(await kept.json())) || new Map();
    } catch {
      return new Map();
    }
  }
}
