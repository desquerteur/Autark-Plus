// 18.11.2026 (Konrad #176/#180, task_bz261n3q): a page of the side browser closed itself (window.close(), a confirmation link) and its
// tab stayed behind with `view.webContents` undefined. Every list, every save and the quit then threw
// "Cannot read properties of undefined (reading 'isDestroyed')": the browser was dead from 12:24, and an update that
// had to quit the app left it throttled from 13:06 to 22:35. These tests pin the guard and the way the tab ends.
// Owns: livePage and the source shape of its use. Never: the Electron windows themselves (see test/ui).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { livePage } from '../../../src/main/workspace-live.ts';

const src = (name: string) => readFileSync(new URL(`../../../src/main/${name}`, import.meta.url), 'utf8');
const contents = (destroyed: boolean) => ({ isDestroyed: () => destroyed }) as never;

test('livePage: a living page comes back; a destroyed one, a page that is gone and a missing tab give undefined and never throw', () => {
  const alive = contents(false);
  assert.equal(livePage({ view: { webContents: alive } }), alive);
  assert.equal(livePage({ view: { webContents: contents(true) } }), undefined, 'destroyed');
  assert.equal(livePage({ view: { webContents: undefined } }), undefined, 'the case of 18.11.: webContents undefined');
  assert.equal(livePage({ view: undefined }), undefined, 'no view');
  assert.equal(livePage({}), undefined, 'no view at all');
  assert.equal(livePage(undefined), undefined, 'no tab');
});

test('the tab list, the save and the quit never ask a page directly: every access goes through livePage', () => {
  for (const name of ['workspace-browser.ts', 'workspace-capture.ts']) {
    assert.doesNotMatch(src(name), /view\.webContents\.isDestroyed\(\)/, `${name}: a direct isDestroyed() on tab.view.webContents throws once the page closed itself`);
  }
  const browser = src('workspace-browser.ts');
  assert.match(browser, /import \{ livePage \} from '\.\/workspace-live\.ts'/);
  assert.match(browser, /private addresses\(\)[^]*?const page = livePage\(tab\)/, 'addresses() (publish, dispose, windowGone) skips a dead page');
  assert.match(browser, /dispose\(\): void \{[^]*?this\.saved\.save\(this\.addresses\(\)\)/, 'the quit saves through addresses()');
});

test('a page that closes itself ends its tab like the person\'s Close; our own close and the memory saver do not trigger it', () => {
  const browser = src('workspace-browser.ts');
  assert.match(browser, /contents\.once\('destroyed', \(\) => \{ this\.onTab\?\.\(id, null\); if \(!tab\.closing && this\.tabs\.get\(id\) === tab\) this\.command\(\{ action: 'close', id \}\); \}\);/,
    "the 'destroyed' event runs the close command for a tab that is still listed and not closing");
  const drop = /private drop\(id: string, tab: Tab\): void \{([^]*?)\n  \}/.exec(browser)?.[1] ?? '';
  assert.ok(drop.indexOf('tab.closing = true') >= 0, 'drop() marks the tab as closing');
  assert.ok(drop.indexOf('tab.closing = true') < drop.indexOf('livePage(tab)?.close()'), '…before the page is asked to close, so the event cannot fire the close command');
  assert.match(drop, /try \{[^]*?removeChildView[^]*?\} catch/, 'a view that left with its page does not break the close');
  assert.match(browser, /interface Tab \{[^}]*closing\?: boolean/);
});
