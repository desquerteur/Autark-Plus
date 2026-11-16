// The settings search's marks on the open page (F20, owner 15.11.2026: "dass irgendwie blau markiert ist, was man gesucht hat
// und übereinstimmt"): the rows that hold every word of two letters or more (.set-row, .set-group-head), their words in blue
// through the CSS Custom Highlight API – 'settings-search', the current row's words stronger as 'settings-search-current' –
// colour only, so the DOM and Preact stay untouched and nothing moves; where the API is missing (an older WebView) the rows
// keep the tint .set-search-hit. Enter goes to the next row that holds them (round again after the last). pageHits tells the
// nav that the open page holds some, so the page stays listed.
// Owns: those marks, the current hit and pageHits. Never: changes text, layout or the DOM tree.

import { signal } from '@preact/signals';
import { markRanges } from '../lib/mark-ranges.ts';

export const SEARCH_ROWS = '.set-row, .set-group-head';
const MARK = 'settings-search';
const CURRENT = 'settings-search-current';
const HIT = 'set-search-hit';

/** How many rows of the open page hold every word of the settings search (0: none, or no page open). */
export const pageHits = signal(0);

const wordsOf = (query: string) => query.toLowerCase().split(/\s+/).filter((word) => word.length >= 2);

/** Whether a row's text holds every word of two letters or more (case-insensitive) – the words markRanges marks. */
export function holdsAll(text: string, query: string): boolean {
  const words = wordsOf(query);
  const lower = text.toLowerCase();
  return words.length > 0 && words.every((word) => lower.includes(word));
}

/** The marks in a row's text pieces (its text nodes in order): [piece, start, end] for each word found in a piece. */
export function pieceRanges(pieces: readonly string[], query: string): Array<[number, number, number]> {
  return pieces.flatMap((piece, index) => markRanges(piece, query).map(([start, end]): [number, number, number] => [index, start, end]));
}

let root: HTMLElement | null = null;
let rows: HTMLElement[] = [];
let current = 0;
let query = '';

const registry = (): HighlightRegistry | undefined =>
  (typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function' ? CSS.highlights : undefined);

/** The ranges of a row's words; `seen` skips text a row around it marked already. */
function rangesOf(row: HTMLElement, seen?: Set<Node>): Range[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (seen?.has(node)) continue;
    seen?.add(node);
    nodes.push(node as Text);
  }
  return pieceRanges(nodes.map((node) => node.data), query).map(([index, start, end]) => {
    const range = document.createRange();
    range.setStart(nodes[index], start);
    range.setEnd(nodes[index], end);
    return range;
  });
}

function paint(): void {
  const marks = registry();
  if (!marks) return;
  const seen = new Set<Node>();
  const all = rows.flatMap((row) => rangesOf(row, seen));
  if (all.length) marks.set(MARK, new Highlight(...all)); else marks.delete(MARK);
  const now = rows[current] ? rangesOf(rows[current]) : [];
  if (!now.length) { marks.delete(CURRENT); return; }
  const strong = new Highlight(...now);
  strong.priority = 1;
  marks.set(CURRENT, strong);
}

/** Marks the rows of `container` that hold every word of `text`; returns the current hit – the first, or the one Enter reached while it still holds them (null: none). */
export function markSearch(container: HTMLElement, text: string): HTMLElement | null {
  root = container;
  query = text.trim();
  const before = rows[current];
  const all = [...container.querySelectorAll<HTMLElement>(SEARCH_ROWS)];
  rows = query ? all.filter((row) => holdsAll(row.textContent ?? '', query)) : [];
  current = Math.max(0, before ? rows.indexOf(before) : 0); // the current hit stays where it still holds the words
  const tint = registry() ? new Set<HTMLElement>() : new Set(rows);
  for (const row of all) row.classList.toggle(HIT, tint.has(row));
  paint();
  pageHits.value = rows.length;
  return rows[current] ?? null;
}

/** Enter: the next row that holds the words, scrolled to the middle; false when the open page holds none. */
export function nextSearchHit(): boolean {
  if (root && rows.some((row) => !row.isConnected)) markSearch(root, query); // the page drew its rows anew
  if (!rows.length) return false;
  current = (current + 1) % rows.length;
  rows[current].scrollIntoView({ block: 'center' });
  paint();
  return true;
}

/** The search emptied or the page went: every mark goes. */
export function clearSearchMarks(container?: HTMLElement | null): void {
  for (const row of (container ?? root)?.querySelectorAll<HTMLElement>(`.${HIT}`) ?? []) row.classList.remove(HIT);
  registry()?.delete(MARK);
  registry()?.delete(CURRENT);
  root = null;
  rows = [];
  current = 0;
  query = '';
  pageHits.value = 0;
}
