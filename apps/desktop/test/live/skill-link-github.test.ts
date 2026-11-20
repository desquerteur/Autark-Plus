// LIVE (opt-in, network): desquerteur/Autark-Plus#8 end to end against the real GitHub – a pasted link to a skill folder
// in a public repository (anthropics/skills) is previewed, installed into the shared library and found by skills.find;
// a raw SKILL.md address installs that one file. The downloads use the runtime's own fetch; nothing is run.
// Owns: nothing in production. Never writes outside its temp folder.
//   WORKFORCE_LIVE=1 node --test test/live/skill-link-github.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { SkillLinks, type SkillLinksDeps } from '../../src/runtime/skills/links/service.ts';
import { findSkills } from '../../src/runtime/tools/builtin/skills-find.ts';
import { GENERAL_MODE } from '../../src/runtime/modes/service.ts';
import type { RuntimeServices } from '../../src/runtime/contracts.ts';
import type { Agent } from '../../src/shared/model/org.ts';
import { library } from '../unit/skills/links-fixture.ts';

const live = process.env.WORKFORCE_LIVE === '1';
const skip = live ? false : 'set WORKFORCE_LIVE=1';
const agent: Agent = { id: 'ada', name: 'Ada', role: '', avatar: { kind: 'initials', value: 'A' }, instructions: '', mode: 'general', skills: [], modelPolicy: {}, status: 'idle', createdBy: 'human', createdAt: 0, updatedAt: 0 };

function setup() {
  const lib = library();
  let ids = 0;
  const deps: SkillLinksDeps = {
    fetch: (url, init) => fetch(url, init), clock: lib.clock, skills: lib.skills, agents: () => [agent],
    home: () => undefined, files: { get: () => undefined, read: async () => Buffer.alloc(0) },
    changed: () => lib.skills.invalidate(), id: () => `p${++ids}`,
  };
  return { ...lib, links: new SkillLinks(deps), done: () => rmSync(lib.root, { recursive: true, force: true }) };
}

test('a GitHub folder link from a public repository installs and skills.find finds it', { skip, timeout: 180_000 }, async () => {
  const t = setup();
  try {
    const preview = await t.links.preview({ url: 'https://github.com/anthropics/skills/tree/main/skills/pdf' });
    assert.equal(preview.source.kind, 'github');
    assert.equal(preview.skills.length, 1);
    assert.equal(preview.skills[0]!.name, 'pdf');
    const { installed } = await t.links.install({ previewId: preview.id, routes: [''], target: { kind: 'shared' } });
    assert.deepEqual(installed.map((skill) => skill.name), ['pdf']);
    assert.ok(existsSync(path.join(t.workspace, 'skills', 'pdf', 'SKILL.md')));
    const hits = findSkills({ skills: t.skills } as unknown as RuntimeServices, agent, GENERAL_MODE, 'fill in a PDF form');
    assert.equal(hits[0]?.info.name, 'pdf', 'skills.find finds the installed skill');
  } finally { t.done(); }
});

test('a raw SKILL.md address installs that skill', { skip, timeout: 120_000 }, async () => {
  const t = setup();
  try {
    const preview = await t.links.preview({ url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/docx/SKILL.md' });
    assert.equal(preview.skills.length, 1);
    assert.equal(preview.skills[0]!.name, 'docx');
    const { installed } = await t.links.install({ previewId: preview.id, routes: [''], target: { kind: 'shared' } });
    assert.deepEqual(installed.map((skill) => skill.name), ['docx']);
    assert.ok(existsSync(path.join(t.workspace, 'skills', 'docx', 'SKILL.md')));
  } finally { t.done(); }
});
