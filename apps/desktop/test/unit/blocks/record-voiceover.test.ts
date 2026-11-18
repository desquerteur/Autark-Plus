// The record block as a voice-over (task_2xr88cmc, 17.11.2026): `video` + `cues` are read, a wrong line comes back to the
// agent as the block's error, only a voice is recorded, and the video's file id counts as a file the message shows.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specFor } from '../../../src/shared/blocks/catalog.ts';
import { validateBlock } from '../../../src/shared/blocks/validate.ts';
import { blockFileIds, hasOutputRefs } from '../../../src/runtime/media/outputs.ts';

const VIDEO = 'ab'.repeat(32);

test('a voice-over block: the video by file id or path, the lines sorted, the mode only audio', () => {
  const byId = validateBlock({ type: 'record', mode: 'video', video: VIDEO, cues: [{ text: 'Second', start: '0:04', end: 6 }, { text: 'First', start: 1, end: 3 }] });
  assert.ok(byId.ok);
  assert.equal(byId.block.mode, 'audio', 'a voice-over records the voice only, whatever the agent wrote');
  assert.equal(byId.block.video, VIDEO);
  assert.deepEqual(byId.block.cues, [{ text: 'First', start: 1, end: 3 }, { text: 'Second', start: 4, end: 6 }]);

  const byPath = validateBlock({ type: 'record', video: 'exports/drone-v3.mp4', cues: [{ text: 'Hi', start: 0, end: 2 }], instructions: 'Speak calmly' });
  assert.ok(byPath.ok);
  assert.equal(byPath.block.video, 'exports/drone-v3.mp4');

  const stored = validateBlock({ type: 'record', mode: 'audio', fileId: VIDEO.toUpperCase(), cues: [{ text: 'Hi', start: 0, end: 2 }] });
  assert.ok(stored.ok);
  assert.equal(stored.block.fileId, VIDEO, 'the host stores a path and writes its file id');
  assert.equal(stored.block.video, VIDEO, 'a block given only by file id speaks to that video');
});

test('a wrong line is the error the agent reads, naming the line', () => {
  const overlap = validateBlock({ type: 'record', video: VIDEO, cues: [{ text: 'a', start: 0, end: 4 }, { text: 'b', start: 2, end: 6 }] });
  assert.equal(overlap.ok, false);
  assert.match(overlap.ok ? '' : overlap.error, /cue 2 starts at 2 s while cue 1 runs until 4 s in record/);
  const bare = validateBlock({ type: 'record', video: VIDEO, cues: [{ text: 'a', start: 3, end: 3 }] });
  assert.match(bare.ok ? '' : bare.error, /cue 1 must end after it starts/);
  const noVideo = validateBlock({ type: 'record', mode: 'audio', cues: [{ text: 'a', start: 0, end: 3 }] });
  assert.match(noVideo.ok ? '' : noVideo.error, /"video" missing for the "cues"/);
});

test('without video the recorder is what it was: modes, teleprompter, no cues', () => {
  const plain = validateBlock({ type: 'record', mode: 'video', script: 'Hi, I am …', bullets: ['Who I am'] });
  assert.ok(plain.ok);
  assert.equal(plain.block.mode, 'video');
  assert.equal(plain.block.cues, undefined);
  const teleprompter = validateBlock({ type: 'teleprompter', script: 'Line one' });
  assert.ok(teleprompter.ok);
  assert.equal(teleprompter.block.mode, 'video');
  const videoOnly = validateBlock({ type: 'record', video: VIDEO });
  assert.ok(videoOnly.ok, 'the video alone is fine: the page shows it silent with the time');
  assert.equal(videoOnly.block.mode, 'audio');
});

test('the catalog tells the agent the two new props', () => {
  const spec = specFor('record');
  assert.match(spec?.signature ?? '', /video\?:path\|fileId,cues\?:\[\{text,start,end\}\]/);
  assert.ok(spec?.props.video && spec?.props.cues);
});

test('the video of a voice-over is a file the message shows (reclaim, references, access)', () => {
  const body = ['A voice-over:', '```ui', JSON.stringify({ type: 'record', video: 'drone.mp4', fileId: VIDEO, cues: [{ text: 'Hi', start: 0, end: 2 }] }), '```'].join('\n');
  assert.deepEqual(blockFileIds(body), [VIDEO]);
  assert.equal(hasOutputRefs(body), true);
  const pathOnly = ['```ui', JSON.stringify({ type: 'record', video: 'exports/drone-v3.mp4' }), '```'].join('\n');
  assert.equal(hasOutputRefs(pathOnly), true, 'a workspace path is imported like a media block\'s');
  const plain = ['```ui', JSON.stringify({ type: 'record', mode: 'audio' }), '```'].join('\n');
  assert.equal(hasOutputRefs(plain), false);
  assert.deepEqual(blockFileIds(plain), []);
});
