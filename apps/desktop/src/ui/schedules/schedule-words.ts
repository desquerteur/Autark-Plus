// #20: a schedule said in plain words ("every weekday at 7:30 summarise the news", "morgen um 9 an den Zahnarzt
// erinnern", "alle 2 Stunden", "mondays and fridays at 18:00") → the form's WHEN fields, plus what is left of the
// sentence (the agent's instructions / the message). English and German, deterministic, no model call: what it
// cannot read it leaves alone, and the form shows the result so the person checks it before saving.
// Owns: that reading. Never: builds specs (schedule-form.ts), RPC, DOM or the clock (`now` is passed in).

import type { EveryUnit, ScheduleForm } from '../chat/composer/schedule-form.ts';
import { atWallTime, nextDate, wallClock } from '../chat/composer/schedule-clock.ts';

export interface WordsResult {
  /** The fields the words set (merge them into the form). */
  form: Partial<ScheduleForm>;
  /** The sentence without its time words – the instructions or message ('' when nothing is left). */
  rest: string;
}

const MIN = 60_000;
const ALL = [0, 1, 2, 3, 4, 5, 6];
const two = (value: number): string => String(value).padStart(2, '0');

// Weekday words → 0 (Sunday) … 6, English and German, singular and plural ("monday", "mondays", "montag", "montags").
const DAY_WORDS: Array<[string, number]> = [
  ['sundays?|sun|sonntags?', 0], ['mondays?|mon|montags?', 1], ['tuesdays?|tues?|dienstags?', 2], ['wednesdays?|wed|mittwochs?', 3],
  ['thursdays?|thurs?|thu|donnerstags?', 4], ['fridays?|fri|freitags?', 5], ['saturdays?|sat|samstags?|sonnabends?', 6],
];
// The short German forms (mo, di, do, …) are common words too ("do" in English): only read in a range ("Mo-Fr").
const SHORT_DAYS: Array<[string, number]> = [['so', 0], ['mo', 1], ['di', 2], ['mi', 3], ['do', 4], ['fr', 5], ['sa', 6]];
const ANY_DAY = [...DAY_WORDS, ...SHORT_DAYS].map(([words]) => words).join('|');
const PLURAL_DAYS = /\b(?:sun|mon|tues|wednes|thurs|fri|satur)days\b|\b(?:sonn|mon|diens|donners|frei|sams)tags\b|\bmittwochs\b/;
const UNIT = '(m|mins?|minutes?|minuten?|h|hrs?|hours?|std|stunden?|days?|tagen?|tage|weeks?|wochen?)';

const UNIT_WORDS: Array<[RegExp, EveryUnit]> = [
  [/^(?:m|mins?|minutes?|minuten?)$/, 'minutes'],
  [/^(?:h|hrs?|hours?|std|stunden?)$/, 'hours'],
  [/^(?:days?|tage?n?)$/, 'days'],
  [/^(?:weeks?|wochen?)$/, 'weeks'],
];
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, other: 2, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, fifteen: 15, twenty: 20, thirty: 30,
  ein: 1, eine: 1, einer: 1, einem: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, zehn: 10, 'fünfzehn': 15, zwanzig: 20, 'dreißig': 30,
};

function unitOf(word: string): EveryUnit | undefined {
  for (const [pattern, unit] of UNIT_WORDS) if (pattern.test(word)) return unit;
  return undefined;
}

function countOf(word: string | undefined): number | undefined {
  if (!word) return 1;
  if (/^\d+$/.test(word)) return Number(word) || undefined;
  return NUMBER_WORDS[word];
}

