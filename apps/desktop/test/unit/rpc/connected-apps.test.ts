import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClientScope } from '../../../src/shared/api/protocol.ts';
import type { ConnectorMutation } from '../../../src/runtime/apps/connectors.ts';
import { createHandlerTable } from '../../../src/runtime/rpc/handlers/index.ts';
import { TestClient, rpcFixture } from './s1-helpers.ts';

const target = { id: 'app-a', name: 'A', transport: 'http' as const };
const params: Record<string, unknown> = {
  'apps.list': undefined,
  'apps.validateAdd': { entries: [{ name: 'new', entry: { url: 'https://example.test/mcp' } }] },
  'apps.add': { entries: [{ name: 'new', entry: { url: 'https://example.test/mcp' } }] },
  'apps.setEnabled': { ...target, enabled: false },
  'apps.remove': target,
  'apps.setToken': { ...target, secretId: 'secret-id' },
  'apps.reconnect': target,
};

function forbidden(error: unknown): boolean {
  return (error as { code?: string })?.code === 'forbidden';
}

test('Apps RPC refuses unsafe roles before list, mutation, reconnect or secret side effects', async (t) => {
  const f = rpcFixture({ table: createHandlerTable() });
  t.after(f.cleanup);
  const mutations: ConnectorMutation[] = [];
  let lists = 0;
  let validates = 0;
  let reconnects = 0;
  Object.assign(f.services, {
    apps: {
      list: () => { lists += 1; return []; },
      validateAdd: () => { validates += 1; },
      mutate: (mutation: ConnectorMutation) => { mutations.push(mutation); },
      reconnect: async () => { reconnects += 1; return { id: 'app-a' }; },
    },
  });
  const scopes: Array<{ label: string; scope: ClientScope }> = [
    { label: 'insecure Settings device', scope: { kind: 'device', deviceId: 'lan', capabilities: ['todo', 'chat', 'tasks', 'settings'], secure: false } },
    { label: 'missing Settings', scope: { kind: 'device', deviceId: 'limited', capabilities: ['todo', 'chat', 'tasks'], secure: true } },
    { label: 'missing secure marker', scope: { kind: 'device', deviceId: 'unknown', capabilities: ['settings'] } },
    { label: 'person', scope: { kind: 'person', personId: 'person', deviceId: 'person-device', tokenId: 'token', secure: true } },
    { label: 'external', scope: { kind: 'external', memberId: 'member', conversationId: 'chat', tokenId: 'token' } },
    { label: 'peer', scope: { kind: 'peer', deviceId: 'linked' } },
    { label: 'agent', scope: { kind: 'agent', agentId: 'agent', runId: 'run' } },
  ];
  const before = { lists, validates, mutations: mutations.length, reconnects };
  for (const { label, scope } of scopes) {
    const client = new TestClient(f.server, scope);
    for (const [method, input] of Object.entries(params)) {
      await assert.rejects(client.call(method, input), forbidden, `${label} must not call ${method}`);
    }
  }
  assert.deepEqual({ lists, validates, mutations: mutations.length, reconnects }, before);
});

