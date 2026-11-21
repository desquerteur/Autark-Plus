// B-057 live test L5 (Codex, 30.10.): a worktree part tried to commit itself – its sandbox may not write the repository's
// git metadata, the escalation was denied, and the part reported "no commit" although the app commits its work on its
// branch when it ends (splits/runner.ts finishThenEnd). The 'split' section has a worktree part leave its work uncommitted,
// and agents.split's description names the worktree option with its merge tool. A part in the shared folder keeps to its files.
// B-083: the section opens with design/principle.md "Ultra PART" (name, piece and whole filled in) – no bans.
// Owns: nothing in production.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSection } from '../../../src/runtime/context/split-section.ts';
import { splitTools } from '../../../src/runtime/tools/builtin/agents-split.ts';
import type { SplitView } from '../../../src/shared/model/splits.ts';

const part = (patch: Partial<SplitView>): SplitView => ({
  id: 'spl_1', groupId: 'sgr_1', agentId: 'ag_1', idx: 1, of: 2, title: 'Alpha status', brief: 'Change alpha.txt', context: 'brief',
  after: [], worktree: false, status: 'running', attempts: 1, createdAt: 1, runs: 1, ...patch,
});

test('a worktree part is told not to commit: the app commits its work on its branch', () => {
  const text = splitSection({ name: 'Manager' }, { split: part({ worktree: true, branch: { name: 'wf/split-alpha-status-abc123' } }) });
  assert.match(text, /own git worktree \(branch wf\/split-alpha-status-abc123\)/);
  assert.match(text, /leave it uncommitted: the app commits my work on that branch when I end; my origin merges it\./);
});

test('a part in the shared folder keeps to the files of its part; the section opens with the Ultra PART text', () => {
  const text = splitSection({ name: 'Manager' }, { split: part({}) });
  assert.match(text, /I share the working folder with my origin and my other parts – I keep to the files of my part\./);
  assert.doesNotMatch(text, /uncommitted/);
  assert.ok(text.startsWith('## My part #1 of 2\nI am Manager – this part of me takes “Alpha status” all the way (the whole: “Alpha status”), while my origin and my other parts carry the rest. Same knowledge, tools and way of working; what I learn here, I keep.'), text);
  assert.doesNotMatch(text, /post nothing|ask nobody|main self|are my origin's/, 'no bans');
});

test("agents.split's worktree option names its merge tool", () => {
  const split = splitTools.find((tool) => tool.name === 'agents.split')!;
  const part = (split.inputSchema as { properties: { parts: { items: { properties: { worktree: { description: string } } } } } }).properties.parts.items.properties;
  assert.equal(part.worktree.description, 'true: its own git worktree for file changes (agents.split_merge).');
  assert.ok(split.description.length <= 900, `${split.description.length} characters`);
});
