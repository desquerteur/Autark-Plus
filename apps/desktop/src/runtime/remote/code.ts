// The person code (B-084, decision 13): one Remote ID for all of my own PCs. It is the Remote ID of my root PC's key (the
// first PC keeps the ID it shows today). Every other own PC proves it belongs with a chain of signatures from the root to
// its key: at most MAX_LINKS links, each the previous key's Ed25519 signature over "wf-code-v1|<member fingerprint hex>"
// (wire format: .local/b084/notes/W4-format.md; Android relay/CodeChain.java, the iPhone's hosted/crypto.ts and the
// meeting server's protocol.ts check the same bytes). I keep the whole tree – every member with the fingerprint of the
// key that signed it – in kv 'remote.code' and it travels in my roster (devices/sync/roster.ts, 'ceo' links only, so an
// employer or employee never brings me a code): a PC I accept as my own gets my signature, a tree that outranks mine
// (one with members before a lone one, then the smaller root fingerprint) brings me its code, a PC whose tree I outrank
// gets my signature, and my own PCs missing from my tree (their signer was removed) are signed again. A removed PC's
// entry is dropped. Phones never answer for the code, so they need no chain. The parts that hold my key and database open
// it (rendezvous/service.ts); the others find it by my fingerprint (codeFor).
// Owns: the chain format, its check, the tree in kv and its merge rule. Never: signs a device that is not my own PC,
// or trusts a chain it did not verify.

import type { Db } from '../db/database.ts';
import { DevicesRepo } from '../devices/repo.ts';
import { b64url, fingerprintOf, fromB64url, verifyEd25519 } from '../devices/keys.ts';
import { KvRepo } from '../store/kv.ts';
import { remoteIdOf } from './id.ts';

export const MAX_LINKS = 8;
const MAX_TREE = 64;
const NS = 'remote.code';
const FP = /^[0-9a-f]{64}$/;

export interface Link { pub: string; sig: string }
/** root -> member, as it travels with an answer. */
export interface Chain { root: string; links: Link[] }
/** Every member with the fingerprint of the key that signed it. */
export interface Tree { root: string; links: Array<Link & { by: string }> }
export interface CodeKey { fingerprint: string; publicKey: Uint8Array; sign(data: Uint8Array): Buffer }

const signedBytes = (fp: string) => Buffer.from(`wf-code-v1|${fp}`, 'utf8');
const raw = (value: unknown, size = 32): Buffer | undefined => {
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const bytes = fromB64url(value);
  return bytes.length === size ? bytes : undefined;
};
const fpOf = (pub: string) => fingerprintOf(fromB64url(pub));
const lone = (tree: Tree) => tree.links.length === 0;
/** True when `a` outranks `b`: members before a lone root, then the smaller root fingerprint. */
const outranks = (a: Tree, b: Tree) => (lone(a) !== lone(b) ? !lone(a) : fpOf(a.root) < fpOf(b.root));

/** The fingerprint a valid chain ends at (for the code `remoteId` when given), else undefined. */
export function chainEnd(chain: unknown, remoteId?: string): string | undefined {
  const c = chain as Chain | null;
  if (!c || typeof c !== 'object' || !Array.isArray(c.links) || c.links.length > MAX_LINKS) return undefined;
  let prev = raw(c.root);
  if (!prev || (remoteId !== undefined && remoteIdOf(fingerprintOf(prev)) !== remoteId)) return undefined;
  for (const link of c.links) {
    const pub = raw(link?.pub);
    const sig = raw(link?.sig, 64);
    if (!pub || !sig || !verifyEd25519(prev, signedBytes(fingerprintOf(pub)), sig)) return undefined;
    prev = pub;
  }
  return fingerprintOf(prev);
}

/** The key `fp` may answer for `remoteId`: its own ID, or a chain from the code's root to it. */
export function belongs(remoteId: string, fp: string, chain?: unknown): boolean {
  if (remoteIdOf(fp) === remoteId) return true;
  return chain !== undefined && chain !== null && chainEnd(chain, remoteId) === fp.toLowerCase();
}

/** Only the members whose signature verifies from the root, once each, at most MAX_LINKS deep; `drop`: removed PCs. */
function resolved(tree: Tree, drop: (fp: string) => boolean = () => false): Tree {
  const rootFp = fpOf(tree.root);
  const reached = new Map<string, { pub: Buffer; depth: number }>([[rootFp, { pub: fromB64url(tree.root), depth: 0 }]]);
  const kept: Tree['links'] = [];
  for (let grew = true; grew;) {
    grew = false;
    for (const link of tree.links) {
      const fp = fpOf(link.pub);
      const by = reached.get(link.by);
      if (reached.has(fp) || drop(fp) || !by || by.depth >= MAX_LINKS || !verifyEd25519(by.pub, signedBytes(fp), fromB64url(link.sig))) continue;
      reached.set(fp, { pub: fromB64url(link.pub), depth: by.depth + 1 });
      kept.push({ pub: link.pub, sig: link.sig, by: link.by });
      grew = true;
    }
  }
  return { root: tree.root, links: kept };
}

