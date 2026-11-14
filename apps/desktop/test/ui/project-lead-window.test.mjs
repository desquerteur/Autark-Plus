// AF-020 Electron window check of a project's page with its agents and the side chat, in an isolated test profile with
// the demo engine and a test folder that two agents work in:
//   * the page lists both agents; the side chat beside it talks to the first one (no lead yet);
//   * the crown makes Ben the lead: "Lead" mark, Ben first, the side chat switches to Ben, the session field says
//     "Runs with Ben (lead)"; the runtime keeps it (projects.get) and Ben's prompt says it leads the project;
//   * a message written in the side chat reaches Ben's 1:1 and its answer shows there – the route stays on the project;
//   * picking Ava switches the chat; the crown again removes the lead;
//   * a project without agents hires its lead from the folder in one click;
//   * at 1000 px the chat stacks under the page; on the phone (375 px) there is no side chat and an agent opens its 1:1;
//   * screenshots at 1280, 1000 and 375 px; no renderer errors.
// Run: npm run test:ui   (needs a fresh build)   SCREENSHOTS=<dir> keeps the screenshots.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { connect } from '../e2e/lib/runtime-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

test('project page: agents on the page, side chat without a view switch, the project lead', { timeout: 300_000 }, async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'workforce-project-lead-'));
  const shots = process.env.SCREENSHOTS ? path.resolve(process.env.SCREENSHOTS) : path.join(profile, 'shots');
  const repo = path.join(profile, 'berry-shop');
  await mkdir(shots, { recursive: true });
  await mkdir(repo, { recursive: true });
  await writeFile(path.join(repo, 'README.md'), '# Berry Shop\n\nThe online shop for berries.\n');
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

  // Two agents work in the folder; it is a project.
  const ava = (await rpc.call('folderAgents.create', { folder: repo, name: 'Ava', role: 'Frontend' })).agent;
  const ben = (await rpc.call('folderAgents.create', { folder: repo, name: 'Ben', role: 'Backend' })).agent;
  const project = await rpc.call('projects.add', { folder: repo });
  assert.deepEqual(project.agents.map((agent) => agent.name), ['Ava', 'Ben']);
  assert.equal(project.leadId, undefined);

  await page.evaluate((id) => { location.hash = `#/projects/${id}`; }, project.id);
  const agentsBox = page.locator('[data-tour="project-agents"]');
  await agentsBox.waitFor({ timeout: 20_000 });
  await until('both agents on the page', async () => (await agentsBox.locator('.project-agent').count()) === 2);
  const chat = page.locator('aside.project-chat');
  await chat.waitFor({ timeout: 15_000 });
  await until('the side chat with Ava', async () => /Ava/.test(await chat.locator('.project-chat-name').textContent()));
  await chat.locator('.composer-area textarea').waitFor({ timeout: 15_000 });

  // The crown makes Ben the lead.
  await agentsBox.getByRole('button', { name: 'Make Ben the lead' }).click();
  await until('Ben leads', async () => (await rpc.call('projects.get', { id: project.id })).leadId === ben.id);
  await until('Ben first with the Lead mark', async () => /^Ben\s*Lead/.test((await agentsBox.locator('.project-agent').first().locator('.project-agent-name').textContent()).trim()));
  await until('the side chat with the lead', async () => /Ben\s*Lead/.test(await chat.locator('.project-chat-name').textContent()));
  assert.match(await page.locator('.project-composer-who').textContent(), /Runs with Ben \(lead\)/);

  // Writing in the side chat: Ben's 1:1 gets it and answers there; the route stays on the project.
  const field = chat.locator('.composer-area textarea');
  await field.click();
  await field.fill('Hello from the project page [[prompt:Project lead]] [[prompt:I lead the project]]');
  await field.press('Enter');
  const direct = await rpc.call('chats.direct', { memberId: ben.id });
  const answer = await until('Ben\'s answer', async () => {
    const messages = await rpc.call('messages.list', { conversationId: direct.id, limit: 50 });
    return messages.find((message) => message.authorId === ben.id && message.state === 'final' && /prompt →/.test(message.body ?? ''))?.body;
  }, 60_000);
  assert.match(answer, /prompt → .*Project lead/, 'the lead\'s prompt has the Project lead section');
  assert.match(answer, /prompt → .*I lead the project "berry-shop"/, 'it names the project it leads');
  await until('the answer in the side chat', async () => (await chat.locator('[data-message-id]').count()) >= 2);
  assert.match(await page.evaluate(() => location.hash), /^#\/projects\//, 'no view switch');
  await shot('project-lead-chat-1280');

  // Picking Ava switches the chat; the crown again removes the lead.
  await agentsBox.locator('.project-agent', { hasText: 'Ava' }).locator('.project-agent-open').click();
  await until('the side chat with Ava', async () => /^Ava/.test((await chat.locator('.project-chat-name').textContent()).trim()));
  await agentsBox.getByRole('button', { name: 'Remove Ben as lead' }).click();
  await until('no lead', async () => (await rpc.call('projects.get', { id: project.id })).leadId === undefined);
  await until('the Lead mark is gone', async () => (await page.locator('.project-lead-mark').count()) === 0);
  await agentsBox.getByRole('button', { name: 'Make Ben the lead' }).waitFor({ timeout: 10_000 });

  // A project nobody works in yet: "Hire a lead from this folder" hires one and makes it the lead.
  const solo = path.join(profile, 'solo-tool');
  await mkdir(solo, { recursive: true });
  const soloProject = await rpc.call('projects.add', { folder: solo });
  await page.evaluate((id) => { location.hash = `#/projects/${id}`; }, soloProject.id);
  await page.getByRole('button', { name: 'Hire a lead from this folder' }).click();
  await until('a hired lead', async () => Boolean((await rpc.call('projects.get', { id: soloProject.id })).leadId), 60_000);
  await until('the hired lead on the page', async () => (await page.locator('[data-tour="project-agents"] .project-agent.lead').count()) === 1);
  await until('the side chat with the hired lead', async () => /Lead/.test(await page.locator('aside.project-chat .project-chat-name').textContent()));
  await shot('project-lead-hired-1280');
  await page.evaluate((id) => { location.hash = `#/projects/${id}`; }, project.id);
  await agentsBox.waitFor({ timeout: 20_000 });

  // The composer's action row fits the side chat (nothing sticks out past its right edge).
  const fits = await chat.evaluate((aside) => { const edge = aside.getBoundingClientRect().right; return [...aside.querySelectorAll('.composer-actions > *')].every((cell) => cell.getBoundingClientRect().right <= edge + 0.5); });
  assert.equal(fits, true, 'the composer fits the side chat');
  // A narrower window: the side chat stacks under the page.
  await size(1000, 820);
  await page.waitForTimeout(600);
  const [pageBox, chatBox] = await Promise.all([page.locator('.project-split > .projects-scroll').boundingBox(), chat.boundingBox()]);
  assert.ok(chatBox && pageBox && chatBox.y >= pageBox.y + pageBox.height - 1, 'the chat sits under the page');
  await shot('project-lead-chat-1000');
  // The phone layout: no side chat; a picked agent opens its 1:1.
  await size(375, 760);
  await page.waitForTimeout(600);
  assert.equal(await page.locator('aside.project-chat').count(), 0, 'no side chat on the phone');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no horizontal scroll at 375 px');
  await shot('project-lead-375');
  await page.locator('[data-tour="project-agents"] .project-agent', { hasText: 'Ava' }).locator('.project-agent-open').click();
  await until('Ava\'s 1:1 opens', async () => /^#\/chat\//.test(await page.evaluate(() => location.hash)));
  assert.ok(ava.id && ava.id !== ben.id);
  assert.deepEqual(errors.filter((line) => !/favicon|ResizeObserver/.test(line)), [], 'no renderer errors');
});
