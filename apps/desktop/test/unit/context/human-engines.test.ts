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

function setup(human: string, forEveryAgent?: string) {
  const f = fixture(forEveryAgent === undefined ? {} : { profile: { forEveryAgent } });
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

test('owner 16.11.2026: the lines for every agent stand last, after the agent\'s own HUMAN.md, secrets redacted', () => {
  const f = setup('No calls before 10:00.', '  I don\'t solve "I\'m not a robot" checks (CAPTCHAs).\nKey hunter2 stays here.  ');
  const { stable } = f.context.prompt({ agent: f.vid, mode: VIDEO_MODE, route: route() });
  assert.ok(stable.endsWith('## From Alex\nNo calls before 10:00.\n\n## From Alex – for every agent\nI don\'t solve "I\'m not a robot" checks (CAPTCHAs).\nKey secret://sec_pw stays here.'), stable.slice(-300));
  const stableOf = (human: string, every: string) => { const g = setup(human, every); return g.context.prompt({ agent: g.vid, mode: VIDEO_MODE, route: route() }).stable; };
  const alone = stableOf('', 'Every agent reads this.');
  assert.ok(alone.endsWith('## From Alex – for every agent\nEvery agent reads this.'), 'without a HUMAN.md only the part for every agent');
  assert.ok(!alone.includes('## From Alex\n'), alone.slice(-300));
  assert.ok(!stableOf('', '   ').includes('## From '), 'an empty text adds nothing');
});

test('the engines of the system in "My environment now", the turn\'s own in "## Now"', () => {
  const f = setup('');
  assert.equal(enginesLine(f.services), 'Engines connected in this Autark system: Claude Code (2 accounts), Codex.');
  const { volatile } = f.context.prompt({ agent: f.vid, mode: VIDEO_MODE, route: { ...route('claude:opus', 'high'), engine: 'claude', accountId: 'acc_2' } });
  assert.ok(volatile.includes('Engines connected in this Autark system: Claude Code (2 accounts), Codex.'), volatile);
  assert.match(volatile, /I run on [^\n]+ · effort high, in Claude Code\./);
});
