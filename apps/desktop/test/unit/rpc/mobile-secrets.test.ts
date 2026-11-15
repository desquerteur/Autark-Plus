// Owns: secure owner-device catalog edits; never real credentials or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHandlerTable } from '../../../src/runtime/rpc/handlers/index.ts';
import type { ClientScope } from '../../../src/shared/api/protocol.ts';
import { SecretVault } from '../../../src/runtime/secrets/service.ts';
import { OWNER, TestClient, rpcFixture } from './s1-helpers.ts';

test('secure permissions device edits and removes stored secrets without receiving values; export stays PC-only', async (t) => {
  const f = rpcFixture({ table: createHandlerTable() }); t.after(f.cleanup);
  f.services.secrets = new SecretVault({ db: f.services.db, clock: f.services.clock, host: { encrypt: async (s: string) => Buffer.from(s), decrypt: async (b: Uint8Array) => Buffer.from(b).toString() } });
  const owner = new TestClient(f.server, OWNER);
  const phone = new TestClient(f.server, { kind: 'device', deviceId: 'dev_secretphone', capabilities: ['permissions'], secure: true });
  const single = await owner.call<{ id: string }>('secrets.save', { label: 'Synthetic', kind: 'password', value: 'synthetic-test-only' });
  const updated = await phone.call('secrets.save', { id: single.id, label: 'Renamed', kind: 'password', value: 'synthetic-replaced' });
  assert.ok(!JSON.stringify(updated).includes('synthetic-replaced'));
  const group = await owner.call<{ group: { id: string }; fields: Array<{ id: string }> }>('secrets.saveGroup', { label: 'Synthetic group', kind: 'other', fields: [{ field: 'key', kind: 'token', value: 'synthetic-group' }, { field: 'second', kind: 'text', value: 'synthetic-second' }] });
  await phone.call('secrets.saveGroup', { id: group.group.id, label: 'Edited group', remove: [group.fields[0].id] });
  assert.equal((await phone.request('secrets.export', {})).error?.code, 'forbidden');
  await phone.call('secrets.deleteGroup', { id: group.group.id });
  await phone.call('secrets.delete', { id: single.id });
  assert.equal((await phone.call<unknown[]>('secrets.list')).length, 0);
});

test('LAN, capabilityless and colleague callers cannot edit or delete owner secrets', async (t) => {
  const f = rpcFixture({ table: createHandlerTable() }); t.after(f.cleanup);
  f.services.secrets = new SecretVault({ db: f.services.db, clock: f.services.clock, host: { encrypt: async (s: string) => Buffer.from(s), decrypt: async (b: Uint8Array) => Buffer.from(b).toString() } });
  const owner = new TestClient(f.server, OWNER);
  const single = await owner.call<{ id: string }>('secrets.save', { label: 'Keep', kind: 'password', value: 'synthetic-keep' });
  const scopes: ClientScope[] = [
    { kind: 'device', deviceId: 'dev_lan', capabilities: ['permissions'], secure: false },
    { kind: 'device', deviceId: 'dev_plain', capabilities: ['settings'], secure: true },
    { kind: 'person', personId: 'per_other', deviceId: 'dev_other', tokenId: 'tok_other', secure: true },
  ];
  for (const scope of scopes) {
    const client = new TestClient(f.server, scope);
    for (const [method, params] of [
      ['secrets.save', { id: single.id, label: 'Changed', kind: 'password' }],
      ['secrets.delete', { id: single.id }],
      ['secrets.saveGroup', { label: 'No', kind: 'other' }],
      ['secrets.deleteGroup', { id: 'sec_absent' }],
    ] as const) assert.equal((await client.request(method, params)).error?.code, 'forbidden');
  }
  assert.equal((await owner.call<Array<{ label: string }>>('secrets.list'))[0].label, 'Keep');
});

test('secret UI separates metadata edit/delete from PC-only plaintext export', () => {
  const source = readFileSync(new URL('../../../src/ui/settings/SecretsPage.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes("const canExport = can('secrets.export')"));
  assert.ok(source.includes('{canExport && <Button'));
  assert.ok(source.includes('{canDelete && <button'));
  assert.ok(!source.includes('onPc'));
});
