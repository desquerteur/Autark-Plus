// What the call voice's plain text means (KI-Runde 17.11.2026, decision 7.4): the answer is what is said, and its tags are
// never said – `<as name="…">` at the start names who speaks in a call with several agents (no tag: nobody speaks),
// `<main now>…</main>` and `<main next>…</main>` at the end are what goes on to the agent's own work – also written
// `<main_now>`, closed with other words or not closed at all: what it holds goes on and is never said. `<silent/>` is the
// form of silence (FIXES-3 E1: a small model that has to write something wrote its silence out): an answer that holds it
// says nothing, names nobody and passes nothing on. While the model still writes, `sayableSoFar` is the part that is
// already speech (it ends before a tag) and `sentencesDone` – the reader's own rule – the part of it whose last sentence is
// finished: that is what goes to the reader at once.
// Owns: the tags' meaning on one text. Never: speaks, stores or passes anything on (talker.ts), or reads the chat.

/** One answer of the voice: who speaks, what is said, and what goes to the main work now or at its next step; `silent`: it holds the form of silence. */
export interface VoiceAnswer { as?: string; say: string; now?: string; next?: string; silent?: true }

const AS = /^\s*<as\s+name\s*=\s*"([^"]*)"\s*\/?>/i;
/** A hand-over tag read tolerantly: `<main now>` or `<main_now>`, closed by any `</main…>`, by the next hand-over or by the end. */
const MAIN = /<main[\s_]+(now|next)\s*>([\s\S]*?)(?:<\/main[^>]*>|(?=<main[\s_]+(?:now|next)\s*>)|$)/gi;
const MAIN_MAX = 2000;
/** The form of silence, read tolerantly: `<silent/>`, `<silent>`, `</silent>`. */
const SILENT = /<\s*\/?\s*silent\b[^>]*>/i;

const flat = (text: string, max = Infinity) => text.replace(/\s+/g, ' ').trim().slice(0, max);

/** The whole answer read apart; `say` empty is silence (the normal answer to a line that is not for me). */
export function readVoice(text: string): VoiceAnswer {
  if (SILENT.test(text)) return { say: '', silent: true };
  const named = AS.exec(text);
  let rest = named ? text.slice(named[0].length) : text;
  const hands = new Map<'now' | 'next', string>();
  rest = rest.replace(MAIN, (_whole, mode: string, body: string) => {
    const kind = mode.toLowerCase() as 'now' | 'next';
    const said = flat(body, MAIN_MAX);
    if (said && !hands.has(kind)) hands.set(kind, said);
    return ' ';
  });
  return {
    ...(named ? { as: flat(named[1], 80) } : {}),
    say: flat(rest.replace(/<\/?[a-z][^>]*>/gi, ' ')), // whole: what was read aloud while it streamed is where it starts
    ...(hands.has('now') ? { now: hands.get('now') } : {}),
    ...(hands.has('next') ? { next: hands.get('next') } : {}),
  };
}

/** The part of a still-growing answer that is already speech: after an opening `<as …>`, up to the first tag. */
export function sayableSoFar(text: string): string {
  const named = AS.exec(text);
  const rest = named ? text.slice(named[0].length) : text;
  if (!named && /^\s*<[a-z]*$/i.test(rest)) return ''; // a tag being written: nothing to say yet
  const at = rest.indexOf('<');
  return (at < 0 ? rest : rest.slice(0, at)).replace(/\s+/g, ' ').trimStart();
}

/** The leading part whose last sentence is finished – the same rule the reader uses (shared/voice/conversation-parts.ts). */
export { sentencesDone } from '../../shared/voice/conversation-parts.ts';
