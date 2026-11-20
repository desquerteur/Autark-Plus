// desquerteur/Autark-Plus#19 Electron window check of the Projects tab, end to end, with the demo engine in an isolated
// test profile and two real git repositories (branch main; two changed files in one, one in the other):
//   * "Add project" (the folder dialog answered by the test) adds both repositories; they sit side by side in the
//     sidebar, each with its changed-file count, and the project page shows the branch and the changes;
//   * typing a prompt in a project's "What should happen in …" field and Start session opens a new chat, in which an agent
//     hired for exactly that folder answers (its prompt carries the folder as its home project); the chat header shows
//     the project chip;
//   * a session in the second project stays apart: each project lists its own session;
//   * screenshots at 1280 px and phone width; no renderer errors.
// Run: npm run build && node --test test/ui/projects-tab-window.test.mjs   SCREENSHOTS=<dir> keeps the screenshots.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { connect } from '../e2e/lib/runtime-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

/** A git repository on branch main with one commit, then `dirty` files changed or added. */
async function repo(dir, title, dirty) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'README.md'), `# ${title}\n\n${title} – a test project.\n`);
  await writeFile(path.join(dir, 'index.js'), 'console.log("hi");\n');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  if (dirty >= 1) await writeFile(path.join(dir, 'index.js'), 'console.log("changed");\n');
  if (dirty >= 2) await writeFile(path.join(dir, 'new.txt'), 'new\n');
}

test('#19: two projects side by side, a prompt in the Projects tab starts an agent in that folder in a new chat', { timeout: 300_000 }, async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'workforce-projects-tab-'));
  const shots = process.env.SCREENSHOTS ? path.resolve(process.env.SCREENSHOTS) : path.join(profile, 'shots');
  await mkdir(shots, { recursive: true });
  const alpha = path.join(profile, 'alpha-app');
  const beta = path.join(profile, 'beta-tool');
  await repo(alpha, 'Alpha App', 2);
  await repo(beta, 'Beta Tool', 1);
  const app = await electron.launch({
    executablePath: electronPath, args: [root], cwd: root, timeout: 60_000,
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
  await page.waitForSelector('.shell', { timeout: 60_000 });
  const size = (width, height) => app.evaluate(({ BrowserWindow }, [w, h]) => { const [win] = BrowserWindow.getAllWindows(); win.setMinimumSize(320, 480); win.setSize(w, h); }, [width, height]);
  await size(1280, 820);
  const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
  const info = JSON.parse(await readFile(path.join(profile, 'runtime.json'), 'utf8'));
  rpc = await connect(info.port, info.token, 'cli');
  await rpc.call('settings.update', { onboarding: { step: 'done' } });
  const until = async (what, check, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(150)) { const value = await check(); if (value) return value; }
    assert.fail(`timed out: ${what}`);
  };
  /** The next folder dialog answers `folder`. */
  const answerDialog = (folder) => app.evaluate(({ dialog }, picked) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] }); }, folder);
  const projectOf = async (folder) => (await rpc.call('projects.list')).find((entry) => path.resolve(entry.folder) === path.resolve(folder));

  // ---- Add both repositories with "Add project"
  for (const folder of [alpha, beta]) {
    await page.evaluate(() => { location.hash = '#/projects'; });
    await answerDialog(folder);
    await page.locator('.projects-intro').getByRole('button', { name: 'Add project' }).click();
    await until(`${path.basename(folder)} added`, () => projectOf(folder));
  }
  const a = await projectOf(alpha);
  const b = await projectOf(beta);
  const rows = page.locator('.project-row');
  await until('both projects in the sidebar', async () => (await rows.count()) === 2);
  await until('alpha shows 2 changed files', async () => (await rows.filter({ hasText: 'alpha-app' }).locator('.project-dirty').textContent().catch(() => '')) === '2');
  await until('beta shows 1 changed file', async () => (await rows.filter({ hasText: 'beta-tool' }).locator('.project-dirty').textContent().catch(() => '')) === '1');

  // ---- The project page: branch and changes, then a session from a prompt
  await page.evaluate((id) => { location.hash = `#/projects/${id}`; }, a.id);
  await until('alpha: branch main', async () => /main/.test(await page.locator('.project-fact', { hasText: 'Branch' }).textContent().catch(() => '')));
  await shot('projects-01-alpha-1280');
  const field = page.locator('.project-composer-field');
  await field.fill('Look at index.js and say what it prints. [[prompt:alpha-app]]');
  /** Start session in the open project; the chat it opens (#/chat/<id>). */
  const start = async (before) => {
    await page.getByRole('button', { name: 'Start session' }).click();
    return until('a new chat opens', async () => { const id = (await page.evaluate(() => location.hash)).match(/^#\/chat\/([^/?]+)/)?.[1]; return id && id !== before ? id : undefined; });
  };
  const sessionsOf = async (id) => (await rpc.call('projects.get', { id })).sessions.map((entry) => entry.conversationId);
  const alphaChat = await start();
  await until('the chat is one of alpha\'s sessions', async () => (await sessionsOf(a.id)).includes(alphaChat));
  const alphaNow = await rpc.call('projects.get', { id: a.id });
  assert.equal(alphaNow.agents.length, 1, 'an agent was hired for the folder');
  const agentId = alphaNow.agents[0].id;
  const answer = await until('the agent answers in the new chat', async () => {
    const messages = await rpc.call('messages.list', { conversationId: alphaChat, limit: 50 });
    return messages.find((message) => message.authorId === agentId && message.state === 'final')?.body;
  }, 60_000);
  assert.match(answer, /alpha-app/, 'the agent\'s prompt carries the project folder');
  await until('the project chip in the chat header', async () => /alpha/i.test(await page.locator('.chat-project-chip').first().textContent().catch(() => '')));
  await shot('projects-02-session-1280');

  // ---- A session in the second project stays apart
  await page.evaluate((id) => { location.hash = `#/projects/${id}`; }, b.id);
  await page.locator('.project-composer-field').fill('Add a test for the tool.');
  const betaChat = await start(alphaChat);
  await until('the chat is one of beta\'s sessions', async () => (await sessionsOf(b.id)).includes(betaChat));
  assert.equal((await sessionsOf(a.id)).includes(betaChat), false, 'alpha does not list beta\'s session');
  assert.equal((await sessionsOf(b.id)).includes(alphaChat), false, 'beta does not list alpha\'s session');
  await page.evaluate((id) => { location.hash = `#/projects/${id}`; }, b.id);
  await until('beta\'s sessions listed under it', async () => (await page.locator('.project-sessions .project-session').count()) >= 1);
  await shot('projects-03-two-projects-1280');
  await shot('projects-03-two-projects-1280');

  // ---- Phone width: the list still holds both
  await size(390, 780);
  await page.evaluate(() => { location.hash = '#/projects'; });
  await page.waitForTimeout(600);
  const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert.equal(scrolls, false, 'no horizontal scroll at phone width');
  await shot('projects-04-phone');

  assert.deepEqual(errors.filter((line) => !/favicon|ResizeObserver/.test(line)), [], 'no renderer errors');
});
