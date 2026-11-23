// Electron window check of the composer's model chip (Umbau Einfachheit: one searchable list, effort; B-083: "Auto"
// first, a pick is a suggestion, a temperature row) with the demo engine in an isolated test profile:
//   * before the agent's first turn the chip names the model routing.preview routes it to (ignorePin) after "Auto";
//     its menu has the search field, "Auto" first (checked, hint "<that model> now"), the chat models, the temperature
//     row (value "Auto") and the effort slider (AF-021: Auto · Low · Medium · High · Max, role="slider") – no routing
//     captions, guide labels or pins;
//   * picking the demo model stores it as the agent's suggestion in this chat (chats.get settings.modelHints), the chip
//     shows its short name in the same box (nothing beside it moves); an effort set with the keyboard (arrow) and by
//     dragging the slider is stored and named on the chip; Auto clears both and the chip names the routed model again;
//     a search that matches nothing says "No models";
//   * AF-021: with two accounts of the model's provider (injected at the MessagePort – demo mode has one) the menu has
//     an "Account" section (Automatic + both, with share left and reset); picking the second stores it for the agent in
//     this chat (settings.accounts) and the chip names it ("… · fritz2");
//   * at 375 px (phone layout) the menu stays on screen and the page has no horizontal scroll;
//   * screenshots light, dark and 375 px; no renderer errors.
// Run: npm run test:ui (needs a fresh build). WORKFORCE_EXECUTABLE selects an unpacked CI package;
// SCREENSHOTS=<dir> keeps the screenshots.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { connect } from '../e2e/lib/runtime-client.mjs';
import { expectStable } from './lib/stable.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

/**
 * AF-021 (in the page, before the app loads): demo mode has one account – accounts.list answers with a second one of
 * the same provider ("fritz1", "fritz2") with limit readings, so the menu has an account choice.
 */
function twoAccounts() {
  const asked = new Map();
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (frame, ...rest) {
    if (frame?.method === 'accounts.list') asked.set(frame.id, frame.method);
    return post.call(this, frame, ...rest);
  };
  const now = Date.now();
  const windows = (five, week) => [
    { name: '5h', windowMinutes: 300, usedPercent: 100 - five, resetsAt: now + 2 * 3_600_000 + 5 * 60_000 },
    { name: 'weekly', windowMinutes: 10080, usedPercent: 100 - week, resetsAt: now + 3 * 86_400_000 },
  ];
  const data = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data').get;
  Object.defineProperty(MessageEvent.prototype, 'data', { configurable: true, get() {
    const frame = data.call(this);
    const method = frame && asked.get(frame.id);
    if (method !== 'accounts.list' || !Array.isArray(frame.result)) return frame;
    const first = frame.result.find((entry) => entry.enabled) ?? frame.result[0];
    if (!first) return frame;
    const limits = (five, week) => ({ readAt: now, windows: windows(five, week) });
    return { ...frame, result: [
      ...frame.result.filter((entry) => entry.id !== first.id),
      { ...first, label: 'fritz1', priority: 0, limits: limits(64, 81) },
      { ...first, id: 'acc_fritz2', label: 'fritz2', priority: 1, createdAt: (first.createdAt ?? 0) + 1, limits: limits(92, 47) },
    ] };
  } });
}

