// The real RPC server and temporary SkillLibrary; no production paths/accounts/connectors.
// Owns: editor scope, parameter and persistence checks. Never: grants host file APIs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ClientScope } from '../../../src/shared/api/protocol.ts';
import type { SkillDocument } from '../../../src/shared/api/methods-skills.ts';
import { SkillLibrary } from '../../../src/runtime/skills/service.ts';
import { createHandlerTable } from '../../../src/runtime/rpc/handlers/index.ts';
import { TestClient, rpcFixture } from './s1-helpers.ts';
const methods: Record<string, unknown> = {
  'skills.catalog': undefined, 'skills.open': { id: 'a'.repeat(64) },
  'skills.edit': { id: 'a'.repeat(64), revision: 'b'.repeat(64), body: 'draft' },
  'skills.create': { name: 'new', description: 'purpose' },
};
const code = (value: string) => (error: unknown) => (error as { code?: string }).code === value;

test('unsafe transport, missing Settings, person, peer, external and agent are rejected before service effects', async t => {
  const f = rpcFixture({ table: createHandlerTable() }); t.after(f.cleanup);
  let calls = 0;
  Object.assign(f.services, { skills: Object.fromEntries(['catalog', 'open', 'edit', 'create'].map(name => [name, () => { calls++; }])) });
  const scopes: ClientScope[] = [
    { kind: 'device', deviceId: 'lan', capabilities: ['settings'], secure: false },
    { kind: 'device', deviceId: 'unknown', capabilities: ['settings'] },
    { kind: 'device', deviceId: 'limited', capabilities: ['chat', 'manage'], secure: true },
    { kind: 'person', personId: 'p', deviceId: 'd', tokenId: 't', secure: true },
    { kind: 'peer', deviceId: 'd' },
    { kind: 'external', memberId: 'm', conversationId: 'c', tokenId: 't' },
    { kind: 'agent', agentId: 'a', runId: 'r' },
  ];
  for (const scope of scopes) {
    const client = new TestClient(f.server, scope);
    for (const [method, params] of Object.entries(methods)) await assert.rejects(client.call(method, params), code('forbidden'));
  }
  assert.equal(calls, 0);
});

test('secure Settings-only phone reads; create/edit fail closed via real service with original unchanged', async t => {
  const f = rpcFixture({ table: createHandlerTable() }); t.after(f.cleanup);
  const skills = new SkillLibrary({ paths: f.paths, home: '', clock: f.clock });
  Object.assign(f.services, { skills });
  const phone = new TestClient(f.server, { kind: 'device', deviceId: 'phone', capabilities: ['settings'], secure: true });
  const info = skills.save({ name: 'phone-skill', description: 'synthetic fixture', body: '# Original' });
  const doc = await phone.call<SkillDocument>('skills.open', { id: skills.catalog().find(x => x.path === info.path)!.id });
  const before = readFileSync(path.join(info.path, 'SKILL.md'));
  await assert.rejects(phone.call('skills.create', { name: 'new-phone-skill', description: 'on phone' }), code('unavailable'));
  const file = path.join(doc.info.path, 'SKILL.md');
  const body = '\n# Edited on phone\nOriginal bytes saved 🙂\n';
  await assert.rejects(phone.call('skills.edit', { id: doc.info.id, revision: doc.revision, body }), code('unavailable'));
  const reopened = await phone.call<SkillDocument>('skills.open', { id: doc.info.id });
  assert.equal(reopened.body, doc.body); assert.equal(reopened.readOnly, true);
  assert.match(reopened.readOnlyReason!, /Read-only: safe saving/); assert.ok(readFileSync(file).equals(before));
  const external = readFileSync(file, 'utf8') + 'External'; writeFileSync(file, external);
  await assert.rejects(phone.call('skills.edit', { id: doc.info.id, revision: reopened.revision, body: 'stale' }), code('conflict'));
  assert.equal(readFileSync(file, 'utf8'), external);
  for (const method of ['skills.save', 'skills.delete', 'files.writePath', 'files.readPath', 'files.openPath']) {
    await assert.rejects(phone.call(method, { name: 'phone-skill', path: file, text: 'wrong' }), code('forbidden'), method);
  }
  assert.deepEqual(f.opened, []);
});

test('editor rejects path/owner/frontmatter injection and wrong targets before writing', async t => {
  const f = rpcFixture({ table: createHandlerTable() }); t.after(f.cleanup);
  const skills = new SkillLibrary({ paths: f.paths, home: '', clock: f.clock }); Object.assign(f.services, { skills });
  const phone = new TestClient(f.server, { kind: 'device', deviceId: 'phone', capabilities: ['settings'], secure: true });
  skills.save({ name: 'safe', description: 'purpose', body: '# Original' });
  const doc = await phone.call<SkillDocument>('skills.open', { id: skills.catalog()[0].id });
  const file = path.join(doc.info.path, 'SKILL.md'), before = readFileSync(file);
  for (const params of [
    { id: doc.info.id, revision: doc.revision, body: 'wrong', path: '../outside' },
    { id: doc.info.id, revision: doc.revision, body: 'wrong', ownerAgentId: 'other' },
    { id: doc.info.id, revision: doc.revision, body: 'wrong', frontmatter: 'change' },
    { id: '../outside', revision: doc.revision, body: 'wrong' },
    { id: doc.info.id, revision: '../outside', body: 'wrong' },
  ]) await assert.rejects(phone.call('skills.edit', params), code('bad_request'));
  await assert.rejects(phone.call('skills.edit', { id: '0'.repeat(64), revision: doc.revision, body: 'wrong' }), code('conflict'));
  await assert.rejects(phone.call('skills.create', { name: 'safe', description: 'overwrite' }), code('conflict'));
  assert.ok(readFileSync(file).equals(before));
});
