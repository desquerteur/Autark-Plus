// B-081: the watcher's picture box as the page's size, in real Electron – the caster (main/side-driver/caster.ts) on a
// local page in a WebContentsView on the real off-screen host (main/workspace-host.ts PageHost, 1280×800), set up like a
// side-browser tab, with the real side driver. `on` with view 420×860: the host gives the page that size (its window
// grows to hold it), the screencast frames say deviceWidth/Height 420×860 and their JPEG has that shape, the page's own
// viewport is 420 wide, an agent's screenshot is 420×860 CSS px; a click mapped the runtime's way (view-input.ts
// inputCommands on side-view.ts sideMeta) lands; a press of the person here (SideTab.localPress) gives the page its own
// 1280×800 again, the watcher's next click lands on that and takes the box again; `off` gives the page 1280×800 again.
// (A DevTools viewport override was tried first: its frames kept the view's own landscape box – measured 08.11.2026.) The caster and driver are bundled by the test
// (esbuild); no app profile, no external sites. Written for B-081, run with the window tests.
// Owns: these paths. Never: touches the person's profile.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright-core';
import { inputCommands } from '../../src/runtime/browser/view-input.ts';
import { sideMeta } from '../../src/runtime/browser/side-view.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TAB = 'web-t1';
const VIEW = { width: 420, height: 860 };

const PAGE = `<!doctype html><title>Size test</title>
<style>body{font:16px system-ui;margin:0} button{font-size:18px;padding:10px 24px;margin:300px 0 0 40px}
#dot{width:12px;height:12px;border-radius:6px;background:#1570d6;animation:spin 1s linear infinite;position:fixed;top:8px;left:8px}
@keyframes spin{from{transform:translateX(0)}to{transform:translateX(200px)}}</style>
<div id="dot"></div>
<button id="go">Go</button>
<script>
  let clicks = 0;
  document.getElementById('go').addEventListener('click', (e) => { clicks += 1; document.title = 'clicked ' + clicks + ' trusted=' + e.isTrusted + ' w=' + innerWidth; });
</script>`;

const HARNESS = `const { app, BrowserWindow, WebContentsView, nativeImage } = require('electron');
function jpegSize(b) { for (let i = 2; i + 9 < b.length;) { if (b[i] !== 0xff) return undefined; const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) }; i += 2 + len; } return undefined; }
app.setPath('userData', process.env.SIDE_TEST_DATA);
const { SideDriver, SideCaster, PageHost } = require(process.env.SIDE_BUNDLE);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1340, height: 880, show: true });
  await win.loadURL('data:text/html,<body style="margin:0;background:%23888">');
  const view = new WebContentsView({ webPreferences: { partition: 'side-size-test', sandbox: true, contextIsolation: true, nodeIntegration: false, safeDialogs: true, backgroundThrottling: true } });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
  const contents = view.webContents;
  contents.debugger.attach('1.3');
  const id = '${TAB}';
  const frames = [];
  const driver = new SideDriver({
    browser: () => ({
      sideTabs: () => ({ pages: [{ id, url: contents.getURL(), title: contents.getTitle() }], active: id }),
      sideContents: (tab) => (tab === id ? contents : undefined),
      sideOpen: () => { throw new Error('No new tabs in this test.'); },
      sideClose: () => { throw new Error('No.'); },
      sideKeep: () => {},
    }),
  });
  driver.tab(id, contents);
  const host = new PageHost(() => {});
  host.take(id, view); // nobody here shows the tab: it paints on the off-screen host, as a watched tab does
  const caster = new SideCaster({
    tab: (tab) => driver.side(tab),
    size: (tab, box) => host.size(tab, box),
    send: (update) => {
      if (!update.frame) return;
      const bytes = Buffer.from(update.frame.data, 'base64');
      const size = jpegSize(bytes) ?? nativeImage.createFromBuffer(bytes).getSize(); // the JPEG's own pixels (nativeImage may scale by the display)
      frames.push({ at: Date.now(), meta: update.frame.meta, jpeg: size });
    },
  });
  Object.assign(globalThis, { caster, driver, frames, sideView: view });
  await contents.loadURL(process.env.SIDE_PAGE);
  globalThis.sideReady = true;
});
app.on('window-all-closed', () => app.quit());
`;

