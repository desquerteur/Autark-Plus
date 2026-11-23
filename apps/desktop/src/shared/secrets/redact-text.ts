// Redaction for anything that leaves a device in a feedback report (the PC's sealed letter, and since 18.11.2026 a phone's own).
// Owns: generic secret/PII patterns (passwords in text, signed URL parameters, e-mail addresses, user names in
// home-folder paths, card numbers); the typed keys and tokens (private keys, sk-/gh*_ keys, JWTs, Bearer …) are the
// shared list in shared/secrets/token-patterns.ts, which chat uses to find pasted keys.
// Never: replaces the vault's exact-value redaction (SecretService.redact runs first) – this
// is the safety net for secrets the vault never saw.

import { KEY_PATTERNS } from './token-patterns.ts';

type Replacement = string | ((match: string) => string);

const RULES: Array<[RegExp, Replacement]> = [
  ...KEY_PATTERNS.map(({ pattern, mark }): [RegExp, Replacement] => [pattern, mark]),
  [/\b(password|passwd|pwd|passwort|kennwort|secret|token|api[_-]?key|apikey|authorization|client[_-]?secret)(\s*[:=](?!\/\/)\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1$2[redacted]'],
  [/([?&#](?:token|key|secret|sig|signature|code|access_token|refresh_token|id_token|auth|password)=)[^&\s#]+/gi, '$1[redacted]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
  [/\b([A-Za-z]:\\(?:Users|Dokumente und Einstellungen|Documents and Settings)\\)[^\\\s"'<>|]+/gi, '$1[user]'],
  [/(\/(?:Users|home)\/)[^/\s"'<>]+/g, '$1[user]'],
  [/\b(?:\d[ -]?){13,19}\b/g, (match: string) => (luhn(match.replace(/\D/g, '')) ? '[card]' : match)],
];

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Applies every pattern; idempotent (redacted output stays the same when redacted again). */
export function redactText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) {
    out = typeof replacement === 'function' ? out.replace(pattern, replacement) : out.replace(pattern, replacement);
  }
  return out;
}
