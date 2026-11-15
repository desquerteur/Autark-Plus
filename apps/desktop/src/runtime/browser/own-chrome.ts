// The person's own Chrome as a place for browser.open (B-080, where: 'chrome'; live 07.11.: agents wrote their own
// PowerShell to reach it). Their normal Chrome – or Edge where only Edge is installed – starts a new window at the URL
// with their default profile and logins: no profile folder of mine and no debugging connection. I find that window
// among the open ones (the one that was not there before, looked for a bounded time) and read its UI tree, so I go on
// there with computer.ui_tree and computer.act like in any app.
// B-080 (live 09.11.: Windows opened 11 of 12 such windows behind the person's app and they read as blank pages; the one in
// front read without its page right at its open too): I bring the new window to the front (focus_window): Chrome draws a page
// and shows it in its UI tree only while its window is not covered. The start, the look and that step run under the caller's
// pointer lease and the person's priority (ComputerService.inFront); the person working by the time the window is found
// leaves it where Windows put it (focused: false), and the window and its tree still come back – it is open already.
// The window counted is one of exactly the started browser's process (chrome or msedge – not a WebView2 app) that lies on
// a screen and whose title names that browser (not a bubble like "Seiten wiederherstellen?"): the agents' own browsers are
// Chrome or Edge too, but launch.ts starts their windows off every screen.
// Owns: starting that window, finding it and bringing it to the front. Never: drives it through the browser's debugging
// protocol or picks a profile.

import { spawn } from 'node:child_process';
import { WorkforceError } from '../../shared/errors.ts';
import type { ComputerCaller } from '../computer/lease.ts';
import { isPresenceRefusal } from '../computer/presence.ts';
import type { ComputerService, ScreenInfo, UiTree, WindowInfo } from '../computer/service.ts';
import { frameOnly } from '../computer/tree.ts';
import { channelCandidates, defaultChannelEnv, detectChannel, type ChannelEnv } from './channel.ts';
import { normaliseUrl } from './page.ts';

/** How long I look for the new window (Chrome's cold start included), and how often. */
const FIND_MS = 10_000;
const STEP_MS = 250;
/** The process name (without .exe) of each browser's windows, and what each one's window titles name. */
const PROCESS = { Chrome: 'chrome', Edge: 'msedge' } as const;
const TITLE = { Chrome: 'Google Chrome', Edge: 'Edge' } as const;

export interface OwnChromeOptions {
  /** Where Chrome or Edge is installed (tests: a fake). */
  env?: ChannelEnv;
  /** Starts the browser on its own (tests: a recorder); answers the start error once it is known. */
  start?: (exe: string, args: string[]) => () => Error | undefined;
  /** Test seam for the bounded look for the window. */
  findMs?: number;
}

/** `focused`: the window came to the front (focus_window's answer); `frame`: the fact line when its whole tree holds the browser's frame only (computer/tree.ts). */
export interface OwnChromeWindow { browser: 'Chrome' | 'Edge'; url: string; window: WindowInfo; tree: UiTree; focused: boolean; frame?: string }

/** Opens `url` in a new window of the person's own Chrome (or Edge), brings it to the front and reads that window. */
export async function openInOwnChrome(
  url: string, computer: Pick<ComputerService, 'windows' | 'screens' | 'uiTree' | 'inFront' | 'focusWindow'>, step: { signal?: AbortSignal; caller?: ComputerCaller }, options: OwnChromeOptions = {},
): Promise<OwnChromeWindow> {
  const target = normaliseUrl(url);
  const env = options.env ?? defaultChannelEnv();
  const channel = detectChannel(env);
  const browser = channel === 'chrome' ? 'Chrome' : 'Edge';
  const exe = channelCandidates(channel, env).find((file) => env.exists(file))!;
  const { window, focused } = await computer.inFront(step.caller, async () => {
    const screens = await computer.screens();
    const before = new Set((await computer.windows(step.signal)).map((open) => open.hwnd));
    const failed = (options.start ?? startDetached)(exe, ['--new-window', target]);
    const ours = (open: WindowInfo) => !before.has(open.hwnd) && open.process.toLowerCase() === PROCESS[browser] && open.title.includes(TITLE[browser]) && onScreen(open, screens);
    const found = await newWindow(computer, ours, step.signal, options.findMs ?? FIND_MS, failed, browser);
    // B-080: the same caller's lease again inside this one (a nested step of the same holder). Its presence check refusing
    // (the person works meanwhile) keeps the window behind: focused false, nothing taken from the person.
    const focused = await computer.focusWindow(found.hwnd, step.signal, step.caller).then((answer) => answer.focused, (error: unknown) => {
      if (isPresenceRefusal(error)) return false;
      throw error;
    });
    return { window: found, focused };
  });
  const tree = await computer.uiTree({ window: window.hwnd, signal: step.signal, caller: step.caller });
  const frame = tree.truncated ? undefined : frameOnly(tree.window.title || window.title, tree.text);
  return { browser, url: target, window, tree, focused, ...(frame ? { frame } : {}) };
}

/** Starts the browser detached from the runtime, its output ignored. */
function startDetached(exe: string, args: string[]): () => Error | undefined {
  let failure: Error | undefined;
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.on('error', (error) => { failure = error; });
  child.unref();
  return () => failure;
}

async function newWindow(
  computer: Pick<ComputerService, 'windows'>, ours: (window: WindowInfo) => boolean, signal: AbortSignal | undefined, findMs: number, failed: () => Error | undefined, browser: string,
): Promise<WindowInfo> {
  const until = Date.now() + findMs;
  for (;;) {
    const error = failed();
    if (error) throw new WorkforceError('unavailable', `${browser} did not start: ${error.message}`);
    const found = (await computer.windows(signal)).find(ours);
    if (found) return found;
    if (Date.now() >= until || signal?.aborted) {
      throw new WorkforceError('timeout', `I started ${browser}, but no new window of it showed within ${Math.round(findMs / 1000)} s; computer.windows lists what is open.`);
    }
    await new Promise<void>((resolve) => { const timer = setTimeout(resolve, STEP_MS); (timer as { unref?: () => void }).unref?.(); });
  }
}

/** A window on some screen (no rectangle or no screen list: I cannot tell, so it counts). */
function onScreen(window: WindowInfo, screens: ScreenInfo[]): boolean {
  if (!window.rect || !screens.length) return true;
  const [x, y, width, height] = window.rect;
  return screens.some((screen) => x < screen.x + screen.width && x + width > screen.x && y < screen.y + screen.height && y + height > screen.y);
}
