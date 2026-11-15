// Sharing one of my skills or notes in the public library (B-078 D13, owner 06.11.2026: "wenn die KI sich sicher ist …
// wenn in irgendeinem Textdokument nichts wirklich Internes drinsteht, kann das gerne geteilt werden"; 14.11.2026: no
// sign-in, library/hub.ts): the setting library.publish (default on) lets it happen; the text goes out only when the
// secrets redaction changes nothing in it, no path, e-mail address or host of this PC is in it, and the decision model
// finds no person, company, customer, path or account name. The server refuses key-like text once more. What is shared
// is CC0 – free for everyone.
// Owns: the checks and their order. Never: publishes past a failed check.

import type { PublishInput, PublishResult } from '../../shared/model/library.ts';
import { libraryUrl } from './hub.ts';
import type { StructuredRunner } from '../decision/types.ts';
import { skillSlug } from '../skills/import-text.ts';
import { parseFrontMatter } from '../skills/frontmatter.ts';
import { fallbackDescription } from '../../shared/text/external.ts';

const CHECK_MS = 90_000;
const MAX_TEXT = 60_000;

export interface PublishDeps {
  /** settings.json library.publish (default true). */
  enabled: () => boolean;
  redact: (text: string) => string;
  /** The decision model; undefined = none connected. */
  check?: StructuredRunner;
  share: (entry: { kind: PublishInput['kind']; name: string; description: string; body: string }) => Promise<{ id: string; rev: string }>;
}

/**
 * What gives a text away as this PC's or a person's own, without a model: a drive, home (also after a backtick, quote
 * or bracket), ~/ or UNC path, an e-mail address, a private address.
 */
const LOCAL = /\b[A-Za-z]:[\\/][^\s]*|(?:^|[\s`'"(\[])\/(?:Users|home)\/[^\s/]+|(?:^|[\s`'"(\[])~\/[^\s]+|\\\\[^\s\\]+\\|\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b|\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b|\blocalhost:\d+/;

const CHECK_SYSTEM = [
  'I check a text before it goes into a public library that anyone on the internet reads.',
  'I look for what is internal: names of people, companies, customers or projects that are not public, account names or IDs, file paths of a PC, internal hosts and URLs, prices, figures or plans of a business.',
  'Public tools, programming languages, libraries, well-known products and public websites are fine.',
  'I answer as JSON: internal (true when anything internal is in it) and found (each internal detail, a few words each).',
].join('\n');
const CHECK_SCHEMA = { type: 'object', additionalProperties: false, required: ['internal', 'found'], properties: { internal: { type: 'boolean' }, found: { type: 'array', items: { type: 'string' } } } };

/** Runs every check and, when all pass, shares the entry. Never throws. */
export async function publishEntry(input: PublishInput, deps: PublishDeps): Promise<PublishResult> {
  let enabled = true;
  try { enabled = deps.enabled(); } catch { enabled = true; }
  if (!enabled) return { ok: false, reason: 'off', text: 'Sharing in the public library is off on this PC (settings.json library.publish), so what I wrote stays here.' };
  const name = skillSlug(input.name);
  if (!name) return { ok: false, reason: 'failed', text: 'The entry needs a name of lowercase words joined by hyphens.' };
  const { data, body } = parseFrontMatter(input.text);
  const description = (typeof data.description === 'string' && data.description.trim()) || fallbackDescription(body);
  const text = `${name}\n${description}\n${body}`; // the name and description are public too: checked with the text
  if (body.length > MAX_TEXT) return { ok: false, reason: 'failed', text: `The text is longer than ${MAX_TEXT} characters; I share a shorter one.` };
  if (deps.redact(text) !== text) return { ok: false, reason: 'secret', text: 'Not shared: the text holds a stored secret value. I write it out before anything goes public.' };
  const local = LOCAL.exec(text);
  if (local) return { ok: false, reason: 'internal', text: `Not shared: "${local[0].trim().slice(0, 80)}" belongs to this PC or a person. I write such details out, then share again.` };
  if (!deps.check) return { ok: false, reason: 'no-check', text: 'Not shared: no model is connected to check the text for internal names, so it stays here for now.' };
  try {
    const reply = await deps.check({ purpose: 'library-check', system: CHECK_SYSTEM, prompt: text, schema: CHECK_SCHEMA, signal: AbortSignal.timeout(CHECK_MS), deadlineMs: CHECK_MS });
    const verdict = (reply.structured ?? JSON.parse(/\{[\s\S]*\}/.exec(reply.text)?.[0] ?? '{}')) as { internal?: unknown; found?: unknown };
    if (typeof verdict.internal !== 'boolean') return { ok: false, reason: 'no-check', text: 'Not shared: the check gave no clear answer, so the text stays here for now.' };
    const found = Array.isArray(verdict.found) ? verdict.found.filter((item): item is string => typeof item === 'string').slice(0, 8) : [];
    if (verdict.internal) return { ok: false, reason: 'internal', text: `Not shared: the check found internal details (${found.join('; ') || 'not named'}). I write them out, then share again – or keep it here.` };
  } catch (error) {
    return { ok: false, reason: 'no-check', text: `Not shared: the check did not answer (${(error as Error).message}).` };
  }
  try {
    const shared = await deps.share({ kind: input.kind, name, description: description.slice(0, 1024), body });
    return { ok: true, id: shared.id, rev: shared.rev, url: `${libraryUrl()}/get/${shared.id}` };
  } catch (error) {
    return { ok: false, reason: 'failed', text: `Not shared: ${(error as Error).message}` };
  }
}
