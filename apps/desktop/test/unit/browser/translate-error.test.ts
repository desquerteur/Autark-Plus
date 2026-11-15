// translateError (runtime/browser/page.ts) turns a Playwright action error into one sentence for the agent.
// B-081: a page element covered by another is named from Playwright's own log ("<…> lies over it"), instead of the old
// guess "something else covers it (a dialog or banner?)", so the agent knows what to dismiss or click first.
// Owns: these assertions only. Never: a real page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateError } from '../../../src/runtime/browser/page.ts';

const COVERED = 'locator.click: Timeout 10000ms exceeded.\nCall log:\n'
  + '  - waiting for element to be visible, enabled and stable\n'
  + '  - <span class="checkmark"></span> from <label class="switch">Dark mode</label> subtree intercepts pointer events';

test('a covered element: the error names what lies over it, from Playwright\'s log', () => {
  const out = translateError(new Error(COVERED), { ref: 'e73' });
  assert.equal(out.code, 'timeout');
  assert.match(out.message, /element e73: <span class="checkmark"> lies over it/);
  assert.doesNotMatch(out.message, /a dialog or banner/);
});

test('a simple overlay tag is named too', () => {
  const out = translateError(new Error('locator.click: Timeout 5000ms exceeded.\n  - <div class="cookie-wall">…</div> intercepts pointer events'), { ref: 'e5' });
  assert.match(out.message, /<div class="cookie-wall"> lies over it/);
});

test('intercepts pointer events with no named element falls back to a short phrase, not the old guess', () => {
  const out = translateError(new Error('locator.click: Timeout 10000ms exceeded.\n  - intercepts pointer events'), undefined);
  assert.match(out.message, /something else covers it/);
  assert.doesNotMatch(out.message, /a dialog or banner/);
});
