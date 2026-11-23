// B-081: the Pin button between the app window and a side tab – the window's 'pick' command (workspace-commands.ts),
// the tab's picking state and its pins to the app window as the key event 'pick' with the kept address
// (workspace-chrome.ts), the driver switching the page's picker (driver.ts pick, tab.ts setPicking), pins only from the
// top frame's world (checked, never an agent's own click), the picker armed again in a new document of the main frame,
// a watcher's input (caster.ts) past the picker like an agent's act batch, and the person's hover report with its short selector.
// Owns: these assertions only. Never: Electron, a real page or a window.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SideCaster } from '../../../src/main/side-driver/caster.ts';
import { WORLD } from '../../../src/main/side-driver/cdp.ts';
import { PERSON_PRIORITY_MS, SideDriver } from '../../../src/main/side-driver/driver.ts';
import { browserCommand } from '../../../src/main/workspace-commands.ts';
import { TabChrome } from '../../../src/main/workspace-chrome.ts';
import { WORKSPACE_BROWSER } from '../../../src/shared/api/workspace-browser.ts';
import type { PickedElement } from '../../../src/shared/model/page-pick.ts';
import { FakeContents, checkoutTree, fakeBrowser, pageHandlers } from './side-driver-fakes.ts';

const agent = { id: 'ag_ada', name: 'Ada' };
const wirePin = { k: 'pick', sel: 'button.pay', tag: 'button', role: 'button', text: 'Pay', box: { x: 100, y: 100, w: 80, h: 32 }, at: { x: 120, y: 130 }, edge: 'bottom', st: { color: 'rgb(255, 255, 255)' } };

function setup() {
  const clock = { now: 1_000_000 };
  const contents = new FakeContents(clock);
  const dbg = contents.debugger;
  pageHandlers(dbg, { tree: checkoutTree() });
  const answer = dbg.handlers['Runtime.evaluate']!;
  dbg.handlers['Runtime.evaluate'] = (p) => { const on = /^__wfSide\.pick\((true|false), (true|false)\)$/.exec(String(p.expression)); return on ? { result: { value: on[1] === 'true' } } : answer(p); };
  const picked: Array<[string, PickedElement | null]> = [];
  const browser = Object.assign(fakeBrowser({ 'web-1': contents }), { sidePicked: (id: string, pick: PickedElement | null) => { picked.push([id, pick]); } });
  const points: any[] = [];
  const driver = new SideDriver({
    browser: () => browser, pointer: (point) => points.push(point), person: () => ({ kind: 'person', id: 'owner', name: 'Lukas' }),
    now: () => clock.now, sleep: async (ms) => { clock.now += ms; },
  });
  driver.tab('web-1', contents as never);
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return { clock, dbg, driver, picked, points, settle };
}

test('the driver switches the page’s picker; pins come only from the top frame, checked, never an agent’s own click', async () => {
  const { clock, dbg, driver, picked, settle } = setup();
  await driver.side('web-1')!.cdp.ready(); // (pressed during the tab's setup, its new world is armed by its own event too)
  assert.equal(await driver.pick('web-1', true), true);
  assert.deepEqual(dbg.evals('__wfSide.pick('), ['__wfSide.pick(true, false)']);
  dbg.report(wirePin);
  assert.equal(picked.length, 1);
  assert.deepEqual(picked[0], ['web-1', { selector: 'button.pay', tag: 'button', role: 'button', text: 'Pay', box: { x: 100, y: 100, width: 80, height: 32 }, at: { x: 120, y: 130 }, edge: 'bottom', styles: { color: 'rgb(255, 255, 255)' } }]);
  dbg.emit('Runtime.executionContextCreated', { context: { id: 9, name: WORLD, auxData: { frameId: 'frame-ad' } } });
  dbg.report(wirePin, 9); // an iframe's world
  dbg.report(wirePin, 77); // nobody's
  dbg.report({ ...wirePin, text: 'x'.repeat(5000) }); // over the binding's 4000 chars
  dbg.report({ ...wirePin, box: { x: 'a' } }); // not a pin
  assert.equal(picked.length, 1, 'none of these is a pin');
  // An agent's own click at the same place is not the person's pin (once the person's pin no longer holds the tab).
  clock.now += PERSON_PRIORITY_MS + 1;
  await driver.call({ action: 'snapshot', agent });
  await driver.call({ action: 'act', agent, steps: [{ action: 'click', ref: 's24' }] });
  dbg.report({ ...wirePin, at: { x: 140, y: 116 } });
  assert.equal(picked.length, 1, 'the agent’s click at 140,116');
  clock.now += 1500;
  dbg.report({ ...wirePin, at: { x: 140, y: 116 } });
  assert.equal(picked.length, 2, 'the person’s own pin where the agent clicked a while ago');
  // A new document of the main frame: armed again, once; another frame's or the page's own world: not.
  await settle();
  const before = dbg.named('Runtime.evaluate').length;
  dbg.emit('Runtime.executionContextCreated', { context: { id: 6, name: WORLD, auxData: { frameId: 'main' } } });
  dbg.emit('Runtime.executionContextCreated', { context: { id: 10, name: WORLD, auxData: { frameId: 'frame-ad' } } });
  dbg.emit('Runtime.executionContextCreated', { context: { id: 11, name: '', auxData: { frameId: 'main', isDefault: true } } });
  await settle();
  const rearmed = dbg.named('Runtime.evaluate').slice(before);
  assert.deepEqual(rearmed.map((call) => [call.params.expression, call.params.contextId]), [['__wfSide.pick(true, false)', 6]]);
  // Escape in the page ends it: the window hears null, a later document is not armed.
  dbg.report({ k: 'pick', off: 1 });
  assert.deepEqual(picked.at(-1), ['web-1', null]);
  dbg.emit('Runtime.executionContextCreated', { context: { id: 12, name: WORLD, auxData: { frameId: 'main' } } });
  await settle();
  assert.equal(dbg.named('Runtime.evaluate').filter((call) => call.params.contextId === 12).length, 0);
  // A tab the driver does not hold: no picker, the button goes back.
  assert.equal(await driver.pick('web-9', true), false);
  assert.deepEqual(picked.at(-1), ['web-9', null]);
});

