// B-080 browser fixes: the person's own Chrome as browser.open's fourth place (where: 'chrome' – their default profile,
// a new window found among the open ones, its UI tree for computer.*; the other tools keep own/chat/global), German
// and German and header-marked human checks detected as a plain fact (no line telling the agent what to do – that
// loops; the person clicks the check on the tab, owner 08.11.2026), every tab line naming its browser, and steps in the
// person's browser named by their words (one find there; several or none answer with the lines; css stays mine).
// Review: the start runs under the caller's pointer lease (ComputerService.inFront), and the window counted is one of
// exactly the started browser's process on a screen – not an agent's own off-screen Chrome, a WebView2 app or Edge.
// Live 09.11.: that window is brought to the front (focus_window) inside the lease before its tree is read, its title names
// the browser (not Chrome's restore bubble), and focused:false or a tree with the frame only are each one fact line. The
// person working by then (focus_window's presence refusal) leaves the window behind and the open still answers with it.
// Owns: these assertions only. Never: a real browser, Chrome, screen or host.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { browserTools } from '../../../src/runtime/browser/tools.ts';
import { isChallengeAnswer, isHumanCheck } from '../../../src/runtime/browser/human-check.ts';
import { CHROME_HINT, pageText, WHERE_HINT, whereHint } from '../../../src/runtime/browser/place.ts';
import { SIDE_CSS } from '../../../src/runtime/browser/side.ts';
import type { ChannelEnv } from '../../../src/runtime/browser/channel.ts';
import type { ComputerCaller } from '../../../src/runtime/computer/lease.ts';
import { humanActive } from '../../../src/runtime/computer/presence.ts';
import { WorkforceError } from '../../../src/shared/errors.ts';
import type { ComputerService, WindowInfo } from '../../../src/runtime/computer/service.ts';
import type { ToolDef } from '../../../src/runtime/tools/types.ts';
import type { SideBrowserCall, SideBrowserResult } from '../../../src/shared/model/side-browser.ts';
import { cleanupB055, scriptBrowser, textOf, toolCtx } from './b055-fakes.ts';

after(cleanupB055);

const tool = (tools: ToolDef[], name: string) => tools.find((entry) => entry.name === name)!;
const CHROME = 'C:\\Users\\p\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const EDGE = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
const env = (installed: string[]): ChannelEnv => ({
  platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files' }, exists: (file) => installed.includes(file),
});
const win = (hwnd: number, process: string, title = '', rect?: [number, number, number, number]): WindowInfo => ({ hwnd, title, process, pid: hwnd, ...(rect ? { rect } : {}), minimized: false, foreground: false, app: false });

/**
 * A computer whose window list gains `appears` after the browser started; `fronts` records the lease step around the start,
 * `focuses` each focus_window (B-080: with the lease and the reads so far); `state` sets its answer and the tree read.
 */
function fakeComputer(...appears: WindowInfo[]) {
  let started = false;
  let leased = false;
  const state: { focused: boolean; tree: string; title: string; truncated: boolean; focusError?: Error } = { focused: true, tree: '- document "Login" [ref=e1]\n  - edit "Email" [ref=e2]', title: 'Login – Google Chrome', truncated: false };
  const reads: Array<{ window?: number; leased?: boolean }> = [];
  const fronts: Array<{ caller?: ComputerCaller; startedInside: boolean }> = [];
  const focuses: Array<{ hwnd: number; caller?: ComputerCaller; leased: boolean; started: boolean; readsBefore: number }> = [];
  const computer = {
    screens: async () => [{ index: 0, x: 0, y: 0, width: 1920, height: 1080, primary: true, name: 'DISPLAY1' }],
    windows: async () => (started ? [win(1, 'explorer', 'Files'), ...appears] : [win(1, 'explorer', 'Files'), win(2, 'chrome', 'Mail – Google Chrome')]),
    inFront: async <T>(caller: ComputerCaller | undefined, run: () => Promise<T>): Promise<T> => {
      leased = true;
      try { return await run(); } finally { leased = false; fronts.push({ caller, startedInside: started }); }
    },
    focusWindow: async (hwnd: number, _signal?: AbortSignal, caller?: ComputerCaller) => {
      focuses.push({ hwnd, caller, leased, started, readsBefore: reads.length });
      if (state.focusError) throw state.focusError;
      return { focused: state.focused };
    },
    uiTree: async (input: { window?: number }) => {
      reads.push({ window: input.window, ...(leased ? { leased } : {}) });
      return { text: state.tree, count: state.tree.split('\n').length, truncated: state.truncated, window: { hwnd: input.window!, title: state.title } };
    },
  } as unknown as ComputerService;
  return { computer, reads, fronts, focuses, state, start: () => { started = true; } };
}

