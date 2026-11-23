// W2-PH (owner: every setting from the phone, nothing has to be done on the PC): on the owner's paired phone (a secure
// session with the device token's FULL_ACCESS, answered by the real handler table) the Settings list holds every page
// and each opens as itself; plain LAN http drops the ones that need the secure tunnel. On the phone a file or folder of the
// PC opens in the pane's sheet (never the PC's own app, files.openPath), a sign-in page that runs on the PC opens in the
// PC's pane (side.open), a terminal sign-in says it opened on the PC, and the pages no longer hide their rows behind the
// desktop window (source checks: the backup and export rows, the Apps rows that run on the PC, the own Google app).
// Owns: these assertions only. Never: a DOM, a socket or a real PC (rpc.call and the session are stubbed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandlerTable } from '../../../src/runtime/rpc/handlers/index.ts';
import { sessionInfo } from '../../../src/runtime/rpc/handlers/session.ts';
import { FULL_ACCESS } from '../../../src/runtime/pwa/tokens.ts';
import type { ClientScope } from '../../../src/shared/api/protocol.ts';
import { platform } from '../../../src/ui/lib/platform.ts';
import { rpc } from '../../../src/ui/lib/rpc.ts';
import { can, canEditOwnerSettings, session } from '../../../src/ui/lib/session.ts';
import { signInHint } from '../../../src/ui/settings/providers.ts';
import { resolveVisibleSection, SECTIONS, visibleSections } from '../../../src/ui/settings/sections.ts';
import { phonePaneOpen } from '../../../src/ui/workspace/phone-pane.ts';
import { openInPcPane, opensInPcPane, showOpenedOnPc } from '../../../src/ui/workspace/phone-tabs.ts';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/ui');
const table = createHandlerTable();
const PHONE: ClientScope = { kind: 'device', deviceId: 'dev_phone0000001', capabilities: [...FULL_ACCESS], secure: true };
const as = (scope: ClientScope) => { session.value = sessionInfo(table, scope); };
const ids = (list: ReadonlyArray<{ id: string }>) => list.map((section) => section.id);

const calls: Array<[string, unknown]> = [];
Object.assign(rpc, {
  call: async (method: string, params?: unknown) => {
    calls.push([method, params]);
    if (method === 'side.open') return { ok: true, tab: 'web-1' };
    throw new Error(`unexpected ${method}`);
  },
});

test('the owner\'s phone lists every Settings page and opens each as itself; plain LAN http keeps the ones without the tunnel', () => {
  try {
    assert.equal(platform, 'pwa', 'these tests run as the phone');
    as(PHONE);
    assert.deepEqual(ids(visibleSections(can)), ids(SECTIONS), 'every page');
    for (const section of SECTIONS) assert.equal(resolveVisibleSection(section.id, can).id, section.id, section.id);
    assert.equal(canEditOwnerSettings(), true, 'profile, day, calendar app: the owner\'s');
    for (const method of ['system.backup', 'system.restore', 'chats.export', 'system.root', 'calendar.addIcs', 'calendar.connectGoogle', 'skills.delete',
      'modes.delete', 'secrets.export', 'privacy.purgeProviderHistory', 'feedback.inboxList', 'files.writePath', 'side.open'] as const) {
      assert.equal(can(method), true, method);
    }
    assert.equal(can('files.openPath'), false, "the PC's own file manager stays on the PC");
    as({ ...PHONE, secure: false });
    const lan = ids(visibleSections(can));
    assert.ok(!lan.includes('secrets') && !lan.includes('apps'), `secrets and apps need the tunnel (${lan.join(', ')})`);
    assert.ok(lan.includes('general') && lan.includes('about'), 'the rest stays listed');
  } finally { session.value = null; }
});

test('on the phone the PC\'s files open in the pane\'s sheet, never in an app on the PC\'s screen (open-file.ts)', () => {
  // open-file.ts imports controls.tsx (act), which plain node does not load: its phone branches are read from the source
  const open = readFileSync(path.join(SRC, 'settings/open-file.ts'), 'utf8');
  assert.match(open, /const onPhone = \(\): boolean => platform !== 'desktop';/);
  assert.match(open, /if \(isMobile\.peek\(\) && !onPhone\(\)\) return openInData\(relative, base\);/, 'only a narrow desktop window hands the file to the PC\'s app');
  assert.match(open, /if \(onPhone\(\)\) return act\(\(\) => openPathTab\(path\), 'Could not open it'\);/, 'a folder the page got back opens in the pane');
  assert.match(open, /if \(onPhone\(\)\) return openInTab\(relative, base\);/, '"Open with system" on the phone: the pane too');
  assert.match(readFileSync(path.join(SRC, 'settings/AboutPage.tsx'), 'utf8'), /const open = \(path: string\) => void openPathHere\(path\);/);
});

