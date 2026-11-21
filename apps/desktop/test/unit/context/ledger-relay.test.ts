// A call voice's hand-over steered into a running turn (agents/dispatch-steer.ts steerRelay) stands in the agent's record:
// its text is journaled, the ledger captures it as an item of the run (context/ledger/capture.ts), and a rebuild – after a
// failover, a session renewal or a fold – replays it (review r2-4 finding 3, KI-Runde fixes B.7).
// Owns: these assertions only. Never: a real engine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerSetup } from './ledger-fixture.ts';
import { steerRelay } from '../../../src/runtime/agents/dispatch-steer.ts';
import { rebuildItems } from '../../../src/runtime/agents/rebuild-items.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { TurnControl } from '../../../src/runtime/agents/turn-types.ts';

test('a steered call hand-over is journaled with its text and replayed by a rebuild', async () => {
  const t = ledgerSetup();
  try {
    const line = t.say('Prüf die Rechnung');
    const work = t.turn(line.seq);
    const text = '[Live call: my live voice passes this on now] I take it into account in this work now.\nWhat my voice passes on: "Check the October invoice."';
    const control = { engine: { id: 'codex', steer: async () => true } } as unknown as TurnControl;
    const steered = await steerRelay(t.services as unknown as RuntimeServices, { agentId: t.tom.id, runId: work, control }, text, 'now', () => true);
    assert.equal(steered, true);
    t.done(work);
    await t.journal.settled();
    const item = t.ledger.items(t.tom.id, 'main').find((one) => one.title.startsWith('[Live call'));
    assert.ok(item, 'the hand-over is an item of my record');
    const replay = rebuildItems(t.ledger.view(t.tom.id, 'main')).items;
    assert.ok(JSON.stringify(replay).includes('Check the October invoice.'), 'a rebuild has it in full');
  } finally {
    t.cleanup();
  }
});
