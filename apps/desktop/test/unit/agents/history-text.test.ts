// 13.11.2026 (owner: "der Kontext geht nie verloren … nie auf null angefangen oder mit einem Chat"): a turn without a session that
// holds the context gets the agent's own record as text (agents/history-text.ts) – marks applied, newest kept within the budget,
// never a chat's history.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerSetup, mid } from '../context/ledger-fixture.ts';
import { HISTORY_HEAD, historyText } from '../../../src/runtime/agents/history-text.ts';

test('my record as text: lines, my words and my calls with their output; condensed with the stamp, hidden left out; newest within the budget', () => {
  const t = ledgerSetup();
  try {
    const first = t.say('Please build the export.');
    const run = t.turn(first.seq);
    t.ourCall(run, 'shell.exec', { command: 'npm run export' }, 'export written to out/export.csv');
    t.done(run);
    const second = t.say('And now the secret plan, hide this line.');
    t.done(t.turn(second.seq));
    t.ledger.mark(t.tom.id, 'main', [{ itemId: mid(t.db, second), state: 'hidden', reason: 'old', by: 'subconscious' }]);
    const text = historyText(t.services, t.tom.id, 'main', 50_000)!;
    assert.ok(text.startsWith(`${HISTORY_HEAD}\n\n`), text);
    assert.match(text, /Please build the export\./);
    assert.match(text, /\[ran shell\.exec: npm run export\]\n\[output of shell\.exec\]\nexport written to out\/export\.csv/);
    assert.doesNotMatch(text, /secret plan/, 'a hidden item leaves no trace');
    const third = t.turn(t.say('One more long step.').seq);
    t.ourCall(third, 'shell.exec', { command: 'cat big.log' }, 'log line\n'.repeat(300), 'c9');
    t.done(third);
    const small = historyText(t.services, t.tom.id, 'main', 1)!;
    assert.match(small, /\[cut here; the record keeps it whole – context\.restore t\d+\]|log line/);
    assert.match(small, /earlier items? of my record left out here for space; they are kept/);
    assert.equal(historyText(t.services, 'ag_nobody', 'main', 50_000), undefined, 'nothing recorded: no text');
  } finally { t.cleanup(); }
});
