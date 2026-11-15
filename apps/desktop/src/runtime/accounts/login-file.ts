// What a CLI plan's login file says, read the same way wherever a login is copied: between the CEO's PCs
// (devices/sync/logins.ts) and from a CLI's default home into the account's own home here (takeLogin). The deciding file
// (the first of cli-homes.ts loginFiles) holds the login: whether it can still be refreshed, the token it refreshes with,
// its own time (Codex last_refresh, Claude Code's and Gemini CLI's token expiry, else the file's mtime) and whose it is
// (Codex tokens.account_id, else the id token's subject).
// Owns: these readings and takeLogin's copy. Never: logs, returns or shows a file's content, or writes into the folder it
// takes a login from.

import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProviderId } from '../../shared/model/providers.ts';
import { replaceWithSync } from '../devices/sync/file-io.ts';

export type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

/** A login file larger than this is no login. */
export const MAX_LOGIN_FILE = 256 * 1024;

export function parseLogin(bytes: Buffer): Json | undefined {
  try { const value = JSON.parse(bytes.toString('utf8')) as unknown; return isJson(value) ? value : undefined; } catch { return undefined; }
}

/** Whether the deciding file holds a login the CLI can refresh. */
export function signedIn(provider: string, file: Json): boolean {
  if (provider === 'codex') return Boolean((isJson(file.tokens) && text(file.tokens.refresh_token)) || text(file.OPENAI_API_KEY));
  if (provider === 'claude') return isJson(file.claudeAiOauth) && Boolean(text(file.claudeAiOauth.refreshToken));
  return Boolean(text(file.refresh_token));
}

/** The token the CLI refreshes with; the same one in two homes is one login in two accounts (each refresh ends the other's). */
export function refreshToken(provider: string, file: Json): string | undefined {
  if (provider === 'codex') return isJson(file.tokens) ? text(file.tokens.refresh_token) : undefined;
  if (provider === 'claude') return isJson(file.claudeAiOauth) ? text(file.claudeAiOauth.refreshToken) : undefined;
  return text(file.refresh_token);
}

/** The login's own time, else the file's mtime. */
export function loginTime(provider: string, file: Json, mtime: number): number {
  const at = provider === 'codex' ? Date.parse(String(file.last_refresh ?? ''))
    : provider === 'claude' ? Number(isJson(file.claudeAiOauth) ? file.claudeAiOauth.expiresAt : Number.NaN)
      : Number(file.expiry_date);
  return Number.isFinite(at) && at > 0 ? at : Math.floor(mtime);
}

/** Whose login it is, where the file says so. */
export function identity(provider: string, file: Json): string | undefined {
  if (provider === 'codex') return isJson(file.tokens) ? text(file.tokens.account_id) : undefined;
  const token = text(file.id_token);
  try {
    const claims = token ? JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as unknown : undefined;
    return isJson(claims) ? text(claims.sub) : undefined;
  } catch { return undefined; }
}

/** The deciding login file `name` in `home` with its time (0: no login in it, e.g. emptied); undefined when there is none. */
function loginIn(provider: ProviderId, home: string, name: string): { json: Json; at: number; bytes: Buffer } | undefined {
  const file = path.join(home, name);
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.size > MAX_LOGIN_FILE) return undefined;
    const bytes = readFileSync(file);
    const json = parseLogin(bytes);
    if (!json) return undefined;
    return { json, bytes, at: signedIn(provider, json) ? loginTime(provider, json, info.mtimeMs) : 0 };
  } catch {
    return undefined;
  }
}

/**
 * Copies the login files `names` (the deciding one first) of `from` (a CLI's default home, only read) into `home` when
 * its login is one the CLI can refresh, newer than the one there and – when both say whose they are – the same person's.
 * True when it copied. The files are written whole (a temp file beside them, mode 0600).
 */
export function takeLogin(provider: ProviderId, names: readonly string[], from: string, home: string): boolean {
  if (!names.length || path.resolve(from) === path.resolve(home)) return false;
  const theirs = loginIn(provider, from, names[0]);
  if (!theirs?.at) return false;
  const mine = loginIn(provider, home, names[0]);
  if (mine && mine.at >= theirs.at) return false;
  const who = mine?.at ? identity(provider, mine.json) : undefined;
  const other = identity(provider, theirs.json);
  if (who && other && who !== other) return false;
  mkdirSync(home, { recursive: true });
  for (const [index, name] of names.entries()) {
    const bytes = index === 0 ? theirs.bytes : readSmall(path.join(from, name));
    if (bytes) writeWhole(path.join(home, name), bytes);
  }
  return true;
}

function readSmall(file: string): Buffer | undefined {
  try {
    const info = lstatSync(file);
    return info.isFile() && info.size <= MAX_LOGIN_FILE ? readFileSync(file) : undefined;
  } catch {
    return undefined;
  }
}

function writeWhole(file: string, bytes: Buffer): void {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, bytes, { mode: 0o600 });
    replaceWithSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}