test('a sign-in page that runs on the PC opens in the PC\'s pane and the phone\'s sheet opens on it', async () => {
  try {
    as(PHONE);
    assert.equal(opensInPcPane(), true);
    calls.length = 0;
    phonePaneOpen.value = false;
    await openInPcPane('https://accounts.google.com/o/oauth2/v2/auth?state=s1');
    assert.deepEqual(calls, [['side.open', { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=s1' }]]);
    assert.equal(phonePaneOpen.value, true);
    as({ ...PHONE, capabilities: FULL_ACCESS.filter((held) => held !== 'manage') });
    assert.equal(opensInPcPane(), false, 'without the pane the page keeps its own line');
  } finally { session.value = null; phonePaneOpen.value = false; }
});

test('a plan sign-in started from the phone keeps the one tab the runtime opened on the PC: its sheet opens, no side.open', () => {
  // accounts.login from a device already opens its page in the PC's pane (runtime rpc/handlers/providers.ts openOnPc);
  // a second side.open from here put the same consent (one loopback, one state) into two tabs (finding "I found no_0")
  try {
    as(PHONE);
    calls.length = 0;
    phonePaneOpen.value = false;
    assert.equal(showOpenedOnPc(), true);
    assert.equal(phonePaneOpen.value, true, "the sheet shows the PC's tab");
    assert.deepEqual(calls, [], 'nothing opens a second tab');
    phonePaneOpen.value = false;
    as({ ...PHONE, capabilities: FULL_ACCESS.filter((held) => held !== 'manage') });
    assert.equal(showOpenedOnPc(), false, 'without the PC\'s pane here the page opens as before');
    as({ kind: 'owner' });
    assert.equal(showOpenedOnPc(), false, "the owner's window: the runtime opened nothing, the page opens itself");
    assert.equal(phonePaneOpen.value, false);
    const actions = readFileSync(path.join(SRC, 'settings/account-actions.ts'), 'utf8');
    assert.match(actions, /if \(!showOpenedOnPc\(\)\) openExternal\(result\.url\);/);
    assert.doesNotMatch(actions, /openInPcPane|side\.open'/, 'startLogin never opens the page in the pane itself');
  } finally { session.value = null; phonePaneOpen.value = false; }
});

test('a terminal or window sign-in started from the phone says it opened on the PC', () => {
  assert.match(signInHint('copilot', true), /terminal window that opened on your PC/);
  assert.match(signInHint('kimi-cli', true), /terminal window that opened on your PC, then come back here\.$/);
  assert.equal(signInHint('gemini-cli', true), 'Finish it in the window that opened on your PC.');
  const actions = readFileSync(path.join(SRC, 'settings/account-actions.ts'), 'utf8');
  assert.match(actions, /signInHint\(provider, platform !== 'desktop'\)/);
  assert.doesNotMatch(signInHint('copilot'), /your PC/, 'the PC window keeps its words');
});

test('the pages gate their rows by what the session may call, not by the desktop window', () => {
  const read = (file: string) => readFileSync(path.join(SRC, 'settings', file), 'utf8');
  const about = read('AboutPage.tsx');
  assert.match(about, /\{can\('system\.backup'\) && <BackupRows \/>\}/);
  assert.match(about, /\{can\('chats\.export'\) && <ChatExportRow \/>\}/);
  assert.doesNotMatch(about, /platform === 'desktop'|'files\.openPath'/, 'no desktop-only rows, no PC file manager call of its own');
  assert.match(about, /!updates && pcUpdateLine\(update, preferences\.value\.autoDownloadUpdates\)/, 'the phone says what the PC does with a waiting update');
  assert.match(about, /reserve=\{updates \? true : 2\}/, 'its two lines are reserved, nothing moves');
  const add = read('apps-add.tsx');
  assert.match(add, /const onPc = \(\): boolean => can\('files\.writePath'\)/);
  assert.doesNotMatch(add, /!isOwner\(\) && (kind|servers)|isOwner\(\) \? SERVER_KINDS|isOwner\(\) && can\('files\.writePath'\)/, 'command servers and the mailbox follow onPc');
  const apps = read('AppsPage.tsx');
  assert.match(apps, /openInPcPane\(app\.signInUrl!\)/);
  assert.match(apps, /app\.transport !== 'mail' \|\| can\('files\.writePath'\)/);
  assert.match(read('calendar-sources.tsx'), /canEditOwnerSettings\(\) && <OwnGoogleApp \/>/);
});
