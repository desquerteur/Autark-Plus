// Review 3 (finding 4) – the notes that wait for an agent's next turn on a thread (agents/turn-finish.ts saveRepairNotes,
// takeRepairNotes): at most six wait, and the newest six stay – a call's block or a cut fold's note is never dropped
// because older notes fill the row; a note saved again counts as new.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import { saveRepairNotes, takeRepairNotes } from '../../../src/runtime/agents/turn-finish.ts';
import { harness } from '../chat/harness.ts';

test('the newest six notes stay; one saved again moves to the newest', () => {
  const h = harness();
  const services = { db: h.db, clock: h.clock } as unknown as RuntimeServices;
  saveRepairNotes(services, 'ag_tom', 'main', ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
  saveRepairNotes(services, 'ag_tom', 'main', ['call block']);
  saveRepairNotes(services, 'ag_tom', 'main', ['n3', 'fold cut']);
  assert.deepEqual(takeRepairNotes(services, 'ag_tom', 'main'), ['n4', 'n5', 'n6', 'call block', 'n3', 'fold cut']);
  assert.deepEqual(takeRepairNotes(services, 'ag_tom', 'main'), [], 'taken once');
});
