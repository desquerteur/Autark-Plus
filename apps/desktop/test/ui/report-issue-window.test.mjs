// Owns: the Electron check of Autark-Plus "Report issue": after Save the feedback menu shows the GitHub issue exactly
// as it would go out (title, labels from-app + bug, the body with version and OS, no chat id or e-mail), the two ticks
// add the page and the log excerpt only when ticked, and without a connected GitHub app "Open on GitHub" opens the
// prefilled github.com new-issue page. Settings › Feedback › Review offers the same preview. Light, dark and phone width.
// Never: contacts GitHub (shell.openExternal is caught), uses an isolated demo profile.
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

test('Report issue: preview after Save, ticks, and the prefilled GitHub page without a GitHub app', { timeout: 240_000 }, async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'workforce-report-issue-'));
  const shots = process.env.SCREENSHOTS ? path.resolve(process.env.SCREENSHOTS) : path.join(profile, 'shots');
  await mkdir(shots, { recursive: true });
  const env = { ...process.env, WORKFORCE_TEST_DATA: profile, WORKFORCE_FAKE_ENGINE: '1', ELECTRON_ENABLE_LOGGING: '0' };
  const app = await electron.launch({ executablePath: electronPath, args: [root], cwd: root, timeout: 60_000, env });
  let rpc;
  t.after(async () => {
    rpc?.close?.(); await app.close().catch(() => undefined);
    if (!process.env.SCREENSHOTS) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => undefined);
  });
  await app.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openExternal = async (url) => { globalThis.__opened.push(String(url)); };
  });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('.shell', { timeout: 60_000 });
  const size = (width, height) => app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(320, 320);
    win.setContentSize(w, h);
  }, [width, height]);
  await size(1280, 860);
  const info = JSON.parse(await readFile(path.join(profile, 'runtime.json'), 'utf8'));
  rpc = await connect(info.port, info.token, 'cli');
  const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
  await rpc.call('settings.update', { onboarding: { step: 'done' } });

  const cell = page.locator('.frame-feedback-cell').getByRole('button', { name: 'Feedback', exact: true });
  await cell.waitFor({ timeout: 15_000 });
  await cell.click();
  const menu = page.locator('.popover.feedback-menu');
  await menu.getByRole('textbox', { name: 'Your feedback' }).fill('Schedules list stays empty after a restart\nmail me at max@example.de');
  await menu.getByRole('button', { name: 'Save', exact: true }).click();
  const issue = menu.locator('.feedback-issue');
  await issue.waitFor({ timeout: 15_000 });
  await issue.locator('.feedback-issue-title', { hasText: 'Schedules list stays empty after a restart' }).waitFor();
  assert.equal(await issue.locator('.feedback-issue-repo').first().textContent(), 'desquerteur/Autark-Plus');
  assert.deepEqual(await issue.locator('.feedback-issue-label').allTextContents(), ['from-app', 'bug']);
  const body = () => issue.locator('.feedback-issue-body').textContent();
  await page.waitForFunction(() => document.querySelector('.feedback-issue-body')?.textContent?.includes('### App version'));
  assert.match(await body(), /### OS\n/);
  assert.doesNotMatch(await body(), /max@example\.de|### View|### Log excerpt/, 'no e-mail; page and log only when ticked');
  assert.match(await body(), /\[email\]/);
  await shot('report-issue-preview-light');

  await issue.getByLabel('Page it happened on').check();
  await page.waitForFunction(() => document.querySelector('.feedback-issue-body')?.textContent?.includes('### View'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('report-issue-preview-view-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  await issue.getByRole('button', { name: 'Open on GitHub', exact: true }).click();
  await page.waitForFunction(() => true);
  await page.waitForTimeout(300);
  const opened = await app.evaluate(() => globalThis.__opened);
  assert.equal(opened.length, 1, 'one prefilled page opened');
  const url = new URL(opened[0]);
  assert.equal(url.origin + url.pathname, 'https://github.com/desquerteur/Autark-Plus/issues/new');
  assert.equal(url.searchParams.get('title'), 'Schedules list stays empty after a restart');
  assert.equal(url.searchParams.get('labels'), 'from-app,bug');
  assert.match(url.searchParams.get('body') ?? '', /### View\n/);
  assert.doesNotMatch(opened[0], /max%40example|max@example/);
  await page.keyboard.press('Escape');

  // Settings › Feedback › Review offers the same preview for the saved report.
  await rpc.call('settings.update', {}).catch(() => undefined);
  await page.evaluate(() => { location.hash = '#/settings/feedback'; });
  const review = page.getByRole('button', { name: 'Review', exact: true }).first();
  await review.waitFor({ timeout: 15_000 });
  await review.click();
  const dialog = page.getByRole('dialog', { name: 'Report' });
  await dialog.locator('.feedback-issue').waitFor();
  await shot('report-issue-review-dialog');
  await page.keyboard.press('Escape');

  await size(390, 844);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal page scroll');
  await cell.click().catch(() => undefined);
  await shot('report-issue-phone');
  assert.deepEqual(errors, []); t.diagnostic(`screenshots: ${shots}`);
});
