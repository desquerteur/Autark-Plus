// The line window of files.read (B-048 real test, 28.10.2026): a long text never comes back in one piece. Engines
// shorten long tool outputs themselves (Codex cuts the middle), so an agent that got a 131k-character log "in full"
// saw head and tail only and counted wrongly – and re-read it again and again. A file shows at most WINDOW_CHARS of
// whole lines from `fromLine`, and the last line says exactly which lines were shown and where to continue.
// B-089 (11.11.2026, code audit): the window was 32,000 characters while a tool output above 24,000 (outputs.ts
// MAX_TEXT_CHARS) reaches the model as its first 6,000 – a long file came back cut, its continuation line lost. The
// window now stays below that cap. At the 8 MB read bound the answer says that the file goes on (it said "nothing from
// line N on"); files.search is named only for a file it searches (content up to 1 MB); a cut line says how long it is.
// Owns: the window rules and their footer text. Never: reads files (files.ts does) or decides what the agent needs.

import { MAX_TEXT_CHARS } from '../outputs.ts';

/** Characters one files.read answer shows at most: below the tool-output cap, with room for the footer and redaction. */
export const WINDOW_CHARS = MAX_TEXT_CHARS - 4_000;
/** Bytes read from disk when the agent asks for lines further down (a bigger file is read up to here only). */
export const LINE_READ_BYTES = 8 * 1024 * 1024;
/** files.search reads the content of files up to this size (files-search.ts CONTENT_BYTES). */
const SEARCHED_BYTES = 1024 * 1024;

export interface WindowArgs { fromLine?: number; lines?: number }
/** `size`: the file's bytes; `readBytes`: how many of them were read from its start. */
export interface WindowFile { size: number; readBytes: number }

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** `text` (the file's start up to the bytes read) cut to whole lines; the file is complete when all its bytes were read. */
export function lineWindow(text: string, args: WindowArgs, file: WindowFile): string {
  const complete = file.readBytes >= file.size;
  const bounded = !complete && file.readBytes >= LINE_READ_BYTES; // files.read reads no further than this
  const all = text.split(/\r?\n/);
  if (!complete && all.length > 1) all.pop(); // the last line may be cut by the byte limit
  const total = all.length;
  const from = Math.max(1, Math.floor(args.fromLine ?? 1));
  const beyond = `the first ${mb(file.readBytes)} of this ${mb(file.size)} file hold ${total} lines, and files.read reads no further`;
  if (from > total) return complete ? `[The file has ${total} lines; nothing from line ${from} on.]` : bounded ? `[Line ${from} lies further on: ${beyond}.]` : `[The file has at least ${total} lines; continue with files.read fromLine: ${from}.]`;
  const wanted = args.lines !== undefined ? Math.max(1, Math.floor(args.lines)) : Number.POSITIVE_INFINITY;
  const shown: string[] = [];
  let chars = 0;
  for (let i = from - 1; i < total && shown.length < wanted; i++) {
    const line = all[i];
    if (shown.length && chars + line.length + 1 > WINDOW_CHARS) break;
    shown.push(line.length > WINDOW_CHARS ? `${line.slice(0, WINDOW_CHARS)}… [line cut: its first ${WINDOW_CHARS} of ${line.length} characters]` : line);
    chars += Math.min(line.length, WINDOW_CHARS) + 1;
  }
  const last = from + shown.length - 1;
  const body = shown.join('\n');
  if (from === 1 && last >= total && complete) return body; // a short file stays exactly as it is
  const of = complete ? `${total}` : `at least ${total}`;
  const search = file.size <= SEARCHED_BYTES ? ', or find lines with files.search (content: true)' : '';
  const more = last < total || (!complete && !bounded) ? ` – continue with files.read fromLine: ${last + 1}${search}` : !complete ? ` – the file goes on: ${beyond}` : '';
  return `${body}\n[Lines ${from}–${last} of ${of} shown${more}.]`;
}
