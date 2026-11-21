// #30, real Electron: Settings › Appearance › Scale makes the whole app larger or smaller, live, and keeps it.
// - the slider to 150 %: settings.json › appearance.uiScale, <html> zoomed 1.5 at once; the phone value stays 100;
// - at 150 % and at 80 % the main views keep their layout: no sideways scroll on Day, a chat (sidebar, composer),
//   Settings and Schedules, the composer inside the window, a menu opens beside its button, and a website lies
//   exactly in its slot in the chat's tabs;
// - a 1000 px window at 150 % has less than 720 px of room and takes the phone layout (as a narrow window does);
//   the narrowest window (640 px) is the phone layout at 150 % and the desktop one at 80 %, both intact;
//   (a real phone – the web app on a touch screen with its own value – is test/e2e/pwa-scale.test.mjs);
// - Ctrl − steps down to 80 and no further, Ctrl 0 back to 100, Ctrl = one step up – outside a website tab;
// - after a restart the scale is the same.
// Screenshots: SCREENSHOTS names the folder. A temp profile, the demo engine, a local fixture server.
// Owns: these user paths. Never: touches the person's profile or external websites.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { connect } from '../e2e/lib/runtime-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settingsOf = async (profile) => {
  const text = await readFile(path.join(profile, 'settings.json'), 'utf8');
  return JSON.parse(text.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n').replace(/,(\s*[}\]])/g, '$1'));
};

