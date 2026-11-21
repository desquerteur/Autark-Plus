// File paths in rendered agent text (B-081). An absolute path as a markdown link target or a code span carries it in
// `data-path` (never as an href: the sanitizer keeps only http(s), mailto and '#'), and a click or Enter on it opens the
// path where it is: on the author agent's home PC first, then on this PC – a folder as a folder tab, an image, video,
// audio file or PDF as a media tab, anything else as a file tab. No space is named, so the tab lands where the frame
// says: the global side pane on the desktop, the open chat's area on the phone. A path on neither PC opens its tab on the
// PC asked first (the tab's not-found page names similar paths); when that PC is offline or not linked, one toast says so,
// and so does a connection that may not read PC files (NO_PATH_READ). A file block's or review's Open uses it too (16.11.:
// a file an agent sent opens on the phone as in the chat, not only on the desktop).
// A Windows link target keeps its backslashes as written (CommonMark would read `\.` as an escape). The enclosing control
// wins: a code span in a link's label, or a path inside a button or label (an option, a card, a checklist item), stays
// plain text. A network path (`\\host\…`, `//host/…`) is no path here, so a click never makes this PC dial a host a
// message names. Selecting text keeps copying it: markdown.tsx opens nothing while a selection exists.
// Owns: which text in a rendered message is a file path (pathIn, pathTokenizer, pathRenderer, plainInControl) and what
// a click on one opens (openPathLink). Never: reads or draws a file itself (file-tabs.ts, FileView, MediaView), decides
// where a tab lands (pages.ts home()), or puts a path into an href.

import { Renderer, Tokenizer, type RendererObject, type TokenizerObject } from 'marked';
import '../../shared/api/methods-files.ts'; // the files.readPath shape (module augmentation)
import type { PathRead } from '../../shared/api/methods-files.ts';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { knownAgentMap, systemInfo } from '../lib/store.ts';
import { toastError } from '../lib/toasts.ts';
import { onPc, openFileTab, openFolderTab } from './file-tabs.ts';
import { viewKind } from './media-facts.ts';
import { openMedia } from './pages.ts';

const DRIVE = /^[A-Za-z]:[\\/]/;
/** A link target: any rooted posix path; '//host' or '/\host' (a web or network address) is none. */
const POSIX = /^\/(?![\\/])/;
/** A code span: two segments at least, so `/rpc` or a slash command stays text. */
const POSIX_SPAN = /^\/(?![\\/])[^/\s]+\//;
/** Globs, placeholders such as C:\Users\<name>, brace sets, pipes and line breaks are no path. */
const NOT_PATH = /[\r\n*?<>|"{}]/;

/** The absolute path `text` names (a link target, or a code span with `span`), else undefined. */
export function pathIn(text: string, span: boolean): string | undefined {
  const path = text.trim();
  if (!path || path.length > 1024 || NOT_PATH.test(path)) return undefined;
  return DRIVE.test(path) || (span ? POSIX_SPAN : POSIX).test(path) ? path : undefined;
}

/** A Windows path keeps its link target as written: marked reads `\.` or `\_` as an escape (C:\a\.git -> C:\a.git). */
function asWritten(token: { href: string } | undefined, dest: string | undefined): void {
  const path = dest?.trim().replace(/^<([^]*)>$/, '$1');
  if (token && path && DRIVE.test(path)) token.href = path;
}

/** marked tokenizers: an inline link and a link definition (`[x]: C:\a`) naming a Windows path keep its backslashes. */
export const pathTokenizer: TokenizerObject = {
  link(src) {
    const token = Tokenizer.prototype.link.call(this, src);
    if (token?.type === 'link') asWritten(token, this.rules.inline.link.exec(token.raw)?.[2]);
    return token;
  },
  def(src) {
    const token = Tokenizer.prototype.def.call(this, src);
    asWritten(token, this.rules.block.def.exec(src)?.[2]);
    return token;
  },
};

const escape = (text: string): string => text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

let inLabel = 0; // > 0 while a link's label renders: a code span there belongs to that link

/** marked renderers: a link or code span holding a path gets `data-path` and the path as its title; others render as before. */
export const pathRenderer: RendererObject = {
  link(token) {
    const path = pathIn(token.href, false);
    inLabel++;
    try {
      return path ? `<a data-path="${escape(path)}" title="${escape(path)}">${this.parser.parseInline(token.tokens)}</a>` : Renderer.prototype.link.call(this, token);
    } finally { inLabel--; }
  },
  codespan(token) {
    const path = inLabel ? undefined : pathIn(token.text, true);
    return path ? `<code data-path="${escape(path)}" title="${escape(path)}">${escape(token.text)}</code>` : false;
  },
};

/** Inline text inside a button or label: the control keeps its click, so a path there is plain text again. */
export function plainInControl(root: Element | null): void {
  if (!root?.parentElement?.closest('button, label')) return;
  for (const el of root.querySelectorAll('[data-path]')) for (const name of ['data-path', 'role', 'tabindex', 'title']) el.removeAttribute(name);
}

const nameOf = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
/** Why a click on a PC file opens nothing on this connection (files.readPath: the owner's devices on a secure link). */
export const NO_PATH_READ = "Files on the PC open from the owner's PC or phone over a secure connection; this one has no access to them.";

function show(read: PathRead, pc: string | undefined): void {
  if (read.state === 'folder') openFolderTab(read.path, undefined, undefined, pc);
  else if (viewKind('', read.path) !== 'file') openMedia({ path: read.path, ...onPc(pc) });
  else openFileTab(read.path, undefined, undefined, pc);
}

/** Opens `path` from a message by `authorId`: on that agent's home PC, else on this PC, else its not-found tab. */
export async function openPathLink(path: string, authorId?: string): Promise<void> {
  if (!pathIn(path, false)) return; // a network path or no path at all: nothing is asked
  if (!can('files.readPath')) { toastError(NO_PATH_READ, `Could not open ${nameOf(path)}`); return; }
  const home = authorId ? knownAgentMap.peek().get(authorId)?.deviceId : undefined;
  const pcs = home && home !== systemInfo.peek()?.deviceId ? [home, undefined] : [undefined];
  let first: { read?: PathRead; error?: unknown } | undefined; // the first PC's answer when it had nothing
  for (const pc of pcs) {
    let read: PathRead;
    try { read = await rpc.call('files.readPath', { path, ...onPc(pc) }); }
    catch (error) { first ??= { error }; continue; }
    if (read.state !== 'missing') { show(read, pc); return; }
    first ??= { read };
  }
  const missing = first?.read;
  if (!missing) { toastError(first?.error, `Could not open ${nameOf(path)}`); return; }
  (/[\\/]$/.test(path) ? openFolderTab : openFileTab)(missing.path, undefined, undefined, pcs[0]); // written with a closing separator: a folder
}