test('a watched side tab takes the watcher\'s 420×860 box: frames, a mapped click, the hand-back here and the end', { timeout: 180_000 }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'workforce-side-size-'));
  const bundle = path.join(dir, 'side.cjs');
  await build({
    stdin: { contents: "export { SideDriver } from './src/main/side-driver/driver.ts'; export { SideCaster } from './src/main/side-driver/caster.ts'; export { PageHost } from './src/main/workspace-host.ts';", resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, external: ['electron'], logLevel: 'error',
  });
  const harness = path.join(dir, 'harness.cjs');
  await writeFile(harness, HARNESS);
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const page = `http://127.0.0.1:${server.address().port}/size`;
  const app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
    args: [harness], cwd: dir, timeout: 60_000,
    env: { ...process.env, SIDE_TEST_DATA: path.join(dir, 'data'), SIDE_BUNDLE: bundle, SIDE_PAGE: page },
  });
  t.after(async () => {
    await app.close().catch(() => {});
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  for (let n = 0; n < 200 && !(await app.evaluate(() => globalThis.sideReady === true)); n += 1) await sleep(100);
  const inPage = (code) => app.evaluate((_electron, source) => globalThis.sideView.webContents.executeJavaScript(source), code);
  const frames = () => app.evaluate(() => globalThis.frames);
  const until = async (what, check) => {
    for (let n = 0; n < 60; n += 1) { const value = await check(); if (value) return value; await sleep(100); }
    assert.fail(`timed out: ${what}`);
  };
  const near = (a, b) => Math.abs(a - b) <= 2;
  const sized = (frame, width, height) => near(frame.meta.deviceWidth, width) && near(frame.meta.deviceHeight, height);
  const cast = (args) => app.evaluate((_electron, value) => globalThis.caster.cast({ tab: 'web-t1', ...value }), args);
  const input = (commands) => app.evaluate((_electron, list) => globalThis.caster.input({ tab: 'web-t1', commands: list }), commands);
  /** A click on the element's middle as the watcher sees it on the newest frame, mapped back like the runtime does. */
  const click = async (selector) => {
    const last = (await frames()).at(-1);
    const rect = await inPage(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const { meta } = last;
    const point = { x: rect.x * meta.zoom, y: rect.y * meta.zoom, width: meta.deviceWidth, height: meta.deviceHeight };
    const mapped = sideMeta(meta);
    await input([
      ...inputCommands({ kind: 'mouse', type: 'down', ...point, button: 'left', clicks: 1 }, mapped),
      ...inputCommands({ kind: 'mouse', type: 'up', ...point, button: 'left', clicks: 1 }, mapped),
    ]);
  };

  // 1. on with the watcher's box: the frames have its size, the JPEG its shape, the page its width
  assert.equal(await inPage('innerWidth'), 1280, 'the view\'s own size first');
  assert.equal((await cast({ on: true, view: VIEW })).ok, true);
  const first = await until('a 420×860 frame', async () => (await frames()).find((frame) => sized(frame, 420, 860)));
  t.diagnostic(`watched frame: ${JSON.stringify(first)}`);
  assert.ok(Math.abs(first.jpeg.width / first.jpeg.height - 420 / 860) < 0.02, `the JPEG has the watcher's shape (${first.jpeg.width}×${first.jpeg.height})`);
  assert.equal(await inPage('innerWidth'), 420);
  assert.equal(await inPage('innerHeight'), 860);
  const shot = await app.evaluate(() => globalThis.driver.call({ action: 'screenshot', agent: { id: 'ag_1', name: 'Ada' }, tab: 'web-t1' }));
  assert.equal(shot.ok, true, shot.error);
  assert.deepEqual([shot.image.width, shot.image.height], [420, 860], 'an agent\'s screenshot has the watcher\'s size');

  // 2. a click mapped on the 420×860 frame lands on the button
  await sleep(300);
  await click('#go');
  assert.equal(await until('the click', () => inPage('document.title.startsWith("clicked") && document.title')), 'clicked 1 trusted=true w=420');

  // 3. a press of the person here: the page fits its own 1280×800 view again
  await sleep(1200); // past the watcher's echo window
  await app.evaluate(() => globalThis.driver.side('web-t1').localPress?.());
  await until('the page\'s own size again', async () => (await inPage('innerWidth')) === 1280);
  await until('a 1280×800 frame', async () => sized((await frames()).at(-1), 1280, 800));

  // 4. the watcher's next click lands on that frame, then the page takes the watcher's box again
  await sleep(300);
  await click('#go');
  assert.equal(await until('the second click', () => inPage('document.title.startsWith("clicked 2") && document.title')), 'clicked 2 trusted=true w=1280');
  await until('the watcher\'s box again', async () => (await inPage('innerWidth')) === 420);
  await until('a 420×860 frame again', async () => sized((await frames()).at(-1), 420, 860));

  // 5. off: the page has the host's own size again
  await cast({ on: false });
  await until('the native size after the watch', async () => (await inPage('innerWidth')) === 1280);
  assert.equal(await inPage('innerHeight'), 800);
  assert.equal(await app.evaluate(() => globalThis.caster.watched('web-t1')), false);
});
