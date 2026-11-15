// B-081 (src/ui/workspace/pages.ts): another PC's website in the pane ('remote') closes through main like this PC's own
// website – the strip's ×, Ctrl+W and Close others send `close` to main and the tab leaves once main answered (the same
// timing for both kinds); no layout carries the close.
// Owns: these assertions only. Never: Electron, a real window or the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SideSpaces, WorkspaceBrowserCommand, WorkspaceBrowserPage } from '../../../src/shared/api/workspace-browser.ts';

const remote = (tab: string) => ({ id: `remote:dev_b:${tab}`, panel: 'remote', device: 'dev_b', tab, url: `https://${tab}.example/` });
const LAYOUT: SideSpaces = { global: { shown: 'remote:dev_b:web-x', tabs: [{ id: 'web-a' }, remote('web-x'), remote('web-y'), { id: 'web-b' }, remote('web-z')] } };

test("another PC's website closes through main, as this PC's own does", async () => {
  const main: WorkspaceBrowserPage[] = ['web-a', 'web-b'].map((id) => ({ id, space: 'global', url: `https://${id}.example/`, title: '', loading: false, back: false, forward: false }));
  const commands: WorkspaceBrowserCommand[] = [];
  let hold: (() => void) | undefined;
  const native = {
    command: async (command: WorkspaceBrowserCommand) => {
      commands.push(command);
      if (command.action === 'close') {
        if (hold === undefined && command.id === 'remote:dev_b:web-x') await new Promise<void>((resolve) => { hold = resolve; });
        const at = main.findIndex((item) => item.id === command.id);
        if (at >= 0) main.splice(at, 1);
      }
      return [...main];
    },
    onChanged: () => () => undefined,
    layout: async () => LAYOUT,
    onLayout: () => () => undefined,
  };
  Object.assign(globalThis, {
    window: { workforce: { connect: () => undefined, workspaceBrowser: native } },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
  const pages = await import('../../../src/ui/workspace/pages.ts');
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  const ids = () => pages.tabsOf('global').map((item) => item.id);
  const closes = () => commands.filter((command) => command.action === 'close').map((command) => (command as { id: string }).id);
  const layouts = () => commands.filter((command) => command.action === 'layout').length;
  pages.watchPersonalBrowser();
  await settle();
  assert.deepEqual(ids(), ['web-a', 'remote:dev_b:web-x', 'remote:dev_b:web-y', 'web-b', 'remote:dev_b:web-z']);

  const sentBefore = layouts();
  const closing = pages.closePage('remote:dev_b:web-x'); // the × on the shown remote tab in the middle
  await settle();
  assert.deepEqual(closes(), ['remote:dev_b:web-x'], 'main hears the close itself');
  assert.ok(ids().includes('remote:dev_b:web-x'), 'it stays until main answered, as a website does');
  assert.equal(layouts(), sentBefore, 'no layout went before the close');
  hold!();
  await closing;
  assert.deepEqual(ids(), ['web-a', 'remote:dev_b:web-y', 'web-b', 'remote:dev_b:web-z']);
  assert.equal(pages.shownOf('global'), 'remote:dev_b:web-y', 'the next one is shown');

  await pages.closeOthers('web-b');
  assert.deepEqual(closes(), ['remote:dev_b:web-x', 'web-a', 'remote:dev_b:web-y', 'remote:dev_b:web-z'], 'Close others sends each website, of this PC or another');
  assert.deepEqual(ids(), ['web-b']);
});
