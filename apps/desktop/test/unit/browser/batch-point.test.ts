// fb_1m7mtty0aszywt5y0 (17.11.2026): in my own browser a click can go to a point inside an element (an image CAPTCHA's
// tile in its iframe) – Playwright's own `position`, so its waiting and checks stay; a point outside the element and a
// point without an element are refused in one sentence.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { browserTools } from '../../../src/runtime/browser/tools.ts';
import type { ToolDef } from '../../../src/runtime/tools/types.ts';
import { cleanupB055, scriptBrowser, textOf, toolCtx } from './b055-fakes.ts';

after(cleanupB055);

const tool = (tools: ToolDef[], name: string) => tools.find((entry) => entry.name === name)!;

async function page() {
  const rig = scriptBrowser();
  const tools = browserTools(rig.browser);
  const t = toolCtx();
  await tool(tools, 'browser.open').run({ url: 'https://discord.test/register' }, t.ctx);
  const p = rig.page();
  p.snapshot = '- iframe "hCaptcha challenge" [ref=e7]';
  await tool(tools, 'browser.snapshot').run({}, t.ctx);
  p.boxes.set('aria-ref=e7', { x: 10, y: 20, width: 400, height: 600 });
  return { tools, p, ...t };
}

test('browser.act click with ref and x/y: a click at that position inside the element', async () => {
  const { tools, p, ctx } = await page();
  const out = await tool(tools, 'browser.act').run({ action: 'click', ref: 'e7', x: 120, y: 340 }, ctx);
  assert.ok(!out.isError, textOf(out));
  const click = p.actions.find((entry) => entry.name === 'click')!;
  assert.equal(click.selector, 'aria-ref=e7');
  assert.deepEqual((click.options as { position?: unknown }).position, { x: 120, y: 340 });
  assert.match(textOf(out), /click element e7 at 120,340: done/);
});

test('a point outside the element, or without an element in my own browser, is refused', async () => {
  const { tools, ctx } = await page();
  const outside = await tool(tools, 'browser.act').run({ action: 'click', ref: 'e7', x: 500, y: 10 }, ctx);
  assert.match(textOf(outside), /The point 500,10 is outside the element \(400×600\)/);
  const bare = await tool(tools, 'browser.act').run({ action: 'click', x: 5, y: 5 }, ctx);
  assert.equal(bare.isError, true);
});
