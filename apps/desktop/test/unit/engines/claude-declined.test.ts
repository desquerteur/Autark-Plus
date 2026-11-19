// 19.11.2026 – Claude Code engine (engines/claude/engine.ts, stream.ts declined): a model whose safeguards decline the
// conversation is a model outage, never the account's – 'unavailable' with details.declined and details.local (no cooling,
// accounts/failure.ts), no session kept and no rebuild 'conflict' (which renewed on the same model again and again: Vera in
// company-2, six turns on 18./19.11.); turn.ts then leaves that model out of the turn on every account.
// Owns: these assertions only. Never: a real Claude Code binary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnInput } from './fakes.ts';
import { claudeAccount, claudeSetup } from './claude-fixture.ts';
import { accountFailure } from '../../../src/runtime/accounts/failure.ts';

const DECLINED = "API Error: Sonnet 5.5's safeguards flagged this message (https://www.anthropic.com/legal/aup). This sometimes happens with safe, normal conversations. Claude Code can't respond to this message with Sonnet 5.5.";

test('claude: a safeguards refusal is a declined model – unavailable, local, no session – so the turn fails over', async () => {
  const h = claudeSetup({ turn: (_call, session) => [{ type: 'result', subtype: 'success', is_error: true, result: DECLINED, session_id: session }] });
  const done = await h.engine.run(turnInput({ model: 'claude-sonnet-5-5', account: claudeAccount() }).input);
  assert.equal(done.stop, 'error');
  assert.equal(done.error?.code, 'unavailable');
  assert.equal(done.error?.details?.declined, true);
  assert.equal(done.error?.details?.local, true, 'no account cools for it');
  assert.equal(done.error?.details?.rebase, undefined, 'never renewed on the same model');
  assert.equal(done.session, undefined);
  assert.equal(accountFailure(done), 'overload', 'turn.ts fails over');
});

test('claude: an ordinary error stays a failed turn', async () => {
  const h = claudeSetup({ turn: (_call, session) => [{ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'API Error: 500', session_id: session }] });
  const done = await h.engine.run(turnInput({ model: 'claude-sonnet-5-5', account: claudeAccount() }).input);
  assert.equal(done.error?.details?.declined, undefined);
});
