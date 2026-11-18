// fb_1m7mtty0aszywt5y0 (17.11.2026): the person's browser speaks as plain Chrome – hCaptcha (Discord) stalled on the
// Electron user agent. Only Electron's and the app's tokens go.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeUserAgent, WorkspaceSession } from '../../../src/main/workspace-session.ts';

const ELECTRON = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) autark/0.3.9 Chrome/157.0.8103.50 Electron/40.1.0 Safari/537.36';

test('Electron and app tokens go, Chrome, WebKit and Safari stay', () => {
  assert.equal(chromeUserAgent(ELECTRON), 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.8103.50 Safari/537.36');
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
  assert.equal(chromeUserAgent(chrome), chrome, 'a plain Chrome agent is unchanged');
  assert.equal(chromeUserAgent(ELECTRON.replace('autark/', 'Autark/')), chromeUserAgent(ELECTRON));
});

test('the workspace session sets it once at start', () => {
  let set = '';
  const session = {
    getUserAgent: () => ELECTRON, setUserAgent: (agent: string) => { set = agent; },
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {}, on() {},
  };
  new WorkspaceSession(session as never, { tabOf: () => undefined, changed() {} }, { reveal() {} });
  assert.doesNotMatch(set, /Electron|autark/i);
  assert.match(set, /Chrome\/157/);
});
