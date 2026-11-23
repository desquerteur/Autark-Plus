// Whose references a tool names: the person by default, or a colleague of the organisation by name or id –
// knowledge.find {person} finds them, memory.write into references/<person> keeps them (references/references.ts).
// Owns: that argument and its resolution. Never: storage rules (references/references.ts).

import type { RuntimeServices } from '../../contracts.ts';
import { HUMAN_ID } from '../../../shared/ids.ts';
import { isPersonId } from '../../../shared/model/people.ts';
import { WorkforceError } from '../../../shared/errors.ts';
import { clip } from './util.ts';

export const PERSON = { type: 'string', maxLength: 120 } as const;

/** The subject a tool call names – the person by default, else a person still in the organisation (by id or exact name). */
export function subjectOf(services: RuntimeServices, person: string | undefined): string {
  const value = person?.trim();
  if (!value || value === HUMAN_ID) return HUMAN_ID;
  if (isPersonId(value)) return value;
  let rows: Array<{ id: string }> = [];
  try { rows = services.db.all<{ id: string }>("SELECT id FROM people WHERE status <> 'revoked' AND lower(name) = lower(?) AND id <> ?", [value, HUMAN_ID]); } catch { /* no people here */ }
  if (rows.length !== 1) throw new WorkforceError('not_found', rows.length ? `More than one colleague is called "${clip(value, 60)}" – use their id.` : `No colleague called "${clip(value, 60)}".`);
  return rows[0].id;
}
