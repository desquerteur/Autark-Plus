// AF-018: the Projects tab's pure helpers (ui/projects/projects-model.ts) and its route.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../../../src/shared/model/project.ts';
import {
  agentsLine, branchLabel, changedLabel, composerPlaceholder, folderName, orderProjects, projectLine, removeProject, syncLabel, upsertProject, workingCount,
} from '../../../src/ui/projects/projects-model.ts';
import { formatRoute, parseRoute } from '../../../src/ui/lib/router.ts';

const project = (over: Partial<Project>): Project => ({
  id: 'prj_1', folder: 'C:\\code\\demo', name: 'demo', source: 'added', pinned: false, addedAt: 0, lastActiveAt: 0,
  agents: [], sessions: [], about: '', ...over,
});

test('order: pinned first, then newest activity, then name', () => {
  const list = [project({ id: 'a', name: 'b', lastActiveAt: 5 }), project({ id: 'b', name: 'a', lastActiveAt: 5 }), project({ id: 'c', name: 'z', pinned: true }), project({ id: 'd', name: 'd', lastActiveAt: 9 })];
  assert.deepEqual(orderProjects(list).map((p) => p.id), ['c', 'd', 'b', 'a']);
  const updated = upsertProject(list, project({ id: 'a', name: 'b', lastActiveAt: 99 }));
  assert.equal(updated.length, 4);
  assert.equal(updated[1]!.id, 'a');
  assert.deepEqual(removeProject(list, 'a').map((p) => p.id), ['b', 'c', 'd']);
});

test('the git line says branch, changes and sync – or why there is none', () => {
  const git = { branch: 'main', head: 'abc1234', dirty: 3, ahead: 2, behind: 0, branches: ['main'] };
  assert.equal(projectLine(project({ git })), 'main · 3 changed · ↑2');
  assert.equal(projectLine(project({})), 'Not a git repository');
  assert.equal(projectLine(project({ missing: true })), 'Folder not found');
  assert.equal(branchLabel({ branch: null, head: 'abc1234' }), 'detached at abc1234');
  assert.equal(changedLabel(0), '');
  assert.equal(syncLabel({ ahead: 0, behind: 4 }), '↓4');
});

test('texts of the page', () => {
  assert.equal(composerPlaceholder('ServeSync'), 'What should happen in ServeSync?');
  assert.match(agentsLine(project({})), /hires an agent/);
  assert.equal(agentsLine(project({ agents: [{ id: 'ag_1', name: 'Dev' }] })), 'Dev');
  assert.equal(workingCount(project({ sessions: [{ conversationId: 'c', title: 't', agentIds: [], lastAt: 0, working: true }] })), 1);
  assert.equal(folderName('C:\\code\\demo\\'), 'demo');
  assert.equal(folderName('/home/me/site'), 'site');
});

test('route: #/projects and #/projects/<id>', () => {
  assert.deepEqual(parseRoute('#/projects'), { view: 'projects' });
  assert.deepEqual(parseRoute('#/projects/prj_abc'), { view: 'projects', id: 'prj_abc' });
  assert.equal(formatRoute({ view: 'projects', id: 'prj_abc' }), '#/projects/prj_abc');
});

// AF-020: the lead first, whom the side chat talks to, and who runs a new session.
test('agentsLeadFirst, chatAgentOf and sessionWho follow the project lead', async () => {
  const { agentsLeadFirst, chatAgentOf, sessionWho } = await import('../../../src/ui/projects/projects-model.ts');
  const agents = [{ id: 'ag_a', name: 'Ava' }, { id: 'ag_b', name: 'Ben' }, { id: 'ag_c', name: 'Cy' }];
  const led = project({ agents, leadId: 'ag_b' });
  assert.deepEqual(agentsLeadFirst(led).map((a) => a.id), ['ag_b', 'ag_a', 'ag_c']);
  assert.deepEqual(agentsLeadFirst(project({ agents })).map((a) => a.id), ['ag_a', 'ag_b', 'ag_c']);
  assert.equal(chatAgentOf(led), 'ag_b', 'the lead by default');
  assert.equal(chatAgentOf(led, 'ag_c'), 'ag_c', 'a picked agent stays');
  assert.equal(chatAgentOf(led, 'ag_gone'), 'ag_b', 'a picked agent no longer in the project falls back to the lead');
  assert.equal(chatAgentOf(project({ agents })), 'ag_a');
  assert.equal(chatAgentOf(project({})), undefined);
  assert.equal(sessionWho(led), 'Runs with Ben (lead)');
  assert.equal(sessionWho(project({ agents })), 'Runs with Ava');
  assert.equal(sessionWho(project({})), 'A new agent is hired from this folder');
});
