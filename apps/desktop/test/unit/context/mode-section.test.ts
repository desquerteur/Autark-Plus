// S2 (KI-Runde 17.11.2026, after the review 18.11.) – the mode part of the stable prompt (context/prompt-stable.ts
// modeSection): the mode's instructions without their own heading, else its description, and nothing at all for a mode
// whose file holds only its heading – the prompt never carries an empty "## Mode:" heading.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, route, VIDEO_MODE } from './fixture.ts';
import { modeSection } from '../../../src/runtime/context/prompt-stable.ts';
import type { ModeInfo } from '../../../src/shared/model/knowledge.ts';

const BARE: ModeInfo = { ...VIDEO_MODE, key: 'bare', name: 'Bare', description: '  ', instructions: '# Bare mode\n\n' };

test('S2 fix: a mode whose file has only a heading shows nothing in the prompt; its description or body stands under the heading', () => {
  assert.equal(modeSection(BARE), '', 'only a heading: no mode part');
  assert.equal(modeSection({ ...BARE, description: 'Plain work.' }), '## Mode: Bare\nPlain work.');
  assert.equal(modeSection({ ...BARE, instructions: '# Bare mode\r\n\r\nKeep it plain.' }), '## Mode: Bare\nKeep it plain.');

  const f = fixture();
  const chat = f.chats.create({ agentIds: [f.vid.id], createdBy: 'human' });
  const prompt = f.context.prompt({ agent: f.vid, conversationId: chat.id, mode: BARE, route: route() });
  assert.ok(!prompt.stable.includes('## Mode:'), 'the stable prompt has no empty mode heading');
  assert.ok(!(prompt.stableSections ?? []).some((section) => section.name === 'mode'));
});
