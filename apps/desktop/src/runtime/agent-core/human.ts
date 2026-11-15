// HUMAN.md (owner 15.11.2026: "ein Feld … wenn man auf den Agent klickt, dann kann man das als Mensch editieren …
// unten angehängt … wird doch nicht überschrieben … als separate Datei"): the person's own lines to one agent, in its
// folder beside SYSTEM.md, last in its system prompt under "## From <name>" (context/prompt-stable.ts). The person
// writes it on the agent page (agents.setHuman) or as a file; nothing else does – no standard, update or agents.update.
// A hire gets it with the default line in the app's language (agent-core/service.ts created); an agent from before gets
// it once where it is missing (bridge/kontext-1311.ts); a file that is there stays as it is, an emptied one too.
// Owns: the file's path, default line, read and write. Never: rewrites a file that exists (seedHuman), or polls.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { HUMAN_FILE, MAX_HUMAN_MD } from '../../shared/model/agent-core.ts';
import { readText, writeAtomic, type OwnWrites } from '../root/text-doc.ts';
import { agentFolder } from './layout.ts';

/** Read up to this much; the prompt and the page take the first MAX_HUMAN_MD characters. */
const LIMITS = { maxBytes: 64 * 1024, maxChars: 64 * 1024 };

/** The default line a new HUMAN.md starts with, by the app's language (German, else English). */
export function humanDefault(language: string | undefined): string {
  return language?.trim().toLowerCase().startsWith('de')
    ? '„Ich bin kein Roboter“-Prüfungen (CAPTCHAs) löse ich nicht.'
    : 'I don\'t solve "I\'m not a robot" checks (CAPTCHAs).';
}

export const humanFile = (dataDir: string, agentId: string): string => path.join(agentFolder(dataDir, agentId), HUMAN_FILE);

/** HUMAN.md's text, trimmed, at most MAX_HUMAN_MD characters ('' when missing, empty or unreadable). */
export function readHuman(dataDir: string, agentId: string): string {
  try {
    const read = readText(humanFile(dataDir, agentId), LIMITS);
    return read.kind === 'ok' ? read.text.trim().slice(0, MAX_HUMAN_MD).trim() : '';
  } catch { return ''; }
}

/** Writes HUMAN.md as the person gave it (one final line end; '' leaves it empty, so nothing is appended). */
export function writeHuman(dataDir: string, agentId: string, text: string, writes?: OwnWrites): void {
  const body = text.replace(/\r\n?/g, '\n').trim();
  writeAtomic(humanFile(dataDir, agentId), body ? `${body}\n` : '', writes);
}

/** Writes the default line when HUMAN.md is missing; a file that exists is never touched. True when it wrote one. */
export function seedHuman(dataDir: string, agentId: string, language: string | undefined): boolean {
  try {
    writeFileSync(humanFile(dataDir, agentId), `${humanDefault(language)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return true;
  } catch { return false; } // there already, or no folder: nothing to do
}