test('#30 Settings › Appearance › Scale: live, app-wide, Ctrl +/−/0, layouts intact at 80 and 150 %, kept after a restart', { timeout: 400_000 }, async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'autark-ui-scale-'));
  const out = path.resolve(process.env.SCREENSHOTS ?? path.join(profile, 'shots'));
  await mkdir(out, { recursive: true });
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<title>Plan</title><style>body{font:18px system-ui;margin:0;padding:24px;background:#eef3ff}</style><h1>Plan</h1>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  const launch = () => electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
    args: [root], cwd: root, timeout: 60_000,
    env: { ...process.env, WORKFORCE_TEST_DATA: profile, WORKFORCE_FAKE_ENGINE: '1' },
  });
  let app = await launch();
  let rpc;
  let page;
  t.after(async () => {
    await page?.screenshot({ path: path.join(out, 'scale-last.png'), timeout: 5000 }).catch(() => {});
    rpc?.close?.();
    await app.close().catch(() => {});
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const errors = [];
  const size = (width, height) => app.evaluate(({ BrowserWindow }, box) => { BrowserWindow.getAllWindows()[0].setSize(box.width, box.height); }, { width, height });
  const open = async () => {
    page = await app.firstWindow();
    page.setDefaultTimeout(20_000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('.shell, .mobile-shell', { timeout: 60_000 });
    await size(1440, 900);
    rpc?.close?.();
    const info = JSON.parse(await readFile(path.join(profile, 'runtime.json'), 'utf8'));
    rpc = await connect(info.port, info.token, 'cli');
  };
  await open();
  await rpc.call('settings.update', { onboarding: { step: 'done' }, preferences: { theme: 'light' } });
  const manager = (await rpc.call('agents.list')).find((agent) => agent.template === 'manager');
  const chat = await rpc.call('chats.create', { title: 'Scale', agentIds: [manager.id] });
  await rpc.call('messages.send', { conversationId: chat.id, body: 'A first line to read at every size.' }).catch(() => undefined);
  const shot = async (name) => {
    await page.waitForTimeout(450);
    const data = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    await writeFile(path.join(out, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const until = async (what, check, ms = 20_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const value = await check();
      if (value) return value;
      if (Date.now() > end) assert.fail(`waited for ${what}`);
      await sleep(150);
    }
  };
  const look = async () => (await settingsOf(profile)).appearance;
  const zoom = () => page.evaluate(() => Number(getComputedStyle(document.documentElement).zoom));
  const go = async (hash, selector) => {
    await page.evaluate((to) => { location.hash = to; }, hash);
    await page.locator(selector).first().waitFor();
    await page.waitForTimeout(250);
  };
  /** Nothing scrolls sideways and the given parts lie inside the window. */
  const intact = async (where, selectors) => {
    const report = await page.evaluate((list) => {
      const doc = document.documentElement;
      const sideways = [doc, document.body, ...document.querySelectorAll('.shell, .mobile-shell, .settings-page, .settings-body, .chat-view, .schedules-page')]
        .filter((element) => element && element.scrollWidth > element.clientWidth + 2 && getComputedStyle(element).overflowX !== 'hidden')
        .map((element) => `${element.className || element.tagName}: ${element.scrollWidth} > ${element.clientWidth}`);
      const outside = [];
      for (const selector of list) {
        const element = document.querySelector(selector);
        if (!element) { outside.push(`${selector}: missing`); continue; }
        element.scrollIntoView({ block: 'nearest' });
        const r = element.getBoundingClientRect(); // a part taller than the window: its width only
        const tall = r.height > innerHeight;
        if (r.width < 4 || r.height < 4 || r.left < -1 || r.right > innerWidth + 1 || (!tall && (r.top < -1 || r.bottom > innerHeight + 1))) {
          outside.push(`${selector}: ${Math.round(r.left)},${Math.round(r.top)} – ${Math.round(r.right)},${Math.round(r.bottom)} in ${innerWidth}×${innerHeight}`);
        }
      }
      return { sideways, outside };
    }, selectors);
    assert.deepEqual(report.sideways, [], `${where}: nothing scrolls sideways`);
    assert.deepEqual(report.outside, [], `${where}: inside the window`);
  };
  const tour = async (label) => {
    await go('#/day', '.shell');
    await intact(`Day ${label}`, ['.shell']);
    await shot(`scale-${label}-01-day`);
    await go(`#/chat/${chat.id}`, 'textarea.composer-input');
    await intact(`chat ${label}`, ['textarea.composer-input', 'button.send-button']);
    await shot(`scale-${label}-02-chat`);
    await go('#/settings/appearance', '.appearance-page');
    await intact(`Settings ${label}`, ['#settings-scale']);
    await shot(`scale-${label}-03-settings`);
    await go('#/schedules', '.shell');
    await intact(`Schedules ${label}`, ['.shell']);
    await shot(`scale-${label}-04-schedules`);
  };

  // 1. The slider: 150 % at once, written for PCs only.
  await go('#/settings/appearance', '.appearance-page');
  const group = page.locator('#settings-scale');
  await group.waitFor();
  await shot('scale-100-settings');
  assert.equal(await zoom(), 1, 'a fresh install is at 100 %');
  await group.getByRole('slider', { name: 'On PCs' }).fill('150');
  await until('zoomed 1.5', async () => Math.abs((await zoom()) - 1.5) < 0.001);
  await until('saved', async () => (await look()).uiScale === 150);
  assert.equal((await look()).uiScalePhone, 100, 'the phone value stays');
  assert.equal(await group.locator('.scale-value').first().textContent(), '150 %');

  // 2. At 150 %: the main views, a menu beside its button, a website exactly in its slot.
  await tour('150');
  await go('#/settings/appearance', '.appearance-page');
  const newTheme = page.getByRole('button', { name: 'New theme…' });
  await newTheme.click();
  const menu = page.getByRole('menu').first();
  await menu.waitFor();
  const placed = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('New theme…'))?.getBoundingClientRect();
    const box = document.querySelector('[role=menu]')?.getBoundingClientRect();
    return button && box ? { dx: Math.abs(box.left - button.left), dy: box.top - button.bottom, inside: box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1 } : null;
  });
  assert.ok(placed && placed.dx < 40 && placed.dy > -4 && placed.dy < 40 && placed.inside, `the menu opens at its button at 150 %: ${JSON.stringify(placed)}`);
  await shot('scale-150-05-menu');
  await page.keyboard.press('Escape');
  await go(`#/chat/${chat.id}`, 'textarea.composer-input');
  await page.locator('.frame-workspace-cell[data-cell="browser"] button').click();
  await page.locator('textarea.composer-input').fill(`[[tool:browser.show {"url":"${address}/plan","where":"chat"}]]`);
  await page.locator('button.send-button').click();
  await until('the page exactly in the chat\'s tabs at 150 %', async () => {
    const area = await page.locator('.chat-area .browser-native-slot').evaluate((element) => { const r = element.getBoundingClientRect(); const z = Number(getComputedStyle(document.documentElement).zoom) || 1; return { x: r.left * z, y: r.top * z, right: r.right * z, bottom: r.bottom * z, raw: [r.left, r.top, r.right] }; }).catch(() => null);
    const views = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter((view) => view.constructor.name === 'WebContentsView' && view.getVisible() && view.getBounds().width > 10).map((view) => view.getBounds()));
    const match = (box) => views.some((view) => Math.abs(view.x - box.x) <= 3 && Math.abs(view.y - box.y) <= 3 && Math.abs(view.x + view.width - box.right) <= 3);
    // the slot in window pixels: getBoundingClientRect is in the page's own pixels or already zoomed, depending on Chromium
    return area && (match(area) || match({ x: area.raw[0], y: area.raw[1], right: area.raw[2] }));
  }, 40_000);
  await shot('scale-150-06-chat-with-page');
  await page.locator('.frame-workspace-cell[data-cell="browser"] button').click();

  // 3. A 1000 px window at 150 % has 667 px of room: the phone layout, as a narrow window has.
  await size(1000, 860);
  await until('the phone layout at 150 % in 1000 px', async () => (await page.locator('.mobile-shell').count()) === 1);
  await go('#/day', '.mobile-shell');
  await intact('1000 px at 150 %', ['.mobile-shell']);
  await shot('scale-150-07-narrow-window');
  await size(1440, 900);
  await until('the desktop layout again', async () => (await page.locator('.mobile-shell').count()) === 0);

  // 4. Keys: Ctrl − down to 80 and no further, Ctrl 0 back to 100, Ctrl = one up (outside a website tab).
  await go('#/day', '.shell');
  await page.locator('body').click({ position: { x: 5, y: 300 } }).catch(() => undefined);
  for (let i = 0; i < 9; i += 1) await page.keyboard.press('Control+Minus');
  await until('80 % by keys', async () => Math.abs((await zoom()) - 0.8) < 0.001);
  await until('80 saved', async () => (await look()).uiScale === 80);
  await page.locator('.toast', { hasText: 'Scale 80 %' }).first().waitFor({ timeout: 5000 }).catch(() => undefined);
  await tour('80');
  await page.keyboard.press('Control+0');
  await until('100 % by Ctrl 0', async () => Math.abs((await zoom()) - 1) < 0.001);
  await page.keyboard.press('Control+Equal');
  await until('110 % by Ctrl =', async () => Math.abs((await zoom()) - 1.1) < 0.001);
  await until('110 saved', async () => (await look()).uiScale === 110);

  // 5. The narrowest window (640 px): at 150 % the phone layout (427 px of room), at 80 % the desktop one (800 px).
  for (const [percent, shell] of [[150, '.mobile-shell'], [80, '.shell']]) {
    await rpc.call('settings.update', { appearance: { uiScale: percent } });
    await size(640, 860);
    await until(`${shell} at ${percent} % in 640 px`, async () => (await page.locator(shell).count()) === 1 && Math.abs((await zoom()) - percent / 100) < 0.001);
    await go(`#/chat/${chat.id}`, `${shell} textarea.composer-input`);
    await intact(`640 px chat ${percent} %`, [shell, 'textarea.composer-input', 'button.send-button']);
    await shot(`scale-${percent}-08-narrowest-chat`);
    await go('#/settings/appearance', `${shell} #settings-scale`);
    await intact(`640 px settings ${percent} %`, [shell, '#settings-scale .scale-control']);
    await shot(`scale-${percent}-09-narrowest-settings`);
    await size(1440, 900);
  }

  // 6. After a restart the scale is the same.
  await rpc.call('settings.update', { appearance: { uiScale: 130 } });
  await until('130 shown', async () => Math.abs((await zoom()) - 1.3) < 0.001);
  await app.close();
  app = await launch();
  await open();
  assert.equal((await look()).uiScale, 130, 'settings.json the same');
  await until('130 % after a restart', async () => Math.abs((await zoom()) - 1.3) < 0.001);
  await go('#/settings/appearance', '#settings-scale');
  assert.equal(await page.locator('#settings-scale .scale-value').first().textContent(), '130 %');
  await shot('scale-130-10-after-restart');
  await page.locator('#settings-scale .scale-value').first().click(); // the value is the way back to 100 %
  await until('back to 100', async () => (await look()).uiScale === 100 && Math.abs((await zoom()) - 1) < 0.001);
  assert.deepEqual(errors, [], 'no renderer exceptions');
  t.diagnostic(`screenshots: ${out}`);
});
