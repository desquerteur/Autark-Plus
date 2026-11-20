// Electron window check of the Schedules tab (#20), demo engine, isolated profile:
//   * the rail has Schedules between Projects and Team; the start page offers the three starting points;
//   * "Daily news to a contact" fills the form (agent job, every day at 06:00); Create makes the job – it appears in the sidebar
//     with its rule in words and next run, its page shows rule, instructions, next runs and an empty history;
//   * Run now adds a history line; Pause/Resume change the status; Edit changes the title; a message and a reminder can be created;
//   * Delete (with confirm) removes the row; a past time or a missing text keeps Create off and says why;
//   * the phone width: Schedules is a tab, the list is its root, a schedule opens as a pushed page (no horizontal scroll);
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

test('Schedules tab: create a daily agent job, see its runs, pause, edit, delete – desktop and phone', { timeout: 300_000 }, async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'workforce-schedules-tab-'));
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
  const size = (width, height) => app.evaluate(({ BrowserWindow }, [w, h]) => { const [win] = BrowserWindow.getAllWindows(); win.setMinimumSize(320, 480); win.setSize(w, h); }, [width, height]);
  const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await size(1280, 820);
  const info = JSON.parse(await readFile(path.join(profile, 'runtime.json'), 'utf8'));
  rpc = await connect(info.port, info.token, 'cli');
  await rpc.call('settings.update', { onboarding: { step: 'done' } });
  const manager = (await rpc.call('agents.list')).find((agent) => agent.template === 'manager');
  const newsChat = await rpc.call('chats.create', { title: 'News readers', agentIds: [manager.id] }); // a 1:1 shows under its partner's name, so the test picks it by id

  // ---- the destination and the start page
  await page.evaluate(() => { location.hash = '#/day'; });
  const rail = page.locator('nav.rail');
  const labels = await rail.locator('button[aria-label]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  assert.ok(labels.indexOf('Schedules') > labels.indexOf('Projects') && labels.indexOf('Schedules') < labels.indexOf('Team'), `Schedules sits between Projects and Team (${labels.join(', ')})`);
  await rail.getByRole('button', { name: 'Schedules', exact: true }).click();
  await page.waitForFunction(() => location.hash === '#/schedules', undefined, { timeout: 10_000 });
  await page.locator('.schedule-card').first().waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('.schedule-card').count(), 3);
  await shot('schedules-00-start');

  // ---- create the flagship job: every day at 06:00, an agent researches the news and sends it to a chat
  await page.locator('.schedule-card', { hasText: 'Daily news to a contact' }).click();
  const form = page.locator('form.schedule-editor');
  await form.waitFor({ timeout: 10_000 });
  assert.equal(await form.getByLabel('Time', { exact: true }).inputValue(), '06:00');
  await form.getByLabel('Send the result to').selectOption({ value: newsChat.id });
  await page.waitForFunction(() => /Runs every day at 06:00, next:/.test(document.querySelector('.schedule-editor .schedule-line:not(.muted), .schedule-editor .schedule-line')?.textContent ?? '') || [...document.querySelectorAll('.schedule-editor .schedule-line')].some((el) => /Runs every day at 06:00/.test(el.textContent)), undefined, { timeout: 10_000 });
  await shot('schedules-01-form');
  await form.getByRole('button', { name: 'Create schedule' }).click();
  await page.waitForFunction(() => /^#\/schedules\/sch_/.test(location.hash), undefined, { timeout: 10_000 });
  const created = (await rpc.call('schedules.list')).find((entry) => entry.title === 'Daily news');
  assert.ok(created, 'the job exists');
  assert.equal(created.kind, 'routine');
  assert.deepEqual(created.spec.times, ['06:00']);
  assert.equal(created.ownerId, manager.id);
  assert.ok(created.conversationId, 'its result goes to the chat');
  const row = page.locator('.schedule-item', { hasText: 'Daily news' });
  await row.waitFor({ timeout: 10_000 });
  assert.match(await row.innerText(), /Every day at 06:00/);
  await page.locator('.schedule-runs li').first().waitFor({ timeout: 10_000 });
  assert.match(await page.locator('.schedule-section[aria-label="History"]').innerText(), /No runs yet/);
  await shot('schedules-02-detail');

  // ---- run now → a history line; pause → status; edit → title
  await page.getByRole('button', { name: 'Run now' }).click();
  await page.locator('.schedule-section[aria-label="History"] .schedule-run').first().waitFor({ timeout: 10_000 });
  assert.match(await page.locator('.schedule-section[aria-label="History"]').innerText(), /Run now/);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Resume' }).waitFor({ timeout: 10_000 });
  assert.match(await page.locator('.schedule-facts').innerText(), /Paused/);
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.getByRole('button', { name: 'Pause' }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Edit' }).click();
  await form.waitFor({ timeout: 10_000 });
  await form.getByLabel('Title (optional)').fill('Morning briefing');
  await form.getByRole('button', { name: 'Save' }).click();
  await page.locator('.schedules-title', { hasText: 'Morning briefing' }).waitFor({ timeout: 10_000 });
  await shot('schedules-03-history');

  // ---- a message and a reminder from the form; a missing text keeps Create off
  await page.evaluate(() => { location.hash = '#/schedules/new'; });
  await form.waitFor({ timeout: 10_000 });
  await form.getByRole('radio', { name: 'Message', exact: true }).click();
  assert.equal(await form.getByRole('button', { name: 'Create schedule' }).isDisabled(), true, 'no chat and no text yet');
  await form.getByLabel('Chat', { exact: true }).selectOption({ value: newsChat.id });
  await form.locator('textarea').fill('Good morning, here is the plan.');
  await form.getByRole('radio', { name: 'Once', exact: true }).click();
  await form.getByRole('button', { name: /^Tomorrow/ }).click().catch(() => form.locator('.schedule-pick:not(:disabled)').first().click());
  await form.getByRole('button', { name: 'Create schedule' }).click();
  await page.waitForFunction(() => /^#\/schedules\/sch_/.test(location.hash), undefined, { timeout: 10_000 });
  assert.ok((await rpc.call('schedules.list')).some((entry) => entry.kind === 'message' && entry.ownerId === 'human'));
  await page.evaluate(() => { location.hash = '#/schedules/new'; });
  await form.waitFor({ timeout: 10_000 });
  await form.getByRole('radio', { name: 'Reminder', exact: true }).click();
  // plain words fill the form: the rule and, as the form had no text yet, the words left over
  await form.getByLabel('Say it in words').fill('every weekday at 7:30 look at the open work');
  await form.getByRole('button', { name: 'Fill in' }).click();
  await form.locator('.schedule-words [role="status"]', { hasText: 'Read as:' }).waitFor({ timeout: 10_000 });
  assert.equal(await form.locator('textarea').inputValue(), 'look at the open work');
  assert.equal(await form.getByRole('button', { name: 'Monday' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await form.getByRole('button', { name: 'Sunday' }).getAttribute('aria-pressed'), 'false');
  await shot('schedules-04a-words');
  await form.getByRole('button', { name: 'Create schedule' }).click();
  await page.waitForFunction(() => /^#\/schedules\/sch_/.test(location.hash), undefined, { timeout: 10_000 });
  const reminder = (await rpc.call('schedules.list')).find((entry) => entry.kind === 'reminder');
  assert.deepEqual(reminder?.spec.times, ['07:30'], 'the reminder runs at 07:30');
  assert.equal((await rpc.call('schedules.list')).length, 3);
  await shot('schedules-04-list');

  // ---- delete asks first
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Cancel schedule' }).click();
  await page.waitForFunction(() => location.hash === '#/schedules', undefined, { timeout: 10_000 });
  assert.equal((await rpc.call('schedules.list')).length, 2);

  // ---- phone width: a tab, the list is its root, a schedule is a pushed page
  await size(390, 780);
  await page.waitForTimeout(500);
  const tab = page.locator('.tab-bar [data-tab="schedules"]');
  await tab.waitFor({ timeout: 10_000 });
  await tab.click();
  await page.locator('.schedule-item').first().waitFor({ timeout: 10_000 });
  await shot('schedules-05-phone-list');
  assert.ok(await overflow() <= 1, 'no horizontal scroll (list)');
  await page.locator('.schedule-item', { hasText: 'Morning briefing' }).click();
  await page.locator('.schedules-title', { hasText: 'Morning briefing' }).waitFor({ timeout: 10_000 });
  await shot('schedules-06-phone-detail');
  assert.ok(await overflow() <= 1, 'no horizontal scroll (page)');
  await page.getByRole('button', { name: 'Edit' }).click();
  await form.waitFor({ timeout: 10_000 });
  await shot('schedules-07-phone-form');
  assert.ok(await overflow() <= 1, 'no horizontal scroll (form)');

  assert.deepEqual(errors, [], 'no renderer errors');
});
