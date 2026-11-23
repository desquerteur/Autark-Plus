// What only repeats the title is left out of My day's rows (src/ui/day/day-repeat.ts; Mika 17.11.2026, points 3 and 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repeatsTitle, withoutRepeat } from '../../../src/ui/day/day-repeat.ts';

const TITLE = 'Social start: eight short questions so the first posts sound like you and can go out this week';

test('a sentence that is part of the title is a repeat, whatever its case, full stop or ellipsis', () => {
  assert.equal(repeatsTitle('So the first posts sound like you.', TITLE), true);
  assert.equal(repeatsTitle('…so the first posts sound like YOU…', TITLE), true);
  assert.equal(repeatsTitle(TITLE, TITLE), true, 'the title itself');
});

test('a sentence that adds something is kept; so are an empty one and one too short to tell', () => {
  assert.equal(repeatsTitle('Mira posts on Thursday and needs the answers first.', TITLE), false);
  assert.equal(repeatsTitle(`${TITLE} – and then some more words`, TITLE), false, 'longer than the title: it adds');
  assert.equal(repeatsTitle(undefined, TITLE), false);
  assert.equal(repeatsTitle('', TITLE), false);
  assert.equal(repeatsTitle('on', TITLE), false, 'two letters say nothing either way');
});

test('a confirm whose instructions only say the title loses them; every other block stays as it is', () => {
  const same = { type: 'confirm', instructions: TITLE, confirmLabel: 'Done' };
  assert.deepEqual(withoutRepeat(same, TITLE), { type: 'confirm', instructions: '', confirmLabel: 'Done' });
  assert.equal(same.instructions, TITLE, 'the block itself is not changed');
  const more = { type: 'confirm', instructions: 'Hand the phone over, then tap Done.' };
  assert.equal(withoutRepeat(more, TITLE), more, 'real instructions stay (the same object)');
  const choice = { type: 'choice', instructions: TITLE };
  assert.equal(withoutRepeat(choice, TITLE), choice, 'only a confirm is cut');
});