test('secure Settings device can use named Apps RPCs; its mailbox removal is stopped before mutation', async (t) => {
  const f = rpcFixture({ table: createHandlerTable() });
  t.after(f.cleanup);
  const mutations: ConnectorMutation[] = [];
  let reconnects = 0;
  let validates = 0;
  Object.assign(f.services, {
    apps: {
      list: () => [{ id: 'app-a', signInUrl: 'https://auth.example.test/continue' }],
      validateAdd: () => { validates += 1; },
      mutate: (mutation: ConnectorMutation) => { mutations.push(mutation); },
      reconnect: async () => { reconnects += 1; return { id: 'app-a', signInUrl: 'https://auth.example.test/continue' }; },
    },
  });
  const phone = new TestClient(f.server, { kind: 'device', deviceId: 'phone', capabilities: ['settings', 'permissions'], secure: true });
  const listed = await phone.call<Array<Record<string, unknown>>>('apps.list');
  assert.equal(listed[0].signInUrl, undefined, 'paired devices do not receive the host OAuth URL');
  await phone.call('apps.validateAdd', params['apps.validateAdd']);
  await phone.call('apps.add', params['apps.add']);
  await phone.call('apps.setEnabled', params['apps.setEnabled']);
  await phone.call('apps.setToken', params['apps.setToken']);
  const reconnected = await phone.call<Record<string, unknown>>('apps.reconnect', target);
  assert.equal(reconnected.signInUrl, undefined, 'reconnect result does not expose the host OAuth URL');
  assert.equal(mutations.length, 3);
  assert.equal(reconnects, 1);
  assert.equal(validates, 1);
  await assert.rejects(phone.call('apps.remove', { id: 'mail', name: 'Mailbox', transport: 'mail' }), (error: unknown) => (error as { code?: string }).code === 'conflict');
  assert.equal(mutations.length, 3);
  await assert.rejects(phone.call('apps.add', { path: 'C:/arbitrary.json', entries: [{ name: 'x', entry: { url: 'https://x.example' } }] }), (error: unknown) => (error as { code?: string }).code === 'bad_request');
  assert.equal(mutations.length, 3);

  const settingsOnly = new TestClient(f.server, { kind: 'device', deviceId: 'settings-only', capabilities: ['settings'], secure: true });
  await assert.rejects(settingsOnly.call('apps.setToken', params['apps.setToken']), forbidden);
  assert.equal(mutations.length, 3);
});

test('a Settings-only phone cannot attach existing secret handles to a new host connector', async (t) => {
  const f = rpcFixture({ table: createHandlerTable() });
  t.after(f.cleanup);
  let validations = 0;
  let writes = 0;
  Object.assign(f.services, {
    apps: {
      list: () => [],
      validateAdd: () => { validations += 1; },
      mutate: () => { writes += 1; },
      reconnect: async () => ({ id: 'app-a' }),
    },
  });
  const settingsOnly = new TestClient(f.server, { kind: 'device', deviceId: 'settings-only', capabilities: ['settings'], secure: true });
  const entries = { entries: [
    { name: 'http', entry: { url: 'https://controlled.example/mcp', headers: { Authorization: 'Bearer secret://known-token' } } },
  ] };
  for (const method of ['apps.validateAdd', 'apps.add']) await assert.rejects(settingsOnly.call(method, entries), forbidden, method);
  assert.deepEqual({ validations, writes }, { validations: 0, writes: 0 });

  const privileged = new TestClient(f.server, { kind: 'device', deviceId: 'settings-secrets', capabilities: ['settings', 'permissions'], secure: true });
  await privileged.call('apps.validateAdd', entries);
  await privileged.call('apps.add', entries);
  assert.deepEqual({ validations, writes }, { validations: 1, writes: 1 });
});

test('a phone cannot add a new host command connector through the Apps API', async (t) => {
  const f = rpcFixture({ table: createHandlerTable() });
  t.after(f.cleanup);
  let validations = 0;
  let writes = 0;
  Object.assign(f.services, {
    apps: {
      list: () => [],
      validateAdd: () => { validations += 1; },
      mutate: () => { writes += 1; },
      reconnect: async () => ({ id: 'app-a' }),
    },
  });
  const commandBatch = { entries: [{ name: 'local', entry: { command: 'node', args: ['server.js'] } }] };
  const phone = new TestClient(f.server, { kind: 'device', deviceId: 'phone', capabilities: ['settings'], secure: true });
  await assert.rejects(phone.call('apps.validateAdd', commandBatch), forbidden);
  await assert.rejects(phone.call('apps.add', commandBatch), forbidden);
  assert.deepEqual({ validations, writes }, { validations: 0, writes: 0 });

  const owner = new TestClient(f.server, { kind: 'owner' });
  await owner.call('apps.validateAdd', commandBatch);
  await owner.call('apps.add', commandBatch);
  assert.deepEqual({ validations, writes }, { validations: 1, writes: 1 });
});

