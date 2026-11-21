// KI-Runde 17.11.2026 (package T, contract 6.4): what the tool texts carry for a brief and for the one-line list –
// phone.say opens with the ask, phone.key names the app phone's keys with notifications, a note from a part wakes its
// origin for a whole turn, a part's brief names what it carries and its model the piece, tasks take an effort and no
// model, dueAt is a date the world sets, one tasks.update carries state, fact and plan; caps: a brief 12,000, a fact 2,000.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneTools } from '../../../src/runtime/phone/tools.ts';
import { splitTools } from '../../../src/runtime/tools/builtin/agents-split.ts';
import { taskTools } from '../../../src/runtime/tools/builtin/tasks.ts';
import { brief } from '../../../src/runtime/tools/builtin/tools-meta.ts';
import { validate } from '../../../src/runtime/tools/validate.ts';
import { SPLIT_LIMITS } from '../../../src/shared/model/splits.ts';
import type { ToolDef } from '../../../src/runtime/tools/types.ts';

const byName = new Map<string, ToolDef>([...phoneTools({} as never), ...splitTools, ...taskTools].map((tool) => [tool.name, tool]));
const def = (name: string) => byName.get(name)!;
const prop = (name: string, key: string) => (def(name).inputSchema as { properties: Record<string, Record<string, unknown>> }).properties[key];
const props = (name: string) => Object.keys((def(name).inputSchema as { properties: Record<string, unknown> }).properties);

test('phone: the one-line list carries the ask and the notification key', () => {
  assert.match(brief(def('phone.say').description), /^Asks the person for a moment of their phone with ✓ and ✕/);
  assert.match(brief(def('phone.key').description), /notifications, which shows what just arrived/);
  assert.match(String(prop('phone.key', 'key').description), /^Autark app: back, home, recents, notifications, quick_settings, enter\./);
  assert.match(brief(def('phone.ui_tree').description), /^Reads the phone screen/);
});

test('splits: a note from a part wakes the origin for a whole turn; the brief names what it carries, the model the piece; 12,000 characters', () => {
  assert.match(def('agents.split_tell').description, /a note wakes my origin for a whole turn/);
  assert.match(def('agents.split').description, /a note from one wakes me for a whole turn/);
  const part = (prop('agents.split', 'parts') as { items: { properties: Record<string, { description?: string; maxLength?: number }> } }).items.properties;
  assert.match(String(part.brief.description), /for whom and why, what good looks like, what is known and decided, how it checks its result itself/);
  assert.match(String(part.model.description), /hardest step of this piece/);
  assert.equal(SPLIT_LIMITS.briefChars, 12_000);
  assert.equal(part.brief.maxLength, 12_000);
});

test('tasks: an effort and no model on create and give; dueAt a date the world sets; one update carries all; a fact holds 2,000', () => {
  for (const name of ['tasks.create', 'tasks.give']) {
    assert.ok(!props(name).includes('model') && props(name).includes('effort'), name);
  }
  assert.ok(validate({ title: 'x', model: 'cheap' }, def('tasks.create').inputSchema).length > 0, 'a model is refused');
  assert.match(String(prop('tasks.create', 'dueAt').description), /^A date the world sets/);
  assert.match(String(prop('tasks.update', 'dueAt').description), /^A date the world sets/);
  assert.match(def('tasks.update').description, /in one call\. I call it at the end of a stretch of work/); // the first sentence stays within 90 characters (tasks/give-watch)
  assert.equal(prop('tasks.update', 'fact').maxLength, 2_000);
  assert.deepEqual(validate({ fact: 'f'.repeat(2_000) }, def('tasks.update').inputSchema), []);
});
