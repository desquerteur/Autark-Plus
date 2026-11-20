// Electron window check: one browser button in the title row, not two (Noriel, 19 Nov). Demo engine, isolated profile:
//   * in a chat the chat header has no globe of its own; the frame's right-hand cell (left of feedback) is the globe –
//     Chat tabs: it opens and closes the chat's area, pressed while open;
//   * nowhere is the old "browsers" icon left in the title row;
//   * outside a chat (the day page) the same cell, same place, shows and hides the global browser pane;
//   * one browser at a time: back in the chat with the global pane open, the globe opens the chat's tabs and closes the pane;
//   * no renderer errors.
// Run: npm run test:ui   (needs a fresh build)   SCREENSHOTS=<dir> keeps the screenshots.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { connect } from '../e2e/lib/runtime-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

test('title row: one browser button – the globe in the right-hand cell, chat tabs in a chat, the global pane elsewhere', { timeout: 180_000 }, async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'workforce-one-browser-'));
  const shots = process.env.SCREENSHOTS ? path.resolve(process.env.SCREENSHOTS) : path.join(profile, 'shots');
  await mkdir(shots, { recursive: true });
  const app = await electron.launch({
    executablePath: electronPath, args: [root], cwd: root, timeout: 60_000,
    env: { ...process.env, WORKFORCE_TEST_DATA: profile, WORKFORCE_FAKE_ENGINE: '1', ELECTRON_ENABLE_LOGGING: '0' },
  });
  let rpc;
  t.after(async () => {
    rpc?.close?.();
    await app.close().catch(() => undefined);
    if (!process.env.SCREENSHOTS) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => undefined);
  });

  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.waitForSelector('.shell', { timeout: 60_000 });
  await app.evaluate(({ BrowserWindow }) => { const [win] = BrowserWindow.getAllWindows(); win.setSize(1280, 820); });
  const info = JSON.parse(await readFile(path.join(profile, 'runtime.json'), 'utf8'));
  rpc = await connect(info.port, info.token, 'cli');
  await rpc.call('settings.update', { onboarding: { step: 'done' } });
  const manager = (await rpc.call('agents.list')).find((agent) => agent.template === 'manager');
  const chat = await rpc.call('chats.create', { title: 'One browser', agentIds: [manager.id] });

  // ---- in a chat
  await page.evaluate((id) => { location.hash = `#/chat/${id}`; }, chat.id);
  await page.locator('.chat-header').waitFor({ timeout: 15_000 });
  const cell = page.locator('.frame-workspace-cell');
  await cell.waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('.chat-header [data-cell="browser"]').count(), 0, 'the chat header has no globe of its own');
  assert.equal(await cell.getAttribute('data-cell'), 'browser', 'in a chat the right-hand cell is the chat\'s browser');
  const button = cell.locator('button');
  assert.equal(await button.getAttribute('aria-label'), 'Chat tabs');
  const icons = await page.evaluate(() => [...document.querySelectorAll('.frame-workspace-cell, .chat-header, .frame-feedback-cell')]
    .flatMap((node) => [...node.querySelectorAll('.icon')].map((icon) => icon.style.getPropertyValue('--icon'))));
  assert.ok(!icons.some((name) => /browsers/.test(name)), `no "browsers" icon left in the title row (${icons.join(', ')})`);
  const box = await cell.boundingBox();
  const feedback = await page.locator('.frame-feedback-cell').boundingBox();
  assert.ok(box && feedback && box.x + box.width <= feedback.x + 1 && feedback.x - (box.x + box.width) < 12, 'the globe sits right before the feedback cell');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, 'one-browser-chat.png') });
  assert.notEqual(await button.getAttribute('aria-pressed'), 'true');
  await button.click();
  await page.waitForFunction(() => document.querySelector('.frame-workspace-cell button')?.getAttribute('aria-pressed') === 'true', undefined, { timeout: 10_000 });
  assert.equal(await page.locator('.global-pane').count(), 0, 'the chat\'s tabs, not the global pane');
  await page.screenshot({ path: path.join(shots, 'one-browser-chat-open.png') });
  await button.click();
  await page.waitForFunction(() => document.querySelector('.frame-workspace-cell button')?.getAttribute('aria-pressed') !== 'true', undefined, { timeout: 10_000 });
  const after = await cell.boundingBox();
  assert.ok(after && Math.abs(after.x - box.x) < 1, 'the cell does not move');

  // ---- outside a chat: the same cell, the global pane
  await page.evaluate(() => { location.hash = '#/day'; });
  await page.waitForFunction(() => document.querySelector('.frame-workspace-cell')?.getAttribute('data-cell') === 'workspace', undefined, { timeout: 10_000 });
  const elsewhere = await cell.boundingBox();
  assert.ok(elsewhere && Math.abs(elsewhere.x - box.x) < 1, 'same place outside a chat');
  await cell.locator('button').click();
  await page.locator('.global-pane').waitFor({ timeout: 10_000 });
  await page.screenshot({ path: path.join(shots, 'one-browser-day-pane.png') });
  await cell.locator('button').click();
  await page.locator('.global-pane').waitFor({ state: 'detached', timeout: 10_000 });

  // ---- one browser at a time: a global pane opened elsewhere gives way when the chat's tabs open
  await cell.locator('button').click();
  await page.locator('.global-pane').waitFor({ timeout: 10_000 });
  await page.evaluate((id) => { location.hash = `#/chat/${id}`; }, chat.id);
  await page.waitForFunction(() => document.querySelector('.frame-workspace-cell')?.getAttribute('data-cell') === 'browser', undefined, { timeout: 10_000 });
  await cell.locator('button').click();
  await page.locator('.chat-area').waitFor({ timeout: 10_000 });
  await page.locator('.global-pane').waitFor({ state: 'detached', timeout: 10_000 });
  assert.equal(await cell.locator('button').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: path.join(shots, 'one-browser-switch.png') });
  await cell.locator('button').click();
  await page.locator('.chat-area').waitFor({ state: 'detached', timeout: 10_000 });

  assert.deepEqual(errors, [], 'no renderer errors');
});