test('the button’s wish wins: on, then off before the page answered – off, no new document armed', async () => {
  const { dbg, driver, settle } = setup();
  await driver.call({ action: 'snapshot', agent }); // the tab is set up
  const evaluate = dbg.handlers['Runtime.evaluate']!;
  let answer = () => {};
  dbg.handlers['Runtime.evaluate'] = (p) => (String(p.expression) === '__wfSide.pick(true, false)'
    ? new Promise((resolve) => { answer = () => resolve({ result: { value: true } }); }) : evaluate(p));
  const on = driver.pick('web-1', true);
  const off = driver.pick('web-1', false);
  assert.equal(await off, true);
  await settle();
  answer(); // the page's late answer to the first call
  await on;
  assert.equal(driver.side('web-1')?.picking, false);
  dbg.emit('Runtime.executionContextCreated', { context: { id: 6, name: WORLD, auxData: { frameId: 'main' } } });
  await settle();
  assert.equal(dbg.named('Runtime.evaluate').filter((call) => call.params.contextId === 6).length, 0);
});

test('an agent’s act batch in a picking tab: the picker holds meanwhile, so the click reaches the page', async () => {
  const { clock, dbg, driver, settle } = setup();
  await driver.pick('web-1', true);
  clock.now += PERSON_PRIORITY_MS + 1;
  await driver.call({ action: 'snapshot', agent });
  const order = async () => {
    const before = dbg.calls.length;
    const out = await driver.call({ action: 'act', agent, steps: [{ action: 'click', ref: 's24' }] });
    await settle();
    assert.equal(out.ok, true);
    return dbg.calls.slice(before).filter((call) => /^__wfSide\.pick/.test(String(call.params?.expression)) || call.params?.type === 'mousePressed')
      .map((call) => call.params.expression ?? call.params.type);
  };
  assert.deepEqual(await order(), ['__wfSide.pick(true, true)', 'mousePressed', '__wfSide.pick(true, false)']);
  await driver.pick('web-1', false);
  assert.deepEqual(await order(), ['mousePressed'], 'not picking: nothing extra');
});

test('a watcher’s input in a picking tab (caster.ts) goes past the picker as it is, also when the page refuses it', async () => {
  const { dbg, driver, settle } = setup();
  await driver.pick('web-1', true);
  const caster = new SideCaster({ tab: (id) => driver.side(id), send: () => {} });
  const mouse = (type: string) => ({ method: 'Input.dispatchMouseEvent', params: { type, x: 10, y: 20, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 } });
  const order = async (commands: unknown[]) => {
    const before = dbg.calls.length;
    await caster.input({ tab: 'web-1', commands }).catch(() => undefined);
    await settle();
    return dbg.calls.slice(before).filter((call) => /^__wfSide\.pick/.test(String(call.params?.expression)) || call.method === 'Input.dispatchMouseEvent')
      .map((call) => call.params.expression ?? call.params.type);
  };
  assert.deepEqual(await order([mouse('mousePressed'), mouse('mouseReleased')]), ['__wfSide.pick(true, true)', 'mousePressed', 'mouseReleased', '__wfSide.pick(true, false)']);
  dbg.handlers['Input.dispatchMouseEvent'] = () => { throw new Error('gone'); };
  assert.deepEqual(await order([mouse('mousePressed')]), ['__wfSide.pick(true, true)', 'mousePressed', '__wfSide.pick(true, false)'], 'the hold ends with a refused input too');
  delete dbg.handlers['Input.dispatchMouseEvent'];
  await driver.pick('web-1', false);
  assert.deepEqual(await order([mouse('mousePressed')]), ['mousePressed'], 'not picking: nothing extra');
});

