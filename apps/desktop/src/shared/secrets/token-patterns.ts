// Keys and tokens that show what they are by their shape: a typed prefix and generated characters – sk-/pk-/rk- keys
// (OpenAI, Anthropic, OpenRouter), Stripe's sk_/rk_ keys, GitHub, Slack, AWS and Google keys, JWTs, the credential after
// Bearer or Basic and a PEM private key. The feedback redactor (runtime/feedback/redact.ts) replaces every match by its
// `mark`; chat (owner 16.11.2026: "dass irgendwie sogar Token erkennt") takes a match that also looks generated – 16
// characters or more, letters and digits (a private key always) – as a key someone pasted, by the stricter `chat`
// shape where a pattern has one (a stored value is masked for agents everywhere, so a branch name or "basic
// example.com/…" is none): runtime/secrets/text-capture.ts saves it in the secrets catalog, ui/chat/message-keys.ts
// shows one still standing in a message masked. A key inside an ```app fence belongs to that app's page (a web key
// like Google's is public there, and the page needs it as written; appRanges), and a secret:// handle is stored
// already (inHandle).
// Owns: the patterns, findKeys, appRanges, inHandle, maskKey and handleCount. Never: prose rules ("password: x" – the
// word after "password" is no key by its shape; feedback/redact.ts keeps that rule for reports).

export type KeyKind = 'api_key' | 'token' | 'note';
/** `chat`: the shape a pasted key has in chat where it is stricter than the report redactor's `pattern`. */
export interface KeyPattern { pattern: RegExp; chat?: RegExp; name: string; kind: KeyKind; mark: string }

/** In this order for the feedback redactor (a private key first, then the prefixed keys, the JWT, the Bearer credential). */
export const KEY_PATTERNS: readonly KeyPattern[] = [
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, name: 'Private key', kind: 'note', mark: '[private key]' },
  {
    pattern: /\b(?:sk|pk|rk)-(?:proj-|live-|test-|ant-(?:api\d+-)?|or-v1-)?[A-Za-z0-9_-]{16,}/g,
    chat: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{32,}/g, name: 'API key', kind: 'api_key', mark: '[key]',
  },
  { pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, name: 'Stripe key', kind: 'api_key', mark: '[key]' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, name: 'GitHub token', kind: 'token', mark: '[token]' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, name: 'GitHub token', kind: 'token', mark: '[token]' },
  { pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, name: 'Slack token', kind: 'token', mark: '[token]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, name: 'AWS key', kind: 'api_key', mark: '[key]' },
  { pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g, name: 'Google API key', kind: 'api_key', mark: '[key]' },
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, name: 'Token', kind: 'token', mark: '[token]' },
  {
    pattern: /(?<=\b(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
    chat: /(?<=\bBearer[ \t]+)[A-Za-z0-9._~+/=-]{20,}|(?<=\bBasic[ \t]+)[A-Za-z0-9+/]{16,}={0,2}(?![\w-])/g, name: 'Token', kind: 'token', mark: '[token]',
  },
];

/** A key in a text: where it stands, the value, and what the pattern calls it. */
export interface FoundKey { start: number; end: number; value: string; name: string; kind: KeyKind }

const MIN_KEY = 16;
const GENERATED = (value: string) => /\d/.test(value) && /[A-Za-z]/.test(value);
const HANDLE_BEFORE = /secret:\/\/[A-Za-z0-9_-]*$/;
const HANDLE = /secret:\/\/[A-Za-z0-9_-]{1,128}/g;
/** An ```app (or ```wf-app) fence up to its closing fence, or to the end while it is still open. */
const APP_FENCE = /(`{3,}|~{3,})[ \t]*(?:wf-)?app\b[\s\S]*?(?:\1|$)/g;

/** Where each ```app fence of `text` stands, [from, to): an app's own text, which chat leaves as written. */
export function appRanges(text: string): Array<[number, number]> {
  return [...text.matchAll(APP_FENCE)].map((match): [number, number] => [match.index ?? 0, (match.index ?? 0) + match[0].length]);
}

/** Whether `value` is (a piece of) a secret:// handle in `text` – an id stored already, never a value. */
export function inHandle(text: string, value: string): boolean {
  if (!value) return false;
  if (value.includes('secret://')) return true;
  const handles = [...text.matchAll(HANDLE)].map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length]);
  for (let at = text.indexOf(value); at >= 0; at = text.indexOf(value, at + 1)) {
    if (handles.some(([from, to]) => at < to && at + value.length > from)) return true;
  }
  return false;
}

/** The keys in `text` in reading order (overlaps: the first, then the longest); a handle's id and an app's own key are never one. */
export function findKeys(text: string): FoundKey[] {
  if (!text) return [];
  const apps = appRanges(text);
  const all: FoundKey[] = [];
  for (const { pattern, chat, name, kind } of KEY_PATTERNS) {
    for (const match of text.matchAll(chat ?? pattern)) {
      const value = match[0];
      const start = match.index ?? 0;
      if (value.length < MIN_KEY || (kind !== 'note' && !GENERATED(value)) || HANDLE_BEFORE.test(text.slice(Math.max(0, start - 140), start))) continue;
      if (apps.some(([from, to]) => start >= from && start < to)) continue;
      all.push({ start, end: start + value.length, value, name, kind });
    }
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const keys: FoundKey[] = [];
  for (const key of all) if (!keys.length || key.start >= keys[keys.length - 1].end) keys.push(key);
  return keys;
}

/** A key as it shows before someone asks to see it: its first characters and dots (a private key by its name). */
export function maskKey(key: Pick<FoundKey, 'value' | 'kind'>): string {
  return `${key.kind === 'note' ? 'PRIVATE KEY ' : key.value.slice(0, 4)}••••••••`;
}

/** How many secret handles (`secret://<id>`) a text holds. */
export function handleCount(text: string): number {
  return text.match(HANDLE)?.length ?? 0;
}
