// AF-024 Electron window check of Settings › Models: the "Google Gemini" button opens its panel – a name ("Gemini"
// suggested), "Sign in with Google", "API key", Cancel and the hint – inline under the buttons; "API key" turns it into the
// connection form with Google Gemini picked (its fixed Google address, "Get a key"); "Sign in with Google" runs the plan
// flow, whose status line answers in the demo (the demo engine never installs a program or signs in: the runtime says so).
// Nothing is installed, signed in or sent. Screenshots light, dark and phone width; no horizontal scroll; no renderer errors.
// Run: npm run build && node --test test/ui/af024-gemini-window.test.mjs   SCREENSHOTS=<dir> keeps the screenshots;
// AUTARK_ELECTRON=<electron.exe> when this install has no Electron binary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const electronPath = process.env.AUTARK_ELECTRON || path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

test('Settings › Models: Google Gemini – Google sign-in or API key', { timeout: 180_000 }, async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'workforce-gemini-'));
  const shots = process.env.SCREENSHOTS ? path.resolve(process.env.SCREENSHOTS) : path.join(profile, 'shots');
  await mkdir(shots, { recursive: true });
  const app = await electron.launch({
    executablePath: electronPath, args: [root], cwd: root, timeout: 60_000,
    env: { ...process.env, WORKFORCE_TEST_DATA: profile, WORKFORCE_FAKE_ENGINE: '1', ELECTRON_ENABLE_LOGGING: '0' },
  });
  t.after(async () => {
    await app.close().catch(() => undefined);
    if (!process.env.SCREENSHOTS) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => undefined);
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.waitForSelector('.shell', { timeout: 60_000 });
  const size = (width, height) => app.evaluate(({ BrowserWindow }, [w, h]) => { const [win] = BrowserWindow.getAllWindows(); win.setSize(w, h); }, [width, height]);
  const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
  await size(1280, 820);
  await page.evaluate(() => { location.hash = '#/settings/models'; });

  const group = page.locator('#settings-models');
  await group.waitFor({ timeout: 15_000 });
  const buttons = group.locator('.model-setup-buttons');
  for (const label of ['Claude plan', 'Codex plan', 'Google Gemini', 'API key', 'Local server']) assert.equal(await buttons.getByRole('button', { name: label, exact: true }).count(), 1, label);

  await buttons.getByRole('button', { name: 'Google Gemini', exact: true }).click();
  const panel = group.locator('.gemini-add');
  await panel.waitFor({ timeout: 5_000 });
  assert.equal(await buttons.getByRole('button', { name: 'Google Gemini', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await panel.getByLabel('Name').getAttribute('placeholder'), 'Gemini', 'the first one is "Gemini"');
  for (const label of ['Sign in with Google', 'API key', 'Cancel']) assert.equal(await panel.getByRole('button', { name: label, exact: true }).count(), 1, label);
  assert.match(await panel.locator('.gemini-add-hint').textContent(), /Gemini CLI.*several/);
  await panel.scrollIntoViewIfNeeded();
  await shot('gemini-01-panel-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('gemini-02-panel-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  // crossing into the phone layout mounts Settings anew (an open form closes, like the API key form): open it again there
  const open = async () => {
    await page.waitForTimeout(600);
    if (!(await panel.count())) await group.locator('.model-setup-buttons').getByRole('button', { name: 'Google Gemini', exact: true }).click();
    await panel.waitFor({ timeout: 5_000 });
  };
  await size(420, 860);
  await open();
  await panel.scrollIntoViewIfNeeded();
  await shot('gemini-03-panel-phone');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `no horizontal page scroll at phone width (${overflow}px)`);
  await size(1280, 820);
  await open();

  // Sign in with Google: the plan flow's line answers (the demo installs nothing and signs in nowhere).
  await panel.getByLabel('Name').fill('Gemini Arbeit');
  await panel.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
  const status = group.locator('.model-setup-status');
  await page.waitForFunction(() => /demo|install|Gemini|signing in/i.test(document.querySelector('#settings-models .model-setup-status')?.textContent ?? ''), null, { timeout: 20_000 });
  const line = (await status.textContent()) ?? '';
  t.diagnostic(`status line: ${line}`);
  await shot('gemini-04-sign-in-line');

  // API key: the connection form with Google Gemini picked and its fixed address.
  await panel.getByRole('button', { name: 'API key', exact: true }).click();
  const form = group.locator('.add-account.inline-form').filter({ has: page.getByLabel('API key') });
  await form.waitFor({ timeout: 5_000 });
  assert.equal(await group.locator('.gemini-add').count(), 0, 'the panel became the form');
  assert.match(await form.getByLabel('URL').inputValue(), /generativelanguage\.googleapis\.com/);
  assert.equal(await form.getByRole('button', { name: 'Get a key' }).count(), 1, 'Google AI Studio\'s key page');
  await form.scrollIntoViewIfNeeded();
  await shot('gemini-05-api-key-form');
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await group.locator('.add-account').waitFor({ state: 'detached', timeout: 5_000 });

  t.diagnostic(`screenshots: ${shots}`);
  const relevant = errors.filter((text) => !/Autofill|DevTools|Electron Security Warning/i.test(text));
  assert.deepEqual(relevant, [], 'no renderer errors');
});
