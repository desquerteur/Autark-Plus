// B-080 (browser-botblock E): reading one page in the agent's own browser (browser/read-page.ts) – a new tab, its text,
// that tab closed again, also when the text cannot be read or the navigation failed after the tab was made; the tab
// active before is active again; the page's human check is reported.
// Owns: these assertions only. Never: a real browser (a fake BrowserService).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserReader } from '../../../src/runtime/browser/read-page.ts';
import type { BrowserService } from '../../../src/runtime/browser/service.ts';

/** A fake browser with tabs t1 (active) and t2 open; open makes t3 and makes it active, like BrowserService.navigate. */
function fake(options: { check?: boolean; extractFails?: boolean; gotoFails?: boolean; tabs?: string[]; active?: string } = {}) {
  const calls: string[] = [];
  const open = [...(options.tabs ?? ['t1', 't2'])];
  let active: string | undefined = options.active ?? open[0];
  const list = () => ({ tabs: open.map((tab) => ({ tab, url: `https://${tab}.example`, title: tab, active: tab === (active ?? open.at(-1)) })), downloads: [] });
  const browser = {
    open: async (agentId: string, input: { url: string; newTab?: boolean }) => {
      calls.push(`open ${agentId} ${input.url} ${input.newTab ? 'new' : 'same'}`);
      open.push('t3');
      active = 't3';
      if (options.gotoFails) throw new Error('net::ERR_CONNECTION_RESET');
      return { tab: 't3', url: input.url, title: 'News', snapshot: '', truncated: false, ...(options.check ? { humanCheck: true as const } : {}) };
    },
    extract: async (_agentId: string, input: { tab?: string; maxChars?: number }) => {
      calls.push(`extract ${input.tab} ${input.maxChars}`);
      if (options.extractFails) throw new Error('The page closed.');
      return { text: 'Startups raised 4 billion.', truncated: false, tab: 't3', url: 'https://example.com/news', title: 'News' };
    },
    tabs: async (_agentId: string, input: { close?: string; activate?: string } = {}) => {
      if (input.close) {
        calls.push(`close ${input.close}`);
        open.splice(open.indexOf(input.close), 1);
        if (active === input.close) active = undefined; // as BrowserService.tabs: the last open page counts as active
      }
      if (input.activate) {
        calls.push(`activate ${input.activate}`);
        if (!open.includes(input.activate)) throw new Error('No such tab.');
        active = input.activate;
      }
      return list();
    },
  } as unknown as Pick<BrowserService, 'open' | 'extract' | 'tabs'>;
  return { read: browserReader(browser), calls, open, active: () => active ?? open.at(-1) };
}

test('a new tab, its text, the tab closed; a page that still shows a check says so', async () => {
  const f = fake();
  const page = await f.read('ag_lena', 'https://example.com/news', { maxChars: 4000 });
  assert.deepEqual(page, { text: 'Startups raised 4 billion.', truncated: false, url: 'https://example.com/news', title: 'News', humanCheck: false });
  assert.deepEqual(f.calls, ['open ag_lena https://example.com/news new', 'extract t3 4000', 'close t3', 'activate t1']);
  assert.equal((await fake({ check: true }).read('ag_lena', 'https://example.com/news')).humanCheck, true);
});

test('the tab active before is active again after the read (not the last open one)', async () => {
  const f = fake();
  await f.read('ag_lena', 'https://example.com/news');
  assert.deepEqual(f.open, ['t1', 't2']);
  assert.equal(f.active(), 't1');
});

test('the tab is closed also when its text cannot be read', async () => {
  const f = fake({ extractFails: true });
  await assert.rejects(f.read('ag_lena', 'https://example.com/news'), /The page closed/);
  assert.deepEqual(f.calls.slice(-2), ['close t3', 'activate t1']);
  assert.equal(f.active(), 't1');
});

test('a navigation that fails after the tab was made leaves no stray tab and the active tab as it was', async () => {
  const f = fake({ gotoFails: true });
  await assert.rejects(f.read('ag_lena', 'https://example.com/news'), /ERR_CONNECTION_RESET/);
  assert.deepEqual(f.open, ['t1', 't2']);
  assert.equal(f.active(), 't1');
  assert.ok(f.calls.includes('close t3'));
});

test('a browser without tabs before has none after', async () => {
  const f = fake({ tabs: [], gotoFails: true });
  await assert.rejects(f.read('ag_lena', 'https://example.com/news'));
  assert.deepEqual(f.open, []);
  assert.ok(!f.calls.some((call) => call.startsWith('activate')));
});
