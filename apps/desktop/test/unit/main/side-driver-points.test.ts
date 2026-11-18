// fb_1m7mtty0aszywt5y0 (17.11.2026, Discord sign-up in the person's browser): type with a stored secret into a custom
// combobox failed with "not a text field", and nothing could click a point inside an element (an image CAPTCHA's tile).
// Now: type into an element that is no text field clicks it and presses real keys; a click with a ref and x/y goes to
// that point inside the element, and a point outside it is refused in one sentence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SideDriver } from '../../../src/main/side-driver/driver.ts';
import { FakeContents, checkoutTree, fakeBrowser, pageHandlers } from './side-driver-fakes.ts';

const agent = { id: 'ag_jonas', name: 'Jonas' };

function setup(notText = new Set<number>(), focused = true) {
  const clock = { now: 1_000_000 };
  const contents = new FakeContents(clock);
  pageHandlers(contents.debugger, { tree: checkoutTree(), quads: { 30: [200, 300, 500, 300, 500, 450, 200, 450] } });
  const dbg = contents.debugger;
  const call = dbg.handlers['Runtime.callFunctionOn']!;
  dbg.handlers['Runtime.callFunctionOn'] = (p) => {
    const id = Number(String(p.objectId).replace('obj-', ''));
    if (String(p.functionDeclaration).includes('editable') && notText.has(id)) return { result: { value: { editable: false, disabled: false, readonly: false, direct: false } } };
    return call(p);
  };
  const evaluate = dbg.handlers['Runtime.evaluate']!;
  dbg.handlers['Runtime.evaluate'] = (p) => (String(p.expression).includes('document.activeElement') ? { result: { value: focused } } : evaluate(p));
  const browser = fakeBrowser({ 'web-1': contents });
  const driver = new SideDriver({ browser: () => browser, pointer: () => {}, person: () => ({ kind: 'person', id: 'owner', name: 'Alex' }), now: () => clock.now, sleep: async (ms) => { clock.now += ms; } });
  driver.tab('web-1', contents as never);
  return { driver, dbg };
}

const typed = (dbg: ReturnType<typeof setup>['dbg']) => dbg.named('Input.dispatchKeyEvent').filter((call) => call.params.type === 'keyDown').map((call) => call.params.text).join('');

test('type into a combobox that is no text field: a click on it, then real key presses – no insertText, no "not a text field"', async () => {
  const { driver, dbg } = setup(new Set([22]));
  await driver.call({ action: 'snapshot', agent });
  const out = await driver.call({ action: 'act', agent, steps: [{ action: 'type', ref: 's22', value: 'Mai 1990' }] });
  assert.equal(out.ok, true, out.error);
  const presses = dbg.named('Input.dispatchMouseEvent').filter((call) => call.params.type === 'mousePressed');
  assert.equal(presses.length, 1, 'clicked it like a person');
  assert.equal(dbg.named('Input.insertText').length, 0);
  assert.equal(typed(dbg), 'Mai 1990', 'every character as a key press, the space too');
});

test('type into a text field still inserts the text at once; without a ref, the focused field decides', async () => {
  const field = setup();
  await field.driver.call({ action: 'act', agent, steps: [{ action: 'type', ref: 's20', value: 'bob' }] });
  assert.deepEqual(field.dbg.named('Input.insertText').map((call) => call.params.text), ['bob']);
  const custom = setup(new Set(), false);
  await custom.driver.call({ action: 'act', agent, steps: [{ action: 'type', value: '12' }] });
  assert.equal(custom.dbg.named('Input.insertText').length, 0);
  assert.equal(typed(custom.dbg), '12', 'nothing that takes text is focused: real keys');
});

test('click with a ref and x/y: at that point inside the element; a point outside it is refused', async () => {
  const { driver, dbg } = setup();
  const out = await driver.call({ action: 'act', agent, steps: [{ action: 'click', ref: 's30', x: 50, y: 120 }] });
  assert.equal(out.ok, true, out.error);
  const press = dbg.named('Input.dispatchMouseEvent').find((call) => call.params.type === 'mousePressed')!;
  assert.deepEqual([press.params.x, press.params.y], [250, 420], 'element top-left 200,300 plus 50,120');
  const outside = await driver.call({ action: 'act', agent, steps: [{ action: 'click', ref: 's30', x: 400, y: 10 }] });
  assert.equal(outside.ok, false);
  assert.match(outside.error!, /The point 400,10 is outside the element s30 \(300×150\)\./);
});
