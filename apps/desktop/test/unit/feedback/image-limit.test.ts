// Owns: the screenshot limit that services/feedback imports from the desktop contract (it was imported but never defined).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEEDBACK_IMAGE_LIMIT, FEEDBACK_SEALED_LIMIT } from '../../../src/shared/model/feedback-delivery.ts';
import { MAX_IMAGE_BYTES, MAX_REQUEST_BYTES } from '../../../../../services/feedback/src/input.ts';

test('the feedback service takes its screenshot limit from the contract, and its base64 fits the request limit', () => {
  assert.equal(MAX_IMAGE_BYTES, FEEDBACK_IMAGE_LIMIT);
  assert.ok(Number.isInteger(FEEDBACK_IMAGE_LIMIT) && FEEDBACK_IMAGE_LIMIT > 0);
  assert.ok(Math.ceil(FEEDBACK_IMAGE_LIMIT / 3) * 4 < MAX_REQUEST_BYTES, 'the largest allowed screenshot fits in one request');
  assert.ok(FEEDBACK_IMAGE_LIMIT >= FEEDBACK_SEALED_LIMIT / 2, 'not stricter than what the app sends');
});
