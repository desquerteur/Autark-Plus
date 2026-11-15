// When the subconscious calls its model before a turn (owner 01.11.2026, 28.10.2026; v1 14.11.2026: the routing call,
// service.ts): this check costs no model – a message with content (not a bare "mach das" or "ja bitte"). The main AI's own
// call (subconscious tool) needs no check.
// Owns: that check. Never: calls a model, reads or writes memory.

import { foldText } from '../knowledge/normalize.ts';

const MIN_CHARS = 6;

/** Words of a greeting, thanks, a yes or no, or a bare go-ahead: a message of only these holds nothing to look up or keep. */
const NO_CONTENT: ReadonlySet<string> = new Set([
  'hi', 'hey', 'hallo', 'hello', 'moin', 'servus', 'na', 'guten', 'good', 'morgen', 'morning', 'tag', 'abend', 'evening',
  'danke', 'dank', 'vielen', 'thanks', 'thank', 'you', 'thx', 'super', 'cool', 'top', 'perfekt', 'prima', 'klasse', 'toll',
  'great', 'nice', 'wie', 'gehts', 'geht', 'es', 'dir', 'how', 'are', 'bye', 'tschuss', 'ciao', 'lol', 'haha',
  'ja', 'yes', 'yep', 'yeah', 'jo', 'ok', 'okay', 'nein', 'no', 'nope', 'klar', 'sure', 'gerne', 'bitte', 'please', 'genau', 'passt',
  'einverstanden', 'stimmt', 'agreed', 'right', 'gut', 'fine', 'alles',
  'mach', 'mache', 'machen', 'macht', 'das', 'dies', 'tu', 'tue', 'so', 'los', 'weiter', 'jetzt', 'dann', 'und', 'nur', 'einfach',
  'do', 'it', 'that', 'this', 'go', 'ahead', 'continue', 'now', 'then', 'and', 'just',
]);

const wordsOf = (text: string): string[] => foldText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** A person's words worth a model: more than a few characters and more than greetings, thanks, yes/no and go-aheads. */
export function hasContent(text: string): boolean {
  return text.trim().length >= MIN_CHARS && !wordsOf(text).every((word) => NO_CONTENT.has(word));
}