test('the person’s hover report carries a short selector to the pointer hub', async () => {
  const { dbg, driver, points } = setup();
  await driver.call({ action: 'snapshot', agent });
  dbg.report({ k: 'in', e: 'move', x: 300, y: 40, target: { role: 'button', name: 'Pay', sel: `div.card > ${'b'.repeat(200)}` } });
  const point = points.at(-1);
  assert.equal(point.surface, 'side:web-1');
  assert.deepEqual([point.target.role, point.target.name, point.target.selector.length], ['button', 'Pay', 100]);
  dbg.report({ k: 'in', e: 'move', x: 310, y: 40, target: { sel: 'main > p' } });
  assert.deepEqual(points.at(-1).target, { selector: 'main > p' }, 'a selector alone is a target too');
});

test('the window’s pick command: a tab id and on as true or false', () => {
  assert.deepEqual(browserCommand({ action: 'pick', id: 'web-a', on: true }), { action: 'pick', id: 'web-a', on: true });
  assert.equal(browserCommand({ action: 'pick', id: 'web-a', on: false }).action, 'pick');
  for (const bad of [{ action: 'pick', id: 'web-a' }, { action: 'pick', id: 'web-a', on: 'yes' }, { action: 'pick', id: 'remote:dev_b:web-x', on: true }, { action: 'pick', on: true }]) {
    assert.throws(() => browserCommand(bad), /Invalid browser/, JSON.stringify(bad));
  }
});

function chrome(withPick = true) {
  const sent: Array<[string, unknown]> = [];
  const asked: Array<[string, boolean]> = [];
  let published = 0;
  const window = { isDestroyed: () => false, webContents: { send: (channel: string, value: unknown) => { sent.push([channel, value]); } } };
  const host = { window: () => window as never, publish: () => { published += 1; }, mainKey: () => {}, agentTab: () => false, ...(withPick ? { pick: (id: string, on: boolean) => { asked.push([id, on]); } } : {}) };
  const tabs = new TabChrome(host);
  const url = 'https://shop.example/cart?token=abc#x';
  const contents = { on: () => undefined, getURL: () => url, isDestroyed: () => false, getZoomFactor: () => 1, isCurrentlyAudible: () => false, isAudioMuted: () => false };
  tabs.attach('web-1', contents as never);
  return { tabs, contents: contents as never, sent, asked, published: () => published };
}

test('TabChrome: the Pin button’s state on the page entry, pins to the window with the kept address, the end', () => {
  const c = chrome();
  c.tabs.command('web-1', c.contents, { action: 'pick', id: 'web-1', on: true });
  assert.deepEqual(c.asked, [['web-1', true]]);
  assert.equal(c.tabs.extras('web-1', c.contents).picking, true);
  const pick: PickedElement = { selector: 'button.pay', tag: 'button', box: { x: 1, y: 2, width: 3, height: 4 }, styles: {} };
  c.tabs.picked('web-1', c.contents, pick);
  assert.deepEqual(c.sent, [[WORKSPACE_BROWSER.key, { id: 'web-1', action: 'pick', pick: { ...pick, tab: 'web-1', url: 'https://shop.example/cart' } }]], 'no token in the address');
  c.tabs.picked('web-1', c.contents, null);
  assert.equal(c.tabs.extras('web-1', c.contents).picking, undefined);
  assert.equal(c.published(), 1, 'the button goes back');
  c.tabs.picked('web-1', c.contents, pick);
  assert.equal(c.sent.length, 1, 'no pin while the button is off');
  c.tabs.command('web-1', c.contents, { action: 'pick', id: 'web-1', on: true });
  c.tabs.command('web-1', c.contents, { action: 'pick', id: 'web-1', on: false });
  assert.deepEqual(c.asked.at(-1), ['web-1', false]);
  const none = chrome(false);
  none.tabs.command('web-1', none.contents, { action: 'pick', id: 'web-1', on: true });
  assert.equal(none.tabs.extras('web-1', none.contents).picking, undefined, 'without the side driver the button stays off');
});
