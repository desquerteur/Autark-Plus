// Owner 15.11.2026: the agent's HUMAN.md stands last in the stable prompt under "## From <the person>" (secrets
// redacted, nothing when it is empty); "My environment now" names the engines connected in the Autark system (signed-in
// accounts that run turns, by provider), "## Now" the one this turn runs in; the stable part says the agent lives in the
// Autark system.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, route, VIDEO_MODE } from './fixture.ts';
import { enginesLine } from '../../../src/runtime/context/environment.ts';
import type { Account } from '../../../src/shared/model/providers.ts';

const account = (id: string, provider: Account['provider'], state: Account['state'] = 'ok', enabled = true) =>
  ({ id, provider, label: provider, auth: 'cli', state, enabled, priority: 0, createdAt: 0 }) as unknown as Account;

function setup(human: string) {
  const f = fixture();
  Object.assign(f.services, {
    agentCore: {
      human: () => human,
      instructions: (agent: { instructions: string }) => agent.instructions,
      mainSkills: () => [],
      folder: (id: string) => `/data/agents/${id}`,
    },
    accounts: { list: () => [account('acc_1', 'claude'), account('acc_2', 'claude'), account('acc_3', 'codex'), account('acc_4', 'openai', 'needs_login'), account('acc_5', 'elevenlabs'), account('acc_6', 'anthropic', 'ok', false)] },
  });
  return f;
}

test('HUMAN.md stands last in the stable prompt under the person\'s name, secrets redacted', () => {
  const f = setup('No calls before 10:00. Password hunter2 stays here.');
  const { stable } = f.context.prompt({ agent: f.vid, mode: VIDEO_MODE, route: route() });
  assert.ok(stable.endsWith('## From Alex\nNo calls before 10:00. Password secret://sec_pw stays here.'), stable.slice(-300));
  assert.ok(stable.includes('I run inside the Autark system on it'), 'the agent lives in the Autark system, not the app');
});

test('an empty HUMAN.md adds nothing', () => {
  const f = setup('');
  const { stable } = f.context.prompt({ agent: f.vid, mode: VIDEO_MODE, route: route() });
  assert.ok(!stable.includes('## From '), stable.slice(-300));
});

test('the engines of the system in "My environment now", the turn\'s own in "## Now"', () => {
  const f = setup('');
  assert.equal(enginesLine(f.services), 'Engines connected in this Autark system: Claude Code (2 accounts), Codex.');
  const { volatile } = f.context.prompt({ agent: f.vid, mode: VIDEO_MODE, route: { ...route('claude:opus', 'high'), engine: 'claude', accountId: 'acc_2' } });
  assert.ok(volatile.includes('Engines connected in this Autark system: Claude Code (2 accounts), Codex.'), volatile);
  assert.match(volatile, /I run on [^\n]+ · effort high, in Claude Code\./);
});