test("browser.open where: 'chrome' starts the person's own Chrome with a new window and answers with that window's tree; the other tools stay where they were", async () => {
  const rig = scriptBrowser();
  const fake = fakeComputer(win(9, 'chrome', 'Login – Google Chrome'));
  const started: Array<{ exe: string; args: string[] }> = [];
  const tools = browserTools(rig.browser, fake.computer, { env: env([CHROME, EDGE]), start: (exe, args) => { started.push({ exe, args }); fake.start(); return () => undefined; } });
  const t = toolCtx({ side: async (call: SideBrowserCall): Promise<SideBrowserResult> => ({ ok: true, tab: 'web-a1', url: 'https://x.test/', title: 'X', text: '' , ...(call.action === 'tabs' ? { tabs: [] } : {}) }) });
  const out = await tool(tools, 'browser.open').run({ url: 'dash.cloudflare.com/login', where: 'chrome' }, t.ctx);
  assert.deepEqual(started, [{ exe: CHROME, args: ['--new-window', 'https://dash.cloudflare.com/login'] }], 'his Chrome, no profile folder of mine, no debugging port');
  assert.deepEqual(fake.reads, [{ window: 9 }], 'the window that was not there before, read after the lease step');
  assert.deepEqual(fake.fronts, [{ caller: { key: 'ag_ada', id: 'ag_ada', name: 'Ada' }, startedInside: true }], 'started under my pointer lease');
  assert.deepEqual(fake.focuses, [{ hwnd: 9, caller: { key: 'ag_ada', id: 'ag_ada', name: 'Ada' }, leased: true, started: true, readsBefore: 0 }], 'B-080: brought to the front inside the lease, before the tree');
  const text = textOf(out);
  assert.match(text, /^Opened in the person's own Chrome, window 9 "Login – Google Chrome" – their profile and logins\. I go on there with computer\.ui_tree \/ computer\.act \(a password as its secret:\/\/ handle\)\.\n2 elements\./);
  assert.match(text, /- edit "Email" \[ref=e2\]/);
  assert.doesNotMatch(text, /no automation|bot checks? pass/i, 'facts only');
  assert.deepEqual(out.structured, { url: 'https://dash.cloudflare.com/login', window: 9, app: 'chrome' });
  assert.equal(t.sideCalls.length, 0);
  // Places never learned 'chrome': the next call goes to my own browser
  assert.match(textOf(await tool(tools, 'browser.snapshot').run({}, t.ctx)), /^Tab t1 · my own browser · /);
  const enumOf = (name: string) => ((tool(tools, name).inputSchema.properties as Record<string, { enum?: string[] }>).where!.enum);
  assert.deepEqual(enumOf('browser.open'), ['own', 'chat', 'global', 'chrome']);
  assert.deepEqual(enumOf('browser.snapshot'), ['own', 'chat', 'global']);
  assert.match(tool(tools, 'browser.open').describe!({ url: 'https://a.test', where: 'chrome' }, t.ctx).summary, /in the person's own Chrome$/);
  await rig.browser.close();
});

test("where: 'chrome' with only Edge installed opens Edge and says so; a start failure and a missing computer are one sentence", async () => {
  const rig = scriptBrowser();
  const fake = fakeComputer(win(5, 'msedge', 'Login – Microsoft Edge'));
  const started: string[] = [];
  const edge = browserTools(rig.browser, fake.computer, { env: env([EDGE]), start: (exe) => { started.push(exe); fake.start(); return () => undefined; } });
  const t = toolCtx();
  assert.match(textOf(await tool(edge, 'browser.open').run({ url: 'https://a.test', where: 'chrome' }, t.ctx)), /^Opened in the person's own Edge, window 5 /);
  assert.deepEqual(started, [EDGE]);
  const broken = browserTools(rig.browser, fakeComputer(win(6, 'chrome')).computer, { env: env([CHROME]), start: () => () => new Error('spawn EACCES') });
  await assert.rejects(tool(broken, 'browser.open').run({ url: 'https://a.test', where: 'chrome' }, t.ctx), /Chrome did not start: spawn EACCES/);
  const never = browserTools(rig.browser, fakeComputer(win(6, 'chrome')).computer, { env: env([CHROME]), start: () => () => undefined, findMs: 0 });
  await assert.rejects(tool(never, 'browser.open').run({ url: 'https://a.test', where: 'chrome' }, t.ctx), /no new window of it showed within 0 s; computer\.windows lists what is open/);
  await assert.rejects(tool(browserTools(rig.browser), 'browser.open').run({ url: 'https://a.test', where: 'chrome' }, t.ctx), /reached through computer use on this PC/);
  await assert.rejects(tool(edge, 'browser.open').run({ url: 'file:///C:/x', where: 'chrome' }, t.ctx), /Only http and https/);
  await rig.browser.close();
});

test("the window counted is the started browser's own on a screen: an agent's off-screen Chrome, a WebView2 popup or Edge are not", async () => {
  const rig = scriptBrowser();
  const fake = fakeComputer(
    win(20, 'chrome', 'about:blank – Google Chrome', [-32000, -32000, 1280, 800]), // an agent's own browser (launch.ts OFF_SCREEN)
    win(21, 'msedgewebview2', 'Teams', [100, 100, 600, 400]),
    win(22, 'msedge', 'New tab – Microsoft Edge', [200, 100, 1200, 800]),
    win(23, 'chrome', 'Login – Google Chrome', [1900, 50, 1280, 800]), // reaches onto the screen
  );
  const tools = browserTools(rig.browser, fake.computer, { env: env([CHROME, EDGE]), start: () => { fake.start(); return () => undefined; } });
  assert.match(textOf(await tool(tools, 'browser.open').run({ url: 'https://a.test', where: 'chrome' }, toolCtx().ctx)), /^Opened in the person's own Chrome, window 23 /);
  const only = fakeComputer(win(30, 'chrome', 'about:blank – Google Chrome', [-32000, -32000, 1280, 800])); // off every screen, its title names Chrome
  const offScreen = browserTools(rig.browser, only.computer, { env: env([CHROME]), start: () => { only.start(); return () => undefined; }, findMs: 0 });
  await assert.rejects(tool(offScreen, 'browser.open').run({ url: 'https://a.test', where: 'chrome' }, toolCtx().ctx), /no new window of it showed within 0 s/);
  await rig.browser.close();
});

test("B-080 (live 09.11.): the new browser window – not Chrome's restore bubble – comes to the front before its tree is read; a window Windows kept behind and a tree with the frame only are each one fact line", async () => {
  const rig = scriptBrowser();
  const fake = fakeComputer(
    win(40, 'chrome', 'Seiten wiederherstellen?', [800, 400, 320, 140]), // Chrome's bubble, a window of chrome.exe too
    win(41, 'chrome', 'Unbenannt - Google Chrome', [39, 30, 1280, 800]),
  );
  Object.assign(fake.state, {
    focused: false, title: 'Unbenannt - Google Chrome',
    tree: '- titlebar "Unbenannt - Google Chrome" [ref=e1]\n  - button "Minimieren" [ref=e2]\n- tab "Unbenannt" [ref=e3]\n- edit "Adress- und Suchleiste" [ref=e4] = "codewithharry.com/contact"',
  });
  const tools = browserTools(rig.browser, fake.computer, { env: env([CHROME]), start: () => { fake.start(); return () => undefined; } });
  const ada = { key: 'ag_ada', id: 'ag_ada', name: 'Ada' };
  const out = await tool(tools, 'browser.open').run({ url: 'https://codewithharry.com/contact', where: 'chrome' }, toolCtx().ctx);
  assert.deepEqual(fake.focuses, [{ hwnd: 41, caller: ada, leased: true, started: true, readsBefore: 0 }], 'the browser window, in front before the read, under the same caller');
  assert.deepEqual(fake.reads, [{ window: 41 }]);
  const lines = textOf(out).split('\n');
  assert.equal(lines[0], 'Opened in the person\'s own Chrome, window 41 "Unbenannt - Google Chrome" – their profile and logins. I go on there with computer.ui_tree / computer.act (a password as its secret:// handle).');
  assert.equal(lines[1], 'I did not bring this window to the front; Chrome draws a page only in a window that is not covered.');
  assert.equal(lines[2], "This Chrome window's UI tree holds its frame only: Chrome puts the page document into it once the page has loaded in a window that is not covered.");
  assert.match(lines[3]!, /^4 elements\. Format: /);
  assert.deepEqual(out.structured, { url: 'https://codewithharry.com/contact', window: 41, app: 'chrome' });

  // In front, with the page in its tree: neither line. A truncated tree tells nothing about the page: no frame line.
  const front = fakeComputer(win(42, 'chrome', 'Contact us | CodeWithHarry - Google Chrome'));
  Object.assign(front.state, { title: 'Contact us | CodeWithHarry - Google Chrome', tree: '- titlebar "Contact us" [ref=e1]\n- document "Contact us | CodeWithHarry" [ref=e2]\n  - edit "Name" [ref=e3]' });
  const inFront = browserTools(rig.browser, front.computer, { env: env([CHROME]), start: () => { front.start(); return () => undefined; } });
  const shown = textOf(await tool(inFront, 'browser.open').run({ url: 'https://codewithharry.com/contact', where: 'chrome' }, toolCtx().ctx));
  assert.doesNotMatch(shown, /to the front|frame only/);
  assert.match(shown.split('\n')[1]!, /^3 elements\./);
  const cut = fakeComputer(win(43, 'chrome', 'Unbenannt - Google Chrome'));
  Object.assign(cut.state, { title: 'Unbenannt - Google Chrome', tree: '- titlebar "Unbenannt - Google Chrome" [ref=e1]', truncated: true });
  const truncated = browserTools(rig.browser, cut.computer, { env: env([CHROME]), start: () => { cut.start(); return () => undefined; } });
  assert.doesNotMatch(textOf(await tool(truncated, 'browser.open').run({ url: 'https://a.test', where: 'chrome' }, toolCtx().ctx)), /frame only/);
  await rig.browser.close();
});

test('B-080 review: the person working by the time the window is found leaves it behind – the open still answers with that window; another focus failure stays an error', async () => {
  const rig = scriptBrowser();
  const busy = fakeComputer(win(50, 'chrome', 'Unbenannt - Google Chrome'));
  busy.state.focusError = humanActive();
  const tools = browserTools(rig.browser, busy.computer, { env: env([CHROME]), start: () => { busy.start(); return () => undefined; } });
  const lines = textOf(await tool(tools, 'browser.open').run({ url: 'https://a.test', where: 'chrome' }, toolCtx().ctx)).split('\n');
  assert.match(lines[0]!, /^Opened in the person's own Chrome, window 50 /);
  assert.equal(lines[1], 'I did not bring this window to the front; Chrome draws a page only in a window that is not covered.');
  assert.deepEqual(busy.reads, [{ window: 50 }], 'its tree is read as usual');
  const broken = fakeComputer(win(51, 'chrome', 'Unbenannt - Google Chrome'));
  broken.state.focusError = new WorkforceError('unavailable', 'The computer-use helper stopped. Re-observe before trying again.');
  const failing = browserTools(rig.browser, broken.computer, { env: env([CHROME]), start: () => { broken.start(); return () => undefined; } });
  await assert.rejects(tool(failing, 'browser.open').run({ url: 'https://a.test', where: 'chrome' }, toolCtx().ctx), /helper stopped/);
  await rig.browser.close();
});

test('human checks: German Cloudflare pages and its challenge header count, a footer does not; no line tells the agent what to do (owner 08.11.: that loops)', async () => {
  assert.equal(isHumanCheck({ title: 'Nur einen Moment…', url: 'https://dash.cloudflare.com/', snapshot: '' }), true);
  assert.equal(isHumanCheck({ title: 'dash.cloudflare.com', url: 'https://dash.cloudflare.com/', snapshot: '- heading "Sicherheitsüberprüfung wird durchgeführt" [level=1]' }), true);
  assert.equal(isHumanCheck({ title: 'x', url: 'https://x.test/', snapshot: '- paragraph: Bitte bestätigen Sie, dass Sie kein Bot sind.' }), true);
  assert.equal(isHumanCheck({ title: 'Login', url: 'https://x.test/', snapshot: '- text: There was a problem with verification' }), true);
  assert.equal(isHumanCheck({ title: 'Just a moment...', url: 'https://x.test/', snapshot: '' }), true);
  assert.equal(isHumanCheck({ title: 'Login', url: 'https://x.test/', snapshot: '- paragraph: This site is protected by reCAPTCHA and the Google Privacy Policy.' }), false);
  assert.equal(isChallengeAnswer({ headers: () => ({ 'cf-mitigated': 'challenge' }) }), true);
  assert.equal(isChallengeAnswer({ headers: () => ({ server: 'cloudflare' }) }), false);
  assert.equal(isChallengeAnswer(null), false);
  // A detected check adds no instruction to any page result – not in the person's browser and not in the agent's own.
  const side = toolCtx();
  const check = { url: 'https://shop.test/', title: 'Just a moment...', humanCheck: true };
  for (const place of ['own', 'chat', 'global'] as const) {
    const text = pageText(side.ctx, place, { ...check, tab: 'web-1' }, 'body');
    assert.doesNotMatch(text, /captcha|human check|where: 'chrome'|click it|not a robot|hand (?:it )?off/i, place);
    assert.ok(text.endsWith('body'), `${place}: just the page, no trailing note`);
  }
  // the challenge header in any language still marks the fetch as failed, but the open result carries no handoff line
  const rig = scriptBrowser();
  const tools = browserTools(rig.browser);
  const t = toolCtx();
  await tool(tools, 'browser.open').run({ url: 'https://shop.test/' }, t.ctx);
  rig.page().responseHeaders = { 'cf-mitigated': 'challenge' };
  const out = textOf(await tool(tools, 'browser.open').run({ url: 'https://shop.test/login' }, t.ctx));
  assert.doesNotMatch(out, /captcha|human check|where: 'chrome'|turned my browser away/i, out);
  await rig.browser.close();
});

test("the where line names the person's own Chrome only beside computer.*, which works in its window", () => {
  assert.equal(whereHint(true), WHERE_HINT);
  assert.ok(WHERE_HINT.endsWith(`; ${CHROME_HINT}`));
  assert.ok(whereHint(false).endsWith('own: my own browser, with the logins I made in it.'));
  assert.doesNotMatch(whereHint(false), /Chrome|computer\./);
});

test('every tab line names its browser: my own browser, the person\'s pane, this chat\'s area', async () => {
  const t = toolCtx();
  const page = { tab: 't1', url: 'https://accounts.google.com/', title: 'Sign in' };
  assert.equal(pageText(t.ctx, 'own', page, 'body').split('\n')[0], 'Tab t1 · my own browser · https://accounts.google.com/ · "Sign in"');
  assert.equal(pageText(t.ctx, 'global', { ...page, tab: 'web-1' }, 'body').split('\n')[0], 'Tab web-1 · the person\'s pane · https://accounts.google.com/ · "Sign in"');
  assert.equal(pageText(t.ctx, 'chat', { ...page, tab: 'web-2' }, 'body').split('\n')[0], 'Tab web-2 · this chat\'s area · https://accounts.google.com/ · "Sign in"');
  const rig = scriptBrowser();
  const tools = browserTools(rig.browser);
  await tool(tools, 'browser.open').run({ url: 'https://shop.test/' }, t.ctx);
  rig.page().bodyText = 'Price 5 €';
  assert.match(textOf(await tool(tools, 'browser.extract').run({}, t.ctx)), /^Tab t1 · my own browser · https:\/\/shop\.test\/ · "Example"\n/);
  const shot = await tool(tools, 'browser.screenshot').run({}, t.ctx);
  assert.equal(textOf(shot), 'Tab t1 · my own browser · https://shop.test/ · "Example"');
  await rig.browser.close();
});

test("in the person's browser a step named by its words takes the ref of the one element that matches; several or none say so; css stays mine", async () => {
  const lines = ['- textbox "Email" [ref=s12]', '- text: Your email stays private', '- button "Send" [ref=s20]', '- button "Send later" [ref=s21]'];
  const side = async (call: SideBrowserCall): Promise<SideBrowserResult> => {
    if (call.action === 'find') {
      const words = (call.query ?? '').toLowerCase().split(/\s+/);
      const hits = lines.filter((line) => words.every((word) => line.toLowerCase().includes(word)));
      return { ok: true, tab: 'web-a1', url: 'https://person.test/', title: 'Person', text: hits.join('\n') || 'Nothing on the page matches.' };
    }
    return { ok: true, tab: 'web-a1', url: 'https://person.test/', title: 'Person', changes: '', done: call.steps?.length };
  };
  const { browser } = scriptBrowser();
  const tools = browserTools(browser);
  const t = toolCtx({ side });
  const act = tool(tools, 'browser.act');
  await act.run({ action: 'fill', label: 'Email', value: 'a@b.test', where: 'global' }, t.ctx);
  assert.deepEqual(t.sideCalls.map((call) => [call.action, call.query, call.space]), [['find', 'Email', 'global'], ['act', undefined, 'global']]);
  assert.deepEqual(t.sideCalls[1]!.steps, [{ action: 'fill', ref: 's12', value: 'a@b.test' }]);
  await assert.rejects(act.run({ action: 'click', role: 'button', name: 'Send', where: 'global' }, t.ctx), (error: Error) => {
    assert.match(error.message, /^2 elements match button "Send": - button "Send" \[ref=s20\]; - button "Send later" \[ref=s21\] – I take the ref of the one I mean, or nth\.$/);
    return true;
  });
  await act.run({ action: 'click', role: 'button', name: 'Send', exact: true, where: 'global' }, t.ctx);
  assert.deepEqual(t.sideCalls.at(-1)!.steps, [{ action: 'click', ref: 's20' }], 'exact: the quoted name');
  await act.run({ action: 'click', role: 'button', name: 'Send', nth: 1, where: 'global' }, t.ctx);
  assert.deepEqual(t.sideCalls.at(-1)!.steps, [{ action: 'click', ref: 's21' }], 'nth picks one of them');
  await assert.rejects(act.run({ action: 'click', text: 'Checkout', where: 'global' }, t.ctx), /^WorkforceError: Nothing in the person's tab matches "Checkout"\.$/);
  await assert.rejects(act.run({ action: 'click', css: '#send', where: 'global' }, t.ctx), (error: Error) => error.message === SIDE_CSS);
  await assert.rejects(act.run({ action: 'click', where: 'global' }, t.ctx), /This step needs an element/);
  const before = t.sideCalls.length;
  await act.run({ action: 'press', key: 'Enter', where: 'global' }, t.ctx);
  assert.deepEqual(t.sideCalls.slice(before).map((call) => call.action), ['act'], 'a page step needs no element');
});
