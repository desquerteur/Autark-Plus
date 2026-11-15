// Task categories for routing: keyword inference from what a turn is about (English and
// German, the user's languages), the category's default effort and a short label.
// Owns: the keyword table. Categories are exactly CATEGORIES of models/priors.ts.
// Never: calls a model – this is the cheap deterministic first step; a specific mode's category wins.
// B-047 D12: 'manager-planner' (the manager mode) is refined like 'chat': a Manager's chat, research or PC turn
// gets the category of its text (else 'chat'); only a turn without text (model lists) keeps the mode's own category.
// B-080: equal top scores name no kind (inferCategory) – a tie used to go to the table's first row, video work.

import type { Effort } from '../../shared/model/providers.ts';
import { CATEGORIES } from '../models/priors.ts';

export type Category = (typeof CATEGORIES)[number];

/**
 * Keyword groups per category. `words` match whole words, `prefixes` match at a word start
 * ("termin" → "Termine", not "determine"), `parts` match anywhere (German compounds such as
 * "Musikvideo", "Buchhaltungssoftware"; a RegExp part is used as is). Weight 3 = specific;
 * weight 1 = generic: two different ones needed – one generic word repeated is no second hint.
 * B-083 D6: a word that names what the work is about (a medium: video, animation, podcast) is one hint however often
 * and in whatever form it appears (`max: 1`); the work itself is named by a craft word beside it.
 */
interface KeywordGroup { category: Category; weight: number; max?: number; words?: string[]; prefixes?: string[]; parts?: Array<string | RegExp> }

const GROUPS: KeywordGroup[] = [
  { category: 'video-animation', weight: 3, parts: ['remotion', 'after effects', 'premiere pro', 'davinci', 'keyframe', 'b-roll', 'footage', 'motion canvas', 'videoschnitt', 'untertitel', 'subtitles'] },
  // "Schneide den Podcast", "Cut the video": cutting ("zusammenschneiden") and a podcast together are video work –
  // every form of "schneiden" is one hint, the name or trade "Schneider" none; a clipboard is no clip.
  { category: 'video-animation', weight: 1, parts: ['animier', 'animate', /schneid(?!er)/, /(?<![\p{L}\p{N}])clip(?!board)/u, 'thumbnail'], prefixes: ['render', 'schnitt', 'intro', 'outro', 'timeline', 'blender'], words: ['reel', 'reels', 'cut', 'cuts', 'cutting'] },
  // D6: a word that names a medium says what the work is about – one hint however often it appears; video work needs a
  // craft hint beside it (or a specific craft word above).
  { category: 'video-animation', weight: 1, max: 1, parts: ['video', 'animation', 'podcast'] },
  { category: 'frontend-ui', weight: 3, parts: ['frontend', 'front-end', 'landingpage', 'landing page', 'tailwind', 'figma', 'benutzeroberfläche', 'user interface'], words: ['css', 'html', 'ui/ux'] },
  { category: 'frontend-ui', weight: 1, parts: ['website', 'webseite', 'homepage', 'komponente', 'design system', 'dark mode', 'responsive'], words: ['ui', 'ux', 'layout', 'component', 'components'] },
  { category: 'computer-use', weight: 3, parts: ['bildschirm', 'formular ausfüll', 'fill in the form', 'fill out the form', 'on my screen', 'on the screen', 'desktop app'], words: ['click', 'klick', 'klicke', 'mouse', 'maus', 'screenshot'] },
  { category: 'computer-use', weight: 1, parts: ['open the app', 'öffne die app'], words: ['browser', 'fenster', 'window', 'einloggen', 'log in', 'login'] },
  { category: 'research', weight: 3, prefixes: ['recherch', 'research'], parts: ['marktanalyse', 'market analysis'], words: ['literature', 'study', 'studies', 'studie', 'studien', 'sources', 'quellen'] },
  { category: 'research', weight: 1, prefixes: ['compar', 'vergleich', 'analys', 'analyz', 'untersuch', 'investigat'], parts: ['find out', 'finde heraus'], words: ['benchmark'] },
  { category: 'writing', weight: 3, parts: ['blogpost', 'blog post', 'artikel', 'essay', 'drehbuch', 'newsletter', 'ghostwrit', 'copywrit', 'storytelling'] },
  { category: 'writing', weight: 1, prefixes: ['write', 'writing', 'schreib', 'formulier', 'entwurf', 'draft', 'proofread', 'korrektur'], words: ['script', 'skript', 'text'] },
  { category: 'social-media', weight: 3, parts: ['instagram', 'tiktok', 'linkedin', 'twitter', 'social media', 'hashtag', 'caption'], words: ['x.com', 'threads'] },
  { category: 'social-media', weight: 1, prefixes: ['kommentar'], words: ['follower', 'followers', 'post', 'posts', 'posting', 'story', 'stories', 'comment', 'comments', 'community'] },
  { category: 'business-workflows', weight: 3, prefixes: ['rechnung'], parts: ['buchhaltung', 'bookkeeping', 'accounting', 'datev', 'lexoffice', 'bilanz', 'balance sheet', 'invoice', 'steuererklärung'], words: ['tax', 'taxes'] },
  { category: 'business-workflows', weight: 1, prefixes: ['steuer'], parts: ['spreadsheet', 'excel', 'tabelle', 'budget', 'finanz', 'finance', 'revenue', 'umsatz', 'payroll', 'vertrag'], words: ['angebot', 'quote', 'contract'] },
  { category: 'personal-assistant', weight: 3, prefixes: ['termin', 'erinner', 'besorg'], parts: ['kalender', 'calendar', 'appointment', 'remind me', 'errand', 'reservation', 'reservier'] },
  { category: 'personal-assistant', weight: 1, prefixes: ['flug', 'buche'], parts: ['postfach', 'book a'], words: ['email', 'e-mail', 'mail', 'inbox', 'meeting', 'flight', 'hotel', 'doctor', 'arzt'] },
  { category: 'coding', weight: 3, parts: ['typescript', 'javascript', 'python', 'golang', 'stacktrace', 'stack trace', 'refactor', 'unit test', 'pull request', 'compile', 'repository', 'bugfix', 'bug fix', 'programmier'], words: ['rust', 'git', 'npm'] },
  { category: 'coding', weight: 1, parts: ['exception', 'database', 'datenbank'], words: ['code', 'coding', 'api', 'bug', 'bugs', 'debug', 'function', 'sql', 'endpoint'] },
  { category: 'manager-planner', weight: 3, prefixes: ['delegat', 'delegier', 'roadmap', 'strateg', 'prioriti', 'priorisier'], parts: ['hire an agent', 'org chart', 'organigramm'] },
  { category: 'manager-planner', weight: 1, words: ['plan', 'plans', 'planning', 'planung', 'team', 'milestone', 'milestones', 'meilenstein', 'organize', 'organise', 'organisieren'] },
  { category: 'cheap-chat', weight: 3, prefixes: ['summari', 'zusammenfass', 'extract', 'extrahier'], words: ['tl;dr', 'tldr', 'kurzfassung'] },
];

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const LETTER_BEFORE = String.raw`(?<![\p{L}\p{N}])`;
const LETTER_AFTER = String.raw`(?![\p{L}\p{N}])`;

