// Owns: feedback 16.11.2026 F10 – only a confirmed send closes the feedback form by itself (src/ui/feedback/delivery.ts).
// Never: renders the form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SENT_CLOSE_MS, closesBySelf } from '../../../src/ui/feedback/delivery.ts';

test('a confirmed send closes by itself; saved, queued or failed reports wait for the person', () => {
  assert.equal(closesBySelf({ status: 'sent' }, null), true);
  assert.equal(closesBySelf({ status: 'sent' }, 'The mailbox did not answer.'), false, 'an error stays readable');
  for (const status of ['local', 'draft', 'queued', 'received', 'dismissed'] as const) assert.equal(closesBySelf({ status }, null), false, status);
  assert.equal(closesBySelf(null, null), false);
  assert.ok(SENT_CLOSE_MS >= 1500 && SENT_CLOSE_MS <= 4000, 'long enough to read "Sent. Report no. …"');
});
