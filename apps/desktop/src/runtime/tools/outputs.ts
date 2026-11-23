// Post-processing of tool outputs before they reach a model or the run journal.
// Owns: secret redaction in every text part, truncation of big text into blob references (an output a tool marked whole
// – KI-Runde 17.11.2026: chat.read of one line – up to WHOLE_CHARS, past it its head and tail around the stored file's
// path), the one bound of "whole" (WHOLE_CHARS, also a person's line in the turn, context/render.ts) and the compact
// journal form of args/outputs.
// Never: drops error flags or effect receipts, or stores secret values anywhere.
// B-089 (11.11.2026, code audit): a cut output pointed to "file <id>", which no tool opens. The head now ends at a whole
// line and the note names the stored text's path with the files.read call that goes on after it (device "this": the
// output is stored on the PC whose registry finalised it, also for a call another PC ran); without a stored copy the
// note says how much was cut and names no way.

import type { FileStore, SecretService } from '../contracts.ts';
import type { ToolOutput } from './types.ts';
import { maskKeyShapes } from '../secrets/redact.ts';

/** Text parts larger than this go to the blob store; the model gets head + reference. */
export const MAX_TEXT_CHARS = 24_000;

/** Outputs a tool hands on whole, past MAX_TEXT_CHARS (chat.read of one line: a person's long line is read in one piece). */
const WHOLE = new WeakSet<ToolOutput>();

/** The one bound of "whole" (a person's line in the turn, chat.read of one line): past it the head and the tail. */
export const WHOLE_CHARS = 100_000;

/** Room beside a whole body for its line's label (chat.read: chat, author, time, #seq), so a body that arrives whole in
 *  the turn also comes whole from chat.read. */
const LABEL_CHARS = 1_000;

/** `value`'s head and tail, WHOLE_CHARS together, with `between(left out)` as the line between them. */
export function headAndTail(value: string, between: (left: number) => string): string {
  const half = WHOLE_CHARS / 2;
  return `${value.slice(0, half)}\n${between(value.length - 2 * half)}\n${value.slice(-half)}`;
}

/** Marks `output` to reach the model whole (redacted as every output). */
export function whole(output: ToolOutput): ToolOutput {
  WHOLE.add(output);
  return output;
}
const HEAD_CHARS = 6_000;

/**
 * The head of a long text and the line to read on from: whole lines up to HEAD_CHARS when the last line end lies in its second
 * half; a text of longer lines is cut at HEAD_CHARS (a short first line followed by one huge line would else show almost nothing),
 * and the line that holds the cut is the one to read on from.
 */
function headOf(value: string): { head: string; nextLine: number } {
  const end = value.lastIndexOf('\n', HEAD_CHARS);
  if (end >= HEAD_CHARS / 2) {
    const head = value.slice(0, end);
    return { head, nextLine: head.split('\n').length + 1 };
  }
  const head = value.slice(0, HEAD_CHARS);
  return { head, nextLine: head.split('\n').length };
}

/** The note under a cut output: how much was shown and, with a stored copy, the call that reads on. */
function cutNote(value: string, head: string, nextLine: number, stored?: string): string {
  const shown = `output truncated: ${value.length} chars, the first ${head.length} shown`;
  if (!stored) return `\n… [${shown}; no stored copy of the rest]`;
  const lines = value.split('\n').length;
  return `\n… [${shown}; all ${lines} lines are stored – files.read path: ${JSON.stringify(stored)}, device: "this", fromLine: ${nextLine}]`;
}
/** Journal entries keep only short previews (big data lives in blobs). */
export const JOURNAL_CHARS = 2_000;

export async function finalizeOutput(output: ToolOutput, deps: { secrets: SecretService; files: FileStore }, name: string): Promise<{ output: ToolOutput; blobIds: string[] }> {
  const blobIds: string[] = [];
  const content: ToolOutput['content'] = [];
  for (const part of output.content ?? []) {
    if (part.type !== 'text') { content.push(part); continue; }
    let value = safeRedact(deps.secrets, part.text);
    const whole = WHOLE.has(output);
    if (value.length > (whole ? WHOLE_CHARS + LABEL_CHARS : MAX_TEXT_CHARS)) {
      let stored: string | undefined;
      try {
        const ref = await deps.files.put(new TextEncoder().encode(value), `${name.replace(/[^a-z0-9_.-]/gi, '_')}-output.txt`, 'text/plain');
        blobIds.push(ref.id);
        try { stored = deps.files.path(ref.id); } catch { stored = undefined; }
      } catch { /* not stored: the note says so */ }
      if (whole) value = headAndTail(value, (left) => `… [${left} chars left out here; ${stored ? `all of it is stored – files.read path: ${JSON.stringify(stored)}, device: "this"` : 'no stored copy'}] …`);
      else {
        const { head, nextLine } = headOf(value);
        value = `${head}${cutNote(value, head, nextLine, stored)}`;
      }
    }
    content.push({ type: 'text', text: value });
  }
  const structured = output.structured === undefined ? undefined : redactDeep(deps.secrets, output.structured);
  return { output: { ...output, content, structured }, blobIds };
}

/** The vault's known values first, then what shows itself as a key by its shape (secrets/redact.ts maskKeyShapes). */
export function safeRedact(secrets: SecretService, value: string): string {
  let out = value;
  try { out = secrets.redact(out); } catch { /* the shape rule below still runs */ }
  try { return maskKeyShapes(out); } catch { return out; }
}

function redactDeep(secrets: SecretService, value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return safeRedact(secrets, value);
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactDeep(secrets, item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = redactDeep(secrets, item, depth + 1);
  return out;
}

/** Short JSON preview for the journal (redacted, truncated). */
export function preview(secrets: SecretService, value: unknown, max = JOURNAL_CHARS): string {
  let textValue: string;
  try { textValue = typeof value === 'string' ? value : JSON.stringify(value) ?? ''; } catch { textValue = String(value); }
  textValue = safeRedact(secrets, textValue);
  return textValue.length > max ? `${textValue.slice(0, max)}…` : textValue;
}

/** Concatenated text of an output (for summaries and journal previews). */
export function outputText(output: ToolOutput): string {
  return (output.content ?? []).map((part) => (part.type === 'text' ? part.text : `[${part.mime}]`)).join('\n');
}