const KEYWORDS: Array<{ category: Category; weight: number; max?: number; pattern: RegExp }> = GROUPS.map((group) => {
  const alternatives: string[] = [];
  if (group.words?.length) alternatives.push(`${LETTER_BEFORE}(?:${group.words.map(escape).join('|')})${LETTER_AFTER}`);
  if (group.prefixes?.length) alternatives.push(`${LETTER_BEFORE}(?:${group.prefixes.map(escape).join('|')})`);
  if (group.parts?.length) alternatives.push(`(?:${group.parts.map((part) => typeof part === 'string' ? escape(part) : part.source).join('|')})`);
  return { category: group.category, weight: group.weight, max: group.max, pattern: new RegExp(alternatives.join('|'), 'gu') };
});

const MIN_SCORE = 2;
const MAX_HITS_PER_GROUP = 3;

/** Most likely category from free text, or undefined when nothing clearly matches. */
export function inferCategory(text: string | undefined): Category | undefined {
  if (!text || !text.trim()) return undefined;
  const value = text.slice(-4000).toLowerCase();
  const scores = new Map<Category, number>();
  for (const { category, weight, max, pattern } of KEYWORDS) {
    const matches = value.match(pattern) ?? [];
    // A generic keyword counts once ("Podcast … Podcast", "schneiden … zuschneiden" is one hint).
    const hits = weight === 1 ? new Set(matches).size : matches.length;
    if (hits) scores.set(category, (scores.get(category) ?? 0) + weight * Math.min(hits, max ?? MAX_HITS_PER_GROUP));
  }
  const [best, second] = [...scores].sort((a, b) => b[1] - a[1]);
  // Equal scores name no kind – the table's order is no judgement (it made every tie video work).
  return best && best[1] >= MIN_SCORE && !(second && second[1] === best[1]) ? best[0] : undefined;
}

/** True for known category names (mode files and tools use exactly these strings). */
export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

/** Mode categories that the turn's text refines (B-047 D12: the manager mode no longer labels every turn planning). */
export const REFINED_CATEGORIES: ReadonlySet<string> = new Set(['chat', 'manager-planner']);

/**
 * The category of a turn: a specific mode category wins; the generic 'chat' (general mode) and the
 * manager mode's 'manager-planner' are refined by keyword inference from the text – what the turn is asked (B-080:
 * the person's newest line, else the task, agents/turn-prepare.ts); otherwise 'chat'. Without any text a refined
 * mode keeps its own category.
 */
export function resolveCategory(modeCategory: string | undefined, text: string | undefined): string {
  if (modeCategory && isCategory(modeCategory) && !REFINED_CATEGORIES.has(modeCategory)) return modeCategory;
  if (modeCategory === 'manager-planner' && text === undefined) return modeCategory;
  return inferCategory(text) ?? 'chat';
}

/** Default effort when neither policy nor chat chose one: hard creative/planning work high, helpers low. */
export function defaultEffortFor(category: string): Effort {
  if (category === 'video-animation' || category === 'manager-planner') return 'high';
  if (category === 'cheap-chat' || category === 'decision' || category === 'embeddings') return 'low';
  return 'medium';
}

/** "video-animation" → "video animation" (for short route reasons). */
export function categoryLabel(category: string): string {
  return category.replace(/-/g, ' ');
}
