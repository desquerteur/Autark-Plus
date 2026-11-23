// Owns: profile/day UI gates against real session.info rules. Never: browser, live account or changed production settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHandlerTable } from '../../../src/runtime/rpc/handlers/index.ts';
import { sessionInfo } from '../../../src/runtime/rpc/handlers/session.ts';
import type { ClientScope } from '../../../src/shared/api/protocol.ts';
import { canEditOwnerSettings, canUploadOwnerPhoto, session } from '../../../src/ui/lib/session.ts';

test('profile/day UI follows owner, secure paired device, capability and colleague boundaries', () => {
  const table = createHandlerTable();
  const device: ClientScope = { kind: 'device', deviceId: 'dev_mobile', capabilities: ['settings'], secure: true };
  const cases: Array<[ClientScope, boolean]> = [
    [{ kind: 'owner' }, true], [device, true],
    [{ ...device, secure: false }, false],
    [{ ...device, capabilities: ['todo'] }, false],
    [{ kind: 'person', personId: 'per_mobile', deviceId: 'dev_person', tokenId: 'token_mobile', secure: true }, false],
  ];
  try {
    session.value = null;
    assert.equal(canEditOwnerSettings(), false, 'unloaded phone does not assume owner');
    for (const [scope, expected] of cases) {
      session.value = sessionInfo(table, scope);
      assert.equal(canEditOwnerSettings(), expected, JSON.stringify(scope));
    }
  } finally { session.value = null; }
});

test('both settings views use the gate; host-window controls keep their desktop bridge', () => {
  for (const name of ['GeneralPage.tsx', 'calendar-day.tsx']) {
    const source = readFileSync(new URL(`../../../src/ui/settings/${name}`, import.meta.url), 'utf8');
    assert.ok(source.includes('const locked = !canEditOwnerSettings()'), name);
    assert.ok(source.includes('HTTPS_NOTE'), name);
    assert.ok(source.includes('disabled={locked}'), name);
  }
  const general = readFileSync(new URL('../../../src/ui/settings/GeneralPage.tsx', import.meta.url), 'utf8');
  // Owner 12.11.: my secure phone changes the PC's login/tray behaviour too, labelled "On your PC:"; a locked phone does not see them.
  assert.ok(general.includes('const remote = !bridge && !locked;'), 'PC rows reach only an unlocked phone');
  assert.ok(general.includes('{(bridge || remote) && ('), 'PC login/tray controls show on the PC or an authorised phone');
  assert.ok(general.includes('On your PC: '), 'PC login/tray controls are not mistaken for phone OS settings');
});

test('photo change needs profile authority plus small and chunked upload methods; removal does not', () => {
  const table = createHandlerTable();
  const device: ClientScope = { kind: 'device', deviceId: 'dev_photo', capabilities: ['settings'], secure: true };
  try {
    session.value = sessionInfo(table, device);
    assert.equal(canEditOwnerSettings(), true);
    assert.equal(canUploadOwnerPhoto(), false, 'settings alone cannot upload');
    session.value = sessionInfo(table, { ...device, capabilities: ['settings', 'todo'] });
    assert.equal(canUploadOwnerPhoto(), true);
    const full = session.value;
    for (const missing of ['files.upload', 'files.uploadChunk']) {
      session.value = { ...full, allowedMethods: full.allowedMethods.filter(method => method !== missing) };
      assert.equal(canUploadOwnerPhoto(), false, missing);
    }
    for (const scope of [
      { ...device, capabilities: ['todo'] } as ClientScope,
      { ...device, capabilities: ['settings', 'todo'], secure: false } as ClientScope,
      { kind: 'person', personId: 'per_photo', deviceId: 'dev_other', tokenId: 'tok_photo', secure: true } as ClientScope,
    ]) { session.value = sessionInfo(table, scope); assert.equal(canUploadOwnerPhoto(), false); }
    session.value = sessionInfo(table, { kind: 'owner' });
    assert.equal(canUploadOwnerPhoto(), true);
    const source = readFileSync(new URL('../../../src/ui/settings/GeneralPage.tsx', import.meta.url), 'utf8');
    assert.ok(source.includes('{photoUpload && <button'));
    assert.ok(source.includes('if (!canUploadOwnerPhoto()) return;'));
    assert.ok(source.includes('{!locked && <button type="button" class="button ghost small"'), 'remove only needs profile authority');
    assert.ok(source.includes('Uploading a photo needs file access'));
  } finally { session.value = null; }
});
