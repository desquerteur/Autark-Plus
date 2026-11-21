// Exact-copy skill editing. The library supplies current enumerated entries, never caller paths.
// Owns: revisions, raw frontmatter preservation, fail-closed writes until a safe writer is available.
// Never: edits imported/builtin copies or claims OS compare-and-swap against external writers.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { WorkforceError } from '../../shared/errors.ts';
import type { SkillInfo } from '../../shared/model/knowledge.ts';
import type { SkillDocument } from '../../shared/api/methods-skills.ts';
import { SKILL_EDITOR_WRITE_UNAVAILABLE } from '../../shared/api/methods-skills.ts';

export interface EditableSkill { info: SkillInfo; file: string; readOnly: boolean }
const hash = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
export const skillId = (file: string): string => hash(path.resolve(file));
const conflict = (): never => { throw new WorkforceError('conflict', 'This skill changed or was removed. Keep your text and reopen the skill before saving again.'); };

/** A junction/symlink in the registered root, copy folder or SKILL.md is not an editor target. */
function regular(file: string): void {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || realpathSync(file) !== path.resolve(file)) throw new Error('redirected');
  } catch { throw new WorkforceError('conflict', 'This skill is missing or its file location changed.'); }
}

/** Redirected copies are absent from the settings catalog, not just refused at save time. */
export function isEditorFile(file: string): boolean {
  try { regular(file); return true; } catch { return false; }
}

/** The byte-exact prefix is kept on the host, never round-tripped through the form. */
function parts(raw: string): { head: string; body: string } {
  const head = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw)?.[0] ?? '';
  return { head, body: raw.slice(head.length) };
}

function snapshot(entry: EditableSkill): { document: SkillDocument; head: string } {
  regular(entry.file);
  const bytes = readFileSync(entry.file);
  const stat = lstatSync(entry.file, { bigint: true });
  if (bytes.length > 1_000_000) throw new WorkforceError('bad_request', 'This skill is too large for the settings editor.');
  const raw = bytes.toString('utf8');
  if (!Buffer.from(raw, 'utf8').equals(bytes)) throw new WorkforceError('bad_request', 'This skill is not UTF-8 text.');
  const { head, body } = parts(raw);
  return { head, document: { info: entry.info, body, readOnly: true, readOnlyReason: entry.readOnly
    ? 'Built-in and imported skills are read-only.' : SKILL_EDITOR_WRITE_UNAVAILABLE,
    revision: hash(Buffer.concat([Buffer.from(`${stat.dev}:${stat.ino}:${stat.birthtimeNs}:${stat.mtimeNs}:`), bytes])) } };
}

export function openSkill(entry: EditableSkill): SkillDocument { return snapshot(entry).document; }

export function editSkill(entry: EditableSkill, revision: string, body: string): SkillDocument {
  if (entry.readOnly) throw new WorkforceError('forbidden', 'Built-in and imported skills are read-only. Create a separately named skill to change your own copy.');
  if (body.length > 200_000 || body.includes('\0')) throw new WorkforceError('bad_request', 'Skill text is too large or contains a null character.');
  const original = snapshot(entry);
  if (original.document.revision !== revision) conflict();
  // Without frontmatter an inserted --- block would turn body text into metadata on the next read.
  if (!original.head && /^(?:\uFEFF)?---(?:\r?\n|$)/.test(body)) throw new WorkforceError('bad_request', 'The editor changes body text, not frontmatter.');
  // Temp+rename loses file protection and streams; ReplaceFile alone loses group.
  // No verified writer is shipped. Reject BEFORE mutation on every platform.
  // Older clients may still send drafts: never claim they were saved.
  throw new WorkforceError('unavailable', SKILL_EDITOR_WRITE_UNAVAILABLE);
}

export function createSkill(_base: string, _name: string, _description: string): never {
  // No blank skill that this new editor cannot then save. Legacy skills.save stays unchanged.
  throw new WorkforceError('unavailable', SKILL_EDITOR_WRITE_UNAVAILABLE);
}
