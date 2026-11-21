// #34: create a For me reminder in the real Schedules form, wait for it, complete in My day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { connect } from '../e2e/lib/runtime-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const executablePath = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

test('Schedules person reminder → My day → matching history done, on desktop and phone', { timeout: 180_000 }, async t => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'autark-my-day-reminder-'));
  const app = await electron.launch({ executablePath, args: [root], cwd: root, env: { ...process.env, WORKFORCE_TEST_DATA: profile, WORKFORCE_FAKE_ENGINE: '1' } });
  let rpc;
  t.after(async () => {
    rpc?.close(); await app.close().catch(() => {});
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForSelector('.shell', { timeout: 60_000 });
  const info = JSON.parse(await readFile(path.join(profile, 'runtime.json'), 'utf8'));
  rpc = await connect(info.port, info.token, 'cli');
  await rpc.call('settings.update', { onboarding: { step: 'done' } });
  for (const width of [1280, 390]) {
    await app.evaluate(({ BrowserWindow }, width) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(320, 480); w.setSize(width, 820); }, width);
    await page.evaluate(() => { location.hash = '#/schedules/new'; });
    const form = page.locator('form.schedule-editor');
    await form.waitFor();
    await form.getByRole('radio', { name: 'For me', exact: true }).click();
    await form.getByLabel('Title (optional)').fill(`Stretch ${width}`);
    await form.locator('textarea').fill('Take a short walk');
    await form.getByRole('radio', { name: 'Once', exact: true }).click();
    await form.getByRole('button', { name: /^Tomorrow/ }).click();
    await form.getByRole('button', { name: 'Create schedule' }).click();
    await page.waitForFunction(() => /^#\/schedules\/sch_/.test(location.hash));
    const schedule = (await rpc.call('schedules.list')).find(s => s.title === `Stretch ${width}`);
    assert.ok(schedule);
    // Move the form-created reminder to a near due time; exercise the real scheduler, not Run now.
    await rpc.call('schedules.update', { id: schedule.id, spec: { at: Date.now() + 1500 } });
    await page.evaluate(() => { location.hash = '#/day'; });
    const row = page.locator('.todo-item', { hasText: `Stretch ${width}` });
    await row.waitFor({ timeout: 15_000 });
    await row.getByRole('button', { name: 'Open source schedule' }).click();
    await page.waitForFunction(id => location.hash === `#/schedules/${id}`, schedule.id);
    await page.evaluate(() => { location.hash = '#/day'; });
    await row.getByRole('button', { name: `Done: Stretch ${width}`, exact: true }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('.todo-item:not(.leaving)')].some(n => n.textContent.includes('Stretch')));
    const after = (await rpc.call('schedules.list')).find(s => s.id === schedule.id);
    assert.equal(after.history.length, 1);
    assert.equal(after.history[0].personActions.at(-1).state, 'done');
    await page.evaluate(id => { location.hash = `#/schedules/${id}`; }, schedule.id);
    await page.locator('.schedule-run-outcome', { hasText: 'Done' }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  assert.deepEqual(errors, []);
});