/** A tree from the network: well-formed entries only, then resolved. */
export function parseTree(value: unknown, drop?: (fp: string) => boolean): Tree | undefined {
  const tree = value as Tree | null;
  if (!tree || typeof tree !== 'object' || !raw(tree.root) || !Array.isArray(tree.links)) return undefined;
  const links = tree.links.slice(0, MAX_TREE).filter((link) => raw(link?.pub) && raw(link.sig, 64) && typeof link.by === 'string' && FP.test(link.by));
  return resolved({ root: tree.root, links }, drop);
}

/** The chain from the root to `fp` inside a resolved tree, else undefined. */
export function chainIn(tree: Tree, fp: string): Chain | undefined {
  const rootFp = fpOf(tree.root);
  const links: Link[] = [];
  for (let at = fp; at !== rootFp;) {
    const entry = tree.links.find((link) => fpOf(link.pub) === at);
    if (!entry || links.length >= MAX_LINKS) return undefined;
    links.unshift({ pub: entry.pub, sig: entry.sig });
    at = entry.by;
  }
  return { root: tree.root, links };
}

const opened = new Map<string, PersonCode>();
const watchers = new Map<string, Set<() => void>>();

/** My person code, once the part with my key and database opened it (rendezvous/service.ts); undefined before. */
export function codeFor(fingerprint: string): PersonCode | undefined { return opened.get(fingerprint); }

/** Calls `fn` whenever the person code of `fingerprint` changes; returns the off switch. */
export function watchCode(fingerprint: string, fn: () => void): () => void {
  const set = watchers.get(fingerprint) ?? new Set();
  set.add(fn);
  watchers.set(fingerprint, set);
  return () => { set.delete(fn); };
}

export function openCode(db: Db, me: CodeKey, now: () => number): PersonCode {
  const code = new PersonCode(db, me, now);
  opened.set(me.fingerprint, code);
  return code;
}

export class PersonCode {
  private readonly db: Db;
  private readonly me: CodeKey;
  private readonly now: () => number;
  private cached?: Tree;

  constructor(db: Db, me: CodeKey, now: () => number) {
    this.db = db;
    this.me = me;
    this.now = now;
  }

  /** My tree (stored, verified, with me in it), else me alone as the root. */
  tree(): Tree {
    return (this.cached ??= this.load());
  }

  /** The code I answer for. */
  code(): string { return remoteIdOf(fpOf(this.tree().root)); }

  /** My chain from the root; an empty one when I am the root. */
  chain(): Chain { return chainIn(this.tree(), this.me.fingerprint) ?? { root: b64url(this.me.publicKey), links: [] }; }

  /** Signs one of my own PCs into my tree; false when it is in already or my chain is at MAX_LINKS. */
  sign(memberPub: string): boolean {
    const key = raw(memberPub);
    if (!key) return false;
    const fp = fingerprintOf(key);
    const tree = this.tree();
    if (fpOf(tree.root) === fp || tree.links.some((link) => fpOf(link.pub) === fp) || this.chain().links.length >= MAX_LINKS) return false;
    return this.save({ root: tree.root, links: [...tree.links, { pub: memberPub, by: this.me.fingerprint, sig: b64url(this.me.sign(signedBytes(fp))) }] });
  }

  /** My own PCs missing from my tree get my signature (a lone root signs only through take()). */
  signMissing(pubs: readonly string[]): boolean {
    if (lone(this.tree())) return false;
    let changed = false;
    for (const pub of pubs) changed = this.sign(pub) || changed;
    return changed;
  }

  /** The tree one of my own PCs (`senderPub`) sent: same root merges, an outranking one with me in it is adopted, else the sender gets my signature. */
  take(value: unknown, senderPub: string | undefined): boolean {
    const theirs = parseTree(value, this.removed);
    if (!theirs) return false;
    const mine = this.tree();
    if (theirs.root === mine.root) return this.save({ root: mine.root, links: [...mine.links, ...theirs.links] });
    if (outranks(theirs, mine)) return chainIn(theirs, this.me.fingerprint) ? this.save({ root: theirs.root, links: [...theirs.links, ...mine.links] }) : false;
    return senderPub ? this.sign(senderPub) : false;
  }

  /** Reads the tree again (a PC was removed). */
  refresh(): void { this.cached = undefined; }

  /** A PC removed here (a revoked row and no live one). */
  private readonly removed = (fp: string): boolean =>
    !new DevicesRepo(this.db).byFingerprint(fp) && Boolean(this.db.get('SELECT 1 FROM devices WHERE fingerprint = ? AND revoked_at IS NOT NULL', [fp]));

  private load(): Tree {
    const stored = parseTree(new KvRepo(this.db).get(NS, 'tree'), this.removed);
    return stored && chainIn(stored, this.me.fingerprint) ? stored : { root: b64url(this.me.publicKey), links: [] };
  }

  private save(next: Tree): boolean {
    const tree = resolved(next, this.removed);
    const before = this.tree();
    if (JSON.stringify(tree) === JSON.stringify(before) || !chainIn(tree, this.me.fingerprint)) return false;
    this.cached = tree;
    new KvRepo(this.db).set(NS, 'tree', tree, this.now());
    for (const fn of [...(watchers.get(this.me.fingerprint) ?? [])]) { try { fn(); } catch { /* a listener's failure stays its own */ } }
    return true;
  }
}
