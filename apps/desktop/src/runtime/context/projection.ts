// The section headers of a turn input that starts with my record as text (agents/history-text.ts: a turn without a session
// that holds my context) and where that record ends: it comes before "What is new:"; wake notes, recaps and the new lines
// are what the turn is for. 13.11.2026: never a chat's history – there is none in an agent.
// Only turn-prepare.ts writes a header line: a body line equal to one is escaped (quoteHeaders, in
// render.ts neutralize() and for notes). Also the marks of chat lines render.ts writes and
// the fake engine (engines/fake.ts) reads: the agent's own author label and the notes of a
// message the cursor stops before (it comes again in the next delta).
// The fake engine takes its directives only from the new part, so a directive in an old, already
// handled message never runs again.
// Owns: the header texts, withoutHistory(), quoteHeaders(), OWN_LABEL and HELD.
// Never: renders messages or reads the chat store.

export const PROJECTION = {
  history: 'My context so far – my own record, as text, because this session started without it:',
  fresh: 'What is new:',
} as const;

/** Marks the agent's own messages: "[11:05] Vic (me): …". */
export const OWN_LABEL = '(me)';

/** Notes of a message delta.ts stops the cursor before: a colleague's still streaming, a file still being read. */
export const HELD = {
  writing: '(still writing…)',
  extracting: '(Text extraction is still running; the text follows in a later turn.)',
  transcribing: '(Transcription is still running; the transcript follows in a later turn.)',
} as const;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HEADER_LINE = new RegExp(`^(${Object.values(PROJECTION).map(literal).join('|')})$`, 'gm');

/** Escapes lines that equal a section header ("\New messages:"), so text cannot end or start the history. */
export function quoteHeaders(text: string): string {
  return text.replace(HEADER_LINE, '\\$1');
}

/** Where `header` starts a paragraph of its own line (the turn input joins its parts with blank lines), or -1. */
function paragraphAt(text: string, header: string, from = 0): number {
  for (let at = text.indexOf(header, from); at >= 0; at = text.indexOf(header, at + 1)) {
    const starts = at === 0 || text.startsWith('\n\n', at - 2);
    const ends = at + header.length === text.length || text[at + header.length] === '\n';
    if (starts && ends) return at;
  }
  return -1;
}

/**
 * The turn input without my record as text: from its header up to and including the "What is new:" header (to the end when
 * nothing new follows). An input without it (a resumed session's input, notes only) comes back unchanged.
 */
export function withoutHistory(text: string): string {
  const start = paragraphAt(text, PROJECTION.history);
  if (start < 0) return text;
  const fresh = paragraphAt(text, PROJECTION.fresh, start);
  const end = fresh < 0 ? text.length : fresh + PROJECTION.fresh.length + 1;
  return `${text.slice(0, start)}${text.slice(end)}`.trim();
}
