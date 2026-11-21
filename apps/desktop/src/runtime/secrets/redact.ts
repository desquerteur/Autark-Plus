// Exact-value redaction: replaces known secret values (and their common encodings) in any text
// with the secret's handle `secret://<id>`. X05: a 2FA setup key is learnt as a `pattern` (any
// case and grouping, totp.ts seedPattern) – never its stored JSON.
// Owns: the in-memory matcher. Never: logs values, matches values shorter than MIN_SECRET_CHARS
// (too many false hits; the UI flags such secrets as "too short for leak detection").

import { findKeys } from '../../shared/secrets/token-patterns.ts';

export const MIN_SECRET_CHARS = 8;

/**
 * 18.11.2026 (a live Stripe key printed by an error text – the third case in two days): what a tool prints is masked by the
 * shape of a key too, not only by the values the vault knows. The mark names the kind and never the value: "‹secret:stripe-live›".
 * Used for a tool's output, the run journal's previews and stored outputs (tools/outputs.ts) and an engine's own calls
 * (agents/turn-attempt.ts). Not for chat messages or app pages (a web key inside an app is public there; secrets.redact leaves them).
 */
export function keyMark(key: { name: string; value: string }): string {
  const value = key.value;
  const slug = key.name === 'Stripe key' ? (/^(?:sk|rk)_live_/.test(value) ? 'stripe-live' : 'stripe-test')
    : key.name === 'Stripe webhook secret' ? 'stripe-webhook'
    : key.name === 'API key' ? (/^sk-ant-/.test(value) ? 'anthropic-key' : /^sk-proj-/.test(value) ? 'openai-key' : 'api-key')
    : key.name === 'GitHub token' ? 'github-token'
    : key.name === 'Slack token' ? 'slack-token'
    : key.name === 'AWS key' ? 'aws-key'
    : key.name === 'Google API key' ? 'google-api-key'
    : key.name === 'Private key' ? 'private-key'
    : key.name === 'Token' ? (/^eyJ/.test(value) ? 'jwt' : 'bearer-token')
    : 'key';
  return `‹secret:${slug}›`;
}

/** `text` with every key that shows itself by its shape replaced by its mark (see keyMark); idempotent. */
export function maskKeyShapes(text: string): string {
  if (!text || text.length < 16) return text;
  const keys = findKeys(text, { apps: false });
  if (!keys.length) return text;
  let out = '';
  let at = 0;
  for (const key of keys) { out += text.slice(at, key.start) + keyMark(key); at = key.end; }
  return out + text.slice(at);
}

export function handleFor(id: string): string {
  return `secret://${id}`;
}

/** All encodings of a value we look for (raw, base64, URL-encoded, hex). */
function variants(value: string): string[] {
  const out = new Set<string>([value]);
  out.add(Buffer.from(value, 'utf8').toString('base64'));
  out.add(Buffer.from(value, 'utf8').toString('base64url'));
  out.add(encodeURIComponent(value));
  out.add(Buffer.from(value, 'utf8').toString('hex'));
  return [...out].filter(variant => variant.length >= MIN_SECRET_CHARS);
}

export class Redactor {
  private byValue = new Map<string, string>(); // variant → secret id
  private ordered: string[] = []; // variants, longest first (prefer the most specific match)
  private patterns = new Map<string, RegExp>(); // secret id → every spelling of a 2FA key (global)

  set(id: string, value: string | undefined, pattern?: RegExp): void {
    this.remove(id);
    if (pattern?.global) this.patterns.set(id, pattern);
    const forms = value && value.length >= MIN_SECRET_CHARS ? variants(value) : [];
    if (!forms.length) return;
    for (const form of forms) this.byValue.set(form, id);
    this.reorder();
  }

  remove(id: string): void {
    this.patterns.delete(id);
    let changed = false;
    for (const [variant, owner] of this.byValue) if (owner === id) { this.byValue.delete(variant); changed = true; }
    if (changed) this.reorder();
  }

  redact(text: string): string {
    if (!text || (this.ordered.length === 0 && this.patterns.size === 0)) return text;
    let out = text;
    for (const [id, pattern] of this.patterns) out = out.replace(pattern, () => handleFor(id));
    for (const variant of this.ordered) {
      if (out.includes(variant)) out = out.split(variant).join(handleFor(this.byValue.get(variant)!));
    }
    return out;
  }

  private reorder(): void {
    this.ordered = [...this.byValue.keys()].sort((a, b) => b.length - a.length);
  }
}