/** The sentence being read: matches are cut out of the lower-cased work copy and the original at the same place. */
class Sentence {
  original: string;
  work: string;
  constructor(original: string) {
    this.original = original;
    this.work = original.toLowerCase();
  }
  /** Remove the first match (only when `accept` agrees) and return it. */
  take(pattern: RegExp, accept: (match: RegExpExecArray) => boolean = () => true): RegExpExecArray | undefined {
    const match = pattern.exec(this.work);
    if (!match || !accept(match)) return undefined;
    const cut = (text: string) => `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
    this.work = cut(this.work);
    this.original = cut(this.original);
    return match;
  }
  has(pattern: RegExp): boolean {
    return pattern.test(this.work);
  }
  rest(): string {
    return this.original
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/^[\s,.;:–-]+|[\s,;:–-]+$/g, '')
      .replace(/^(?:and|und|then|dann|,)\s+/i, '')
      .trim();
  }
}

/** A clock time in the sentence: "at 7", "at 7:30", "7am", "7.30 pm", "um 9 Uhr", "18:00", "noon", "abends um 7". */
function takeClock(s: Sentence): string | undefined {
  const named = s.take(/\b(?:at\s+|um\s+)?(noon|midday|mittags?|midnight|mitternacht)\b/);
  if (named) return /^(?:noon|midday|mittag)/.test(named[1]) ? '12:00' : '00:00';
  const patterns = [
    /(?:\bat|\bum|\bgegen|@)\s*(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|uhr)?(?![\d.:]|\s*(?:min|h\b|hrs?\b|hours?|std|stunde|tage?|days?|weeks?|wochen?))/,
    /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|uhr)(?![a-z])/,
    /\b(\d{1,2}):(\d{2})()\b/,
  ];
  for (const pattern of patterns) {
    const match = s.take(pattern, (m) => Number(m[1]) <= 23 && Number(m[2] ?? 0) <= 59);
    if (!match) continue;
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    const suffix = (match[3] ?? '').replace(/\./g, '');
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
    const later = s.take(/\b(?:in the evening|in the afternoon|evenings?|afternoons?|tonight|abends?|nachmittags?)\b/);
    if (later && hour < 12 && suffix !== 'am') hour += 12;
    if (!later) s.take(/\b(?:in the morning|mornings?|morgens|früh|vormittags?)\b/);
    return `${two(hour)}:${two(minute)}`;
  }
  // Only a part of the day: morning 08:00, afternoon 15:00, evening 19:00.
  const part = s.take(/\b(?:in the |every |each |jeden )?(mornings?|morgens|früh|afternoons?|nachmittags?|evenings?|abends?|tonight)\b/);
  if (part) return /morning|morgens|früh/.test(part[1]) ? '08:00' : /afternoon|nachmittag/.test(part[1]) ? '15:00' : '19:00';
  return undefined;
}

/** Weekdays named in the sentence: "weekdays", "weekends", "mon-fri", "Mo–Fr", "montags bis freitags", "mondays and fridays". */
function takeDays(s: Sentence): number[] | undefined {
  if (s.take(/\b(?:on\s+)?(?:every weekday|weekdays|werktags|wochentags|an werktagen|unter der woche|work ?days)\b/)) return [1, 2, 3, 4, 5];
  if (s.take(/\b(?:on\s+|at\s+|am\s+)?(?:weekends?|the weekend|wochenende)\b/)) return [0, 6];
  const range = s.take(new RegExp(`\\b(?:from\\s+|von\\s+)?(${ANY_DAY})\\.?\\s*(?:-|–|to|through|thru|until|bis)\\s*(${ANY_DAY})\\b\\.?`));
  if (range) {
    const to = dayOf(range[2]);
    const days: number[] = [];
    for (let day = dayOf(range[1]); ; day = (day + 1) % 7) { days.push(day); if (day === to || days.length === 7) break; }
    return days.sort();
  }
  const found = new Set<number>();
  for (const [words, day] of DAY_WORDS) {
    while (s.take(new RegExp(`(?:\\b(?:on|every|each|jeden|jedem|am|an)\\s+)?\\b(?:${words})\\b(?:\\s*(?:,|and|und|&)\\s*)?`))) found.add(day);
  }
  return found.size ? [...found].sort() : undefined;
}

function dayOf(word: string): number {
  for (const [words, day] of [...DAY_WORDS, ...SHORT_DAYS]) if (new RegExp(`^(?:${words})$`).test(word)) return day;
  return 0;
}

function hm(clock: string): [number, number] {
  const [hour, minute] = clock.split(':').map(Number);
  return [hour, minute];
}

/** The next local date (today or later) on which `clock` has not passed yet. */
function nextAt(today: string, clock: string, now: number, tz: string): string {
  return atWallTime(today, ...hm(clock), tz) > now ? today : nextDate(today);
}

/** "24.12.", "24.12.2026", "2026-12-24" → YYYY-MM-DD; a day-month that has passed means next year. */
function dateOf(match: RegExpExecArray, today: string): string {
  if (match[4]) return `${match[4]}-${match[5]}-${match[6]}`;
  let year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : Number(today.slice(0, 4));
  const date = (y: number) => `${y}-${two(Number(match[2]))}-${two(Number(match[1]))}`;
  if (!match[3] && date(year) < today) year += 1;
  return date(year);
}

/** Read `text` against the form `base` at `now`. Undefined when no time words were found. */
export function readScheduleWords(text: string, base: ScheduleForm, now: number): WordsResult | undefined {
  const s = new Sentence(text.trim());
  const tz = base.tz;
  const today = wallClock(now, tz);

  // ---- a day of the month: "every month on the 1st", "monthly on the 15th at 9", "monatlich am 1.", "jeden Monat am 15. um 8"
  //      → a cron rule (the form's Advanced); without a day the 1st
  const monthly = s.take(/\b(?:monthly|every month|each month|monatlich|jeden monat|jedes monats|im monat)\b/);
  if (monthly) {
    const day = s.take(/(?:\b(?:on\s+the|on|the|am|zum)\s+)?\b([1-9]|[12]\d|3[01])(?:st|nd|rd|th|\.)(?![\d.])/);
    const [hour, minute] = hm(takeClock(s) ?? base.clock);
    return { form: { kind: 'repeat', repeat: 'cron', cron: `${minute} ${hour} ${day ? Number(day[1]) : 1} * *` }, rest: s.rest() };
  }

  // ---- intervals: "every 30 minutes", "alle 2 Stunden", "every other day", "hourly", "stündlich"
  const hourly = s.take(/\b(?:hourly|stündlich|every hour|jede stunde)\b/);
  const every = hourly ? undefined : s.take(new RegExp(`\\b(?:every|each|alle|jede[nrs]?)\\s+(?:(\\d+)\\s*|([a-zäöüß]+)\\s+)?${UNIT}\\b`),
    (m) => !!countOf(m[1] ?? m[2]) && !!unitOf(m[3]));
  if (hourly || every) {
    const unit = hourly ? 'hours' : unitOf(every![3])!;
    const count = hourly ? 1 : countOf(every![1] ?? every![2])!;
    const days = takeDays(s);
    const clock = takeClock(s);
    // "every day at 7" and "every week on monday" are day rules, not intervals
    if (count === 1 && (unit === 'days' || (unit === 'weeks' && days))) {
      return { form: { kind: 'repeat', repeat: 'days', days: days ?? ALL, clock: clock ?? base.clock }, rest: s.rest() };
    }
    const form: Partial<ScheduleForm> = { kind: 'repeat', repeat: 'every', every: String(count), unit };
    if (clock) form.start = `${nextAt(today.date, clock, now, tz)}T${clock}`;
    return { form, rest: s.rest() };
  }

  // ---- once, from now: "in 2 hours", "in 30 min", "in drei Tagen"
  const after = s.take(new RegExp(`\\b(?:in|nach|after)\\s+(?:(\\d+)\\s*|([a-zäöüß]+)\\s+)${UNIT}\\b`),
    (m) => !!countOf(m[1] ?? m[2]) && !!unitOf(m[3]));
  if (after) {
    const unit = unitOf(after[3])!;
    const count = countOf(after[1] ?? after[2])!;
    const step = { minutes: MIN, hours: 60 * MIN, days: 1440 * MIN, weeks: 10_080 * MIN }[unit];
    const at = wallClock(Math.ceil((now + count * step) / MIN) * MIN, tz);
    const clock = unit === 'days' || unit === 'weeks' ? takeClock(s) : undefined;
    return { form: { kind: 'once', date: at.date, time: clock ?? `${two(at.hour)}:${two(at.minute)}` }, rest: s.rest() };
  }

  // ---- once on a day: "tomorrow at 9", "morgen um 9", "übermorgen", "today 18:00", "heute Abend", "am 24.12. um 10"
  const tomorrow = s.take(/(?<![a-zäöüß])(?:the day after tomorrow|übermorgen|tomorrow|morgen)(?![a-zäöüß])/);
  const todayWord = tomorrow ? undefined : s.take(/\b(?:today|heute)\b/);
  const dated = tomorrow || todayWord ? undefined : s.take(/\b(?:on\s+|am\s+)?(\d{1,2})\.\s?(\d{1,2})\.(\d{4}|\d{2})?|\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (tomorrow || todayWord || dated) {
    let date = today.date;
    if (tomorrow) date = /day after|übermorgen/.test(tomorrow[0]) ? nextDate(nextDate(date)) : nextDate(date);
    if (dated) date = dateOf(dated, today.date);
    const clock = takeClock(s) ?? (todayWord ? base.time : '09:00');
    return { form: { kind: 'once', date, time: clock }, rest: s.rest() };
  }

  // ---- days at a time: "every day at 7", "täglich um 6", "mondays at 18:00"; "on monday at 9" is one Monday
  const daily = s.take(/\b(?:every ?day|each day|daily|täglich|jeden tag|alle tage)\b/);
  const repeating = !!daily || s.has(/\b(?:every|each|jeden|jedem|immer)\b/) || s.has(PLURAL_DAYS);
  const days = daily ? undefined : takeDays(s);
  const clock = takeClock(s);
  if (!daily && !days && !clock) return undefined;
  s.take(/\b(?:every|each|jeden|jedem|immer)\b/);
  if (!repeating && days?.length === 1) {
    const at = clock ?? '09:00';
    let date = nextAt(today.date, at, now, tz);
    while (new Date(`${date}T12:00:00Z`).getUTCDay() !== days[0]) date = nextDate(date);
    return { form: { kind: 'once', date, time: at }, rest: s.rest() };
  }
  if (daily || days || repeating) {
    return { form: { kind: 'repeat', repeat: 'days', days: days ?? ALL, clock: clock ?? base.clock }, rest: s.rest() };
  }
  // just a time: the next time the clock shows it, once
  return { form: { kind: 'once', date: nextAt(today.date, clock!, now, tz), time: clock! }, rest: s.rest() };
}
