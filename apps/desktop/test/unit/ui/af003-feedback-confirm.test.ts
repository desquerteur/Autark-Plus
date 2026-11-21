// AF-003 in the form's words: Bug or Idea (Bug unless chosen), "Sent. Report no. …" after a delivery
// (upstream 0.3.16 doneText), "Not sent." first when a send was not confirmed, and the number in Settings › Feedback's report line.
// Owns: these assertions. Never: RPC or rendering.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doneText } from '../../../src/ui/feedback/delivery.ts';
import { DRAFT_KINDS, draftKind, EMPTY_DRAFT } from '../../../src/ui/feedback/draft.ts';
import { reportLine } from '../../../src/ui/settings/feedback-text.ts';

const RECEIPT = '668fc8de-df52-405c-8743-d264e47cfadd';

test('the form offers Bug and Idea; a new draft is a Bug', () => {
  assert.deepEqual(DRAFT_KINDS.map((option) => [option.kind, option.label]), [['bug', 'Bug'], ['idea', 'Idea']]);
  assert.equal(draftKind(EMPTY_DRAFT), 'bug');
  assert.equal(draftKind({ kind: 'idea' }), 'idea');
  assert.equal(draftKind({ kind: undefined }), 'bug');
});

test('after Send: the confirmation with the number; an unconfirmed send never reads like a success', () => {
  assert.equal(doneText({ status: 'sent', receiptId: RECEIPT }, true, true), 'Sent. Report no. 668FC8DE');
  assert.equal(doneText({ status: 'sent' }, true, true), 'Sent.', 'no receipt, no number');
  assert.equal(doneText({ status: 'local', receiptId: RECEIPT }, true, true), 'Not sent. Your report is saved on this PC.', 'only a delivered report has a number');
  assert.equal(doneText({ status: 'local' }, true, false), 'Not sent. Your report is saved on your PC.');
  assert.equal(doneText({ status: 'local' }, false, true), 'Saved on this PC – sending is not set up.');
});

test('Settings › Feedback: a delivered report shows its number', () => {
  const when = () => 'then';
  const base = { kind: 'idea' as const, author: 'human', status: 'sent' as const, createdAt: 1, receiptId: RECEIPT };
  assert.equal(reportLine(base, () => 'Ada', when), 'Idea · Sent to the team · No. 668FC8DE · then');
  assert.equal(reportLine({ ...base, status: 'local' }, () => 'Ada', when), 'Idea · Saved on this PC · then', 'not sent: no number');
});
