// Owns: the screenshot limit that services/feedback imports from the desktop contract (it was imported but never defined).
// Upstream 0.3.16 fixed the same import by taking FEEDBACK_SEALED_LIMIT (input.ts); the merge keeps upstream's choice,
// so the service accepts exactly what the app may send.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEEDBACK_SEALED_LIMIT } from '../../../src/shared/model/feedback-delivery.ts';
import { MAX_IMAGE_BYTES, MAX_REQUEST_BYTES } from '../../../../../services/feedback/src/input.ts';

test('the feedback service takes its screenshot limit from the contract, and its base64 fits the request limit', () => {
  assert.equal(MAX_IMAGE_BYTES, FEEDBACK_SEALED_LIMIT);
  assert.ok(Number.isInteger(MAX_IMAGE_BYTES) && MAX_IMAGE_BYTES > 0);
  assert.ok(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 < MAX_REQUEST_BYTES, 'the largest allowed screenshot fits in one request');
});
