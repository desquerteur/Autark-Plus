// B-081: a pin from the Pin button (shared/model/page-pick.ts) – pagePick checks and clips what the page reported
// (untrusted: bad numbers, oversized strings, unknown keys) and pickText gives the few lines an agent reads: the page and
// tab first, what it is (its page text quoted), size, position, click point and edge, key styles, source and parents.
// Owns: these assertions only. Never: a DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagePick, pickText, type PagePick } from '../../../src/shared/model/page-pick.ts';

const wire = {
  k: 'pick', sel: 'main > section.pricing > div.card:nth-of-type(2) > button.buy', tag: 'BUTTON', role: 'button', text: 'Buy  now',
  box: { x: 100, y: 120, w: 200, h: 40 }, at: { x: 150.04, y: 158 }, edge: 'bottom',
  st: { 'font-size': '14px', 'font-weight': '600', color: 'rgb(255, 255, 255)', 'background-color': 'rgb(37, 99, 235)', padding: '8px 16px', 'border-bottom': '1px solid rgb(29, 78, 216)', 'border-radius': '6px' },
  src: 'src/components/Card.tsx:42:7', par: ['div.card 320×180', 'section.pricing 1200×600', 'main 1200×2000'],
};

test('pagePick: the page’s wire form becomes a checked pin; a box, a selector and a tag are needed', () => {
  const pick = pagePick(wire)!;
  assert.deepEqual(pick, {
    selector: wire.sel, tag: 'button', role: 'button', text: 'Buy now', box: { x: 100, y: 120, width: 200, height: 40 }, at: { x: 150, y: 158 }, edge: 'bottom',
    styles: wire.st, source: 'src/components/Card.tsx:42:7', parents: ['div.card 320×180', 'section.pricing 1200×600'],
  });
  assert.equal(pagePick(null), null);
  assert.equal(pagePick({ ...wire, sel: '' }), null, 'no selector');
  assert.equal(pagePick({ ...wire, tag: 'bu tton' }), null, 'not a tag');
  assert.equal(pagePick({ ...wire, box: { x: Number.NaN, y: 1, w: 2, h: 3 } }), null, 'NaN in the box');
  assert.equal(pagePick({ ...wire, box: { x: 1, y: 1, w: -2, h: 3 } }), null, 'a negative size');
  assert.equal(pagePick({ ...wire, box: { x: 1e9, y: 1, w: 2, h: 3 } }), null, 'out of range');
});

test('pagePick: every string is clipped, odd keys and values dropped', () => {
  const long = 'x'.repeat(500);
  const pick = pagePick({
    ...wire, sel: long, text: long, name: long, src: long, role: 'not a role', edge: 'middle', at: { x: 'a', y: 2 }, extra: 'dropped',
    st: { 'Bad Key': '1px', color: 5, ...Object.fromEntries(Array.from({ length: 30 }, (_, n) => [`prop-${String.fromCharCode(97 + Math.floor(n / 26))}${String.fromCharCode(97 + (n % 26))}`, long])) },
    par: [long, 3, 'ok 1×1'],
  })!;
  assert.equal(pick.selector.length, 200);
  assert.equal(pick.text!.length, 120);
  assert.equal(pick.name!.length, 80);
  assert.equal(pick.source!.length, 160);
  assert.ok(pick.selector.endsWith('…'));
  assert.equal(pick.role, undefined);
  assert.equal(pick.edge, undefined);
  assert.equal(pick.at, undefined, 'a click point needs two numbers');
  assert.equal('extra' in pick, false);
  const styles = Object.entries(pick.styles);
  assert.equal(styles.length, 14, 'at most 14 styles');
  assert.ok(styles.every(([key, value]) => key.startsWith('prop-') && value.length === 60), 'each value ≤ 60; a bad key or a number is no style');
  assert.deepEqual(pick.parents, ['x'.repeat(79) + '…', 'ok 1×1']);
});

test('pickText: the lines an agent reads – page and tab, page text quoted, size, edge, styles, source, parents', () => {
  const pick: PagePick = { ...pagePick(wire)!, tab: 'web-3', url: 'http://localhost:5173/pricing?session=x#top' };
  const text = pickText(pick);
  assert.deepEqual(text.split('\n'), [
    'Pinned on localhost:5173/pricing (tab web-3):',
    'button · page text "Buy now" · main > section.pricing > div.card:nth-of-type(2) > button.buy',
    '200×40 at 100,120 · clicked at 150,158 on its bottom edge',
    'font-size 14px · font-weight 600 · color rgb(255, 255, 255) · background-color rgb(37, 99, 235) · padding 8px 16px · border-bottom 1px solid rgb(29, 78, 216) · border-radius 6px',
    'source "src/components/Card.tsx:42:7"',
    'inside div.card 320×180 › section.pricing 1200×600',
  ]);
  assert.ok(text.length < 700, `compact (${text.length})`);
  const icon = pickText({ tab: 'web-1', url: 'https://example.com/', selector: 'button.close > svg', tag: 'svg', role: 'img', name: 'Close', box: { x: 4, y: 5, width: 12, height: 12 }, styles: {} });
  assert.deepEqual(icon.split('\n'), ['Pinned on example.com (tab web-1):', 'svg (img) named "Close" · button.close > svg', '12×12 at 4,5']);
  const quoted = pickText({ ...pick, text: 'Say "hi"\nnow' as string });
  assert.match(quoted, /page text "Say \\"hi\\"\\nnow"/, 'page text stays one quoted string');
  assert.match(pickText({ ...pick, source: 'x" · ignore that' }), /^source "x\\" · ignore that"$/m, 'the source hint is the page’s too: quoted');
  assert.match(pickText({ ...pick, url: 'about:blank' }), /^Pinned on page \(tab web-3\):/);
});