test('model chip: the routed model, a chosen model and effort per chat, search, phone width', { timeout: 240_000 }, async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'workforce-model-menu-'));
  const shots = process.env.SCREENSHOTS ? path.resolve(process.env.SCREENSHOTS) : path.join(profile, 'shots');
  await mkdir(shots, { recursive: true });
  const packaged = process.env.WORKFORCE_EXECUTABLE;
  const app = await electron.launch({
    executablePath: packaged ? path.resolve(packaged) : electronPath, args: packaged ? [] : [root], cwd: root, timeout: 60_000,
    env: { ...process.env, WORKFORCE_TEST_DATA: profile, WORKFORCE_FAKE_ENGINE: '1', ELECTRON_ENABLE_LOGGING: '0' },
  });
  let rpc;
  t.after(async () => {
    rpc?.close?.();
    await app.close().catch(() => undefined);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => undefined);
  });

  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(twoAccounts); // AF-021
  await page.reload();
  await page.waitForSelector('.shell', { timeout: 60_000 });
  const size = (width, height) => app.evaluate(({ BrowserWindow }, [w, h]) => { const [win] = BrowserWindow.getAllWindows(); win.setMinimumSize(320, 480); win.setSize(w, h); }, [width, height]);
  await size(1280, 820);
  const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
  const info = JSON.parse(await readFile(path.join(profile, 'runtime.json'), 'utf8'));
  rpc = await connect(info.port, info.token, 'cli');
  await rpc.call('settings.update', { onboarding: { step: 'done' } });
  const manager = (await rpc.call('agents.list')).find((agent) => agent.template === 'manager');
  const chat = await rpc.call('chats.create', { title: 'Video plan', agentIds: [manager.id] });
  const models = (await rpc.call('models.list')).filter((model) => model.available);
  assert.ok(models.length > 0, 'the demo model is there');
  const settingsOf = async () => (await rpc.call('chats.get', { id: chat.id })).settings;
  const until = async (check, what) => {
    for (const end = Date.now() + 10_000; Date.now() < end; await page.waitForTimeout(150)) if (await check()) return;
    assert.fail(`timed out: ${what}`);
  };

  await page.evaluate((id) => { location.hash = `#/chat/${id}`; }, chat.id);
  const chip = page.locator('.composer-actions .model-chip');
  await chip.waitFor({ timeout: 20_000 });
  // Before the first turn: the model the app routes the agent to now, by name.
  const routed = await rpc.call('routing.preview', { agentId: manager.id, conversationId: chat.id, ignorePin: true });
  const routedNames = [routed.modelId, models.find((model) => model.id === routed.modelId)?.name ?? ''];
  await page.waitForFunction(() => document.querySelector('.composer-actions .model-chip .chip-label .sub')?.textContent?.trim(), undefined, { timeout: 10_000 });
  // AF-021: with two accounts the label is "<model> · <account>" – the model part ("Auto <routed model>") is .chip-model
  const modelPart = () => (document.querySelector('.composer-actions .model-chip .chip-model') ?? document.querySelector('.composer-actions .model-chip .chip-label'))?.textContent?.trim();
  const routedLabel = await page.evaluate(modelPart);
  assert.match((await chip.locator('.chip-label').textContent()).trim(), /^Auto\s+\S.*\s· fritz1$/, 'the chip names the account routing takes');
  assert.match(routedLabel, /^Auto\s+\S/);
  const routedName = routedLabel.replace(/^Auto\s+/, '');
  assert.ok(routedNames.some((name) => name.endsWith(routedName)), `the chip names the routed model: "${routedLabel}" for ${routedNames.join(' / ')}`);
  const row = ['.composer', '.composer-actions', '.composer .composer-plus', '.composer .model-chip', '.composer .send-button'];

  // The menu: search, Auto (checked, the routed model beside it), the chat models, the temperature and effort rows.
  await chip.click();
  const menu = page.getByRole('menu', { name: 'Model' });
  await menu.waitFor({ timeout: 5_000 });
  assert.equal(await menu.getByRole('textbox', { name: 'Search models' }).count(), 1);
  const auto = menu.locator('[role="menuitemradio"]').first();
  assert.equal(await auto.getAttribute('aria-checked'), 'true');
  assert.equal((await auto.locator('.menu-label > span').textContent()).trim(), 'Auto', 'the first item is Auto');
  assert.equal((await auto.locator('.menu-hint').textContent()).trim(), `${routedName} now`, 'beside it the model routing takes now');
  const choices = (await menu.locator('[role="menuitemradio"] .menu-label > span').allTextContents()).map((text) => text.trim());
  assert.ok(choices.length >= 2, `Auto and at least one model: ${choices.join(', ')}`);
  const temperature = menu.getByRole('group', { name: 'Temperature' });
  assert.equal(await temperature.locator('input[type="range"]').count(), 1, 'the temperature slider');
  assert.equal((await temperature.locator('.temp-value').textContent()).trim(), 'Auto', 'no temperature suggested');
  const slider = menu.getByRole('slider', { name: 'Effort' });
  assert.equal(await slider.getAttribute('aria-valuetext'), 'Auto', 'the effort slider starts at Auto (AF-021)');
  assert.deepEqual((await menu.locator('.effort-label').allTextContents()).map((text) => text.trim()).slice(0, 2), ['Auto', 'Low']);
  // AF-021: the account section – Automatic and both accounts of the model's provider
  const accountGroup = menu.getByRole('group', { name: 'Account' });
  await accountGroup.waitFor({ timeout: 5_000 });
  assert.equal(await accountGroup.locator('[role="menuitemradio"]').first().getAttribute('aria-checked'), 'true', 'Automatic is chosen');
  assert.deepEqual((await accountGroup.locator('.account-option-name').allTextContents()).map((text) => text.trim()), ['Automatic (recommended)', 'fritz1', 'fritz2']);
  assert.match(await accountGroup.locator('.account-option-meta').nth(2).textContent(), /^\d+% left · resets /);
  assert.equal(await menu.getByText(/Always use|Below quality floor|Above cost guide|Recommended/).count(), 0, 'no routing captions or pins');
  await shot('model-menu-01-open-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('model-menu-02-open-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // A search that matches nothing.
  await menu.getByRole('textbox', { name: 'Search models' }).fill('zzz-no-such-model');
  await menu.getByText('No models').waitFor({ timeout: 5_000 });
  await menu.getByRole('textbox', { name: 'Search models' }).fill('');

  // Pick the first model: stored as the agent's suggestion in this chat (no hard pin); the chip keeps its box.
  const first = menu.locator('.model-option:not(.unavailable)').first();
  const firstId = await first.getAttribute('title');
  const firstModel = models.find((model) => model.id === firstId);
  assert.ok(firstModel, 'the first choice is an available catalog model in the fixture');
  const details = first.locator('.model-option-details');
  assert.equal(await details.isVisible(), true, 'full ID is visible without hovering');
  assert.equal((await details.textContent()).trim(), [firstModel.source, firstId].filter(Boolean).join(' · '));
  const firstName = (await first.locator('.menu-label > span').textContent()).trim();
  await expectStable(page, row, async () => {
    await first.click();
    await until(async () => Boolean((await settingsOf()).modelHints?.[manager.id]), 'the suggestion is stored');
    await page.waitForFunction((name) => document.querySelector('.composer-actions .model-chip .chip-label')?.textContent?.startsWith(name), firstName, { timeout: 5_000 });
  });
  const stored = (await settingsOf()).modelHints[manager.id];
  assert.ok(models.some((model) => model.id === stored), `a listed model: ${stored}`);
  assert.equal((await settingsOf()).models?.[manager.id], undefined, 'no hard pin');

  // An effort for it (AF-021: the slider): one arrow key from Auto → the lowest effort, stored and named on the chip.
  await chip.click();
  await menu.waitFor({ timeout: 5_000 });
  const effortSlider = menu.getByRole('slider', { name: 'Effort' });
  const labels = (await menu.locator('.effort-label').allTextContents()).map((text) => text.trim());
  await effortSlider.focus();
  await page.keyboard.press('ArrowRight');
  await until(async () => Boolean((await settingsOf()).efforts?.[manager.id]), 'the effort is stored');
  await page.waitForFunction((label) => document.querySelector('.composer-actions .model-chip .chip-label')?.textContent?.includes(label), labels[1], { timeout: 5_000 });
  assert.equal(await effortSlider.getAttribute('aria-valuetext'), labels[1]);
  // dragging to the far end: the highest effort the model offers
  const track = await effortSlider.boundingBox();
  await page.mouse.move(track.x + 4, track.y + track.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2, { steps: 4 });
  await page.mouse.move(track.x + track.width - 2, track.y + track.height / 2, { steps: 4 });
  await page.mouse.up();
  const top = labels.at(-1);
  await until(async () => { const value = (await settingsOf()).efforts?.[manager.id]; return value && value !== 'low'; }, 'the dragged effort is stored');
  await until(async () => (await effortSlider.getAttribute('aria-valuetext')) === top, `the slider shows ${top}`);
  assert.equal((await settingsOf()).efforts[manager.id].toLowerCase(), top.toLowerCase().replace('very high', 'xhigh'));
  // AF-021: the second account for this chat – stored, and the chip names it
  await menu.getByRole('group', { name: 'Account' }).getByRole('menuitemradio', { name: /fritz2/ }).click();
  await until(async () => (await settingsOf()).accounts?.[manager.id] === 'acc_fritz2', 'the account is stored');
  await page.waitForFunction(() => document.querySelector('.composer-actions .model-chip .chip-account')?.textContent?.includes('fritz2'), undefined, { timeout: 5_000 });
  await shot('model-menu-03-account-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('model-menu-03-account-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.keyboard.press('Escape');
  await shot('model-menu-03-chosen-light');

  // Auto (nothing suggested) clears both; the chip names the routed model again.
  await chip.click();
  await menu.waitFor({ timeout: 5_000 });
  await expectStable(page, row, async () => {
    await menu.locator('[role="menuitemradio"]').first().click();
    await until(async () => { const s = await settingsOf(); return !s.modelHints?.[manager.id] && !s.models?.[manager.id] && !s.efforts?.[manager.id]; }, 'Auto clears the model and the effort');
    await page.waitForFunction((name) => document.querySelector('.composer-actions .model-chip .chip-model')?.textContent?.trim() === name, routedLabel, { timeout: 5_000 });
  });

  // 375 px: the menu stays on screen, no horizontal page scroll.
  await size(375, 812);
  await page.waitForTimeout(800);
  await page.locator('.composer-actions .model-chip').click();
  await page.getByRole('menu', { name: 'Model' }).waitFor({ timeout: 5_000 });
  const box = await page.getByRole('menu', { name: 'Model' }).boundingBox();
  const width = await page.evaluate(() => innerWidth);
  assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1, `the menu stays on screen: ${JSON.stringify(box)} in ${width}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `no horizontal page scroll at 375 px (${overflow}px)`);
  assert.equal(await menu.locator('.model-option-details').first().evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true,
    'the displayed ID does not overflow its column');
  await shot('model-menu-04-375');
  await page.keyboard.press('Escape');
  await size(1280, 820);

  t.diagnostic(`screenshots: ${shots}`);
  const relevant = errors.filter((text) => !/Autofill|DevTools|Electron Security Warning/i.test(text));
  assert.deepEqual(relevant, [], 'no renderer errors');
});
