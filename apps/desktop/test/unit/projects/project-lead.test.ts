// AF-020: a project's lead – set, cleared and refused through ProjectService.update, the default agent of a new
// session, gone once its home moves elsewhere, and the "Project lead" prompt section it gets (lead-prompt.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { agent, harness } from '../chat/harness.ts';
import { tempDir } from '../store/helpers.ts';
import { ProjectService, currentLead, projectId } from '../../../src/runtime/projects/service.ts';
import type { ProjectServices } from '../../../src/runtime/projects/service.ts';
import { leadSectionText, projectLeadSection } from '../../../src/runtime/projects/lead-prompt.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';

function fixture() {
  const h = harness();
  const temp = tempDir('wf-lead-');
  const folder = path.join(temp.dir, 'shop');
  const other = path.join(temp.dir, 'other');
  mkdirSync(folder, { recursive: true });
  mkdirSync(other, { recursive: true });
  const homes = new Map<string, string>();
  h.org.add(agent('ag_ava', 'Ava'));
  h.org.add(agent('ag_ben', 'Ben'));
  h.org.add(agent('ag_cy', 'Cy'));
  homes.set('ag_ava', folder);
  homes.set('ag_ben', folder);
  homes.set('ag_cy', other);
  const services = h.services as RuntimeServices;
  Object.assign(services, {
    paths: { data: temp.dir, workspace: temp.dir },
    agentCore: { homes: { stored: (id: string) => homes.get(id) } },
  });
  const projects = new ProjectService(services as unknown as ProjectServices);
  return { h, services, projects, folder, other, homes, id: projectId(folder), cleanup: temp.cleanup };
}

test('currentLead: only while the lead still works in the project', () => {
  assert.equal(currentLead({ leadId: 'ag_a' }, [{ id: 'ag_a' }, { id: 'ag_b' }]), 'ag_a');
  assert.equal(currentLead({ leadId: 'ag_x' }, [{ id: 'ag_a' }]), undefined);
  assert.equal(currentLead({}, [{ id: 'ag_a' }]), undefined);
  assert.equal(currentLead(undefined, [{ id: 'ag_a' }]), undefined);
});

test('a project lead is set, shown, the default of a new session and cleared again', async () => {
  const f = fixture();
  try {
    let project = await f.projects.get(f.id);
    assert.equal(project.leadId, undefined);
    assert.deepEqual(project.agents.map((a) => a.id), ['ag_ava', 'ag_ben']);

    project = await f.projects.update(f.id, { leadId: 'ag_ben' });
    assert.equal(project.leadId, 'ag_ben');
    assert.equal((await f.projects.list()).find((p) => p.id === f.id)?.leadId, 'ag_ben');

    const started = await f.projects.startSession({ projectId: f.id, prompt: 'Fix the cart' });
    assert.deepEqual(started.conversation.members.filter((m) => m.kind === 'agent').map((m) => m.memberId), ['ag_ben'], 'the lead runs a session without a chosen agent');

    await assert.rejects(() => f.projects.update(f.id, { leadId: 'ag_cy' }), (error: unknown) => error instanceof WorkforceError && error.code === 'bad_request', 'an agent of another folder cannot lead');
    assert.equal((await f.projects.get(f.id)).leadId, 'ag_ben');

    project = await f.projects.update(f.id, { leadId: '' });
    assert.equal(project.leadId, undefined);
  } finally { f.cleanup(); }
});

test('a lead whose home moves elsewhere stops leading; the prompt section follows', async () => {
  const f = fixture();
  try {
    await f.projects.update(f.id, { leadId: 'ag_ava' });
    const led = f.projects.ledBy('ag_ava');
    assert.equal(led.length, 1);
    assert.equal(led[0]!.name, 'shop');
    assert.deepEqual(led[0]!.others, [{ id: 'ag_ben', name: 'Ben' }]);
    assert.deepEqual(f.projects.ledBy('ag_ben'), []);

    const text = projectLeadSection(f.services, { id: 'ag_ava' });
    assert.match(text, /^## Project lead/);
    assert.match(text, /I lead the project "shop"/);
    assert.match(text, /Ben \(ag_ben\)/);
    assert.equal(projectLeadSection(f.services, { id: 'ag_ben' }), '');

    f.homes.set('ag_ava', f.other);
    assert.deepEqual(f.projects.ledBy('ag_ava'), []);
    assert.equal((await f.projects.get(f.id)).leadId, undefined);
    assert.equal(projectLeadSection(f.services, { id: 'ag_ava' }), '');
  } finally { f.cleanup(); }
});

test('leadSectionText: a lead without colleagues, a long team and nothing to lead', () => {
  assert.equal(leadSectionText([]), '');
  const alone = leadSectionText([{ id: 'prj_1', name: 'Solo', folder: 'C:/code/solo', others: [] }]);
  assert.match(alone, /No other agent works in it yet/);
  const others = Array.from({ length: 15 }, (_, i) => ({ id: `ag_${i}`, name: `Agent ${i}` }));
  const many = leadSectionText([{ id: 'prj_2', name: 'Big\nteam', folder: 'C:/code/big', others }]);
  assert.match(many, /"Big team"/);
  assert.match(many, /and 3 more\./);
  assert.match(many, /agents\.delegate/);
});
