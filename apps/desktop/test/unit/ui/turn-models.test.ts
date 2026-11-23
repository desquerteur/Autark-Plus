// B-082 track C: the turn models' adapters (src/ui/lib/turn-models.ts) – Silero's state and both exports, Smart Turn's
// Whisper features of the last 8 s – with fake ort tensors and sessions.
// Owns: these assertions only. Never: onnxruntime or a real model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedSession, sileroSpeech, smartTurn, whisperFeatures, type OrtSession } from '../../../src/ui/lib/turn-models.ts';

const RATE = 16_000;
const FRAME = 512;
const voice = (ms: number, amp = 0.1) => Float32Array.from({ length: Math.round((ms * RATE) / 1000) }, (_, i) => {
  let v = 0;
  for (let h = 1; h <= 12; h++) v += Math.sin((2 * Math.PI * 150 * h * i) / RATE) / h;
  return amp * v;
});

class FakeTensor {
  readonly type: string;
  readonly data: Float32Array | BigInt64Array;
  readonly dims: readonly number[];
  constructor(type: string, data: Float32Array | BigInt64Array, dims: readonly number[]) { this.type = type; this.data = data; this.dims = dims; }
}
const ort = { Tensor: FakeTensor as never };

test('the Silero adapter carries its state and fits both exports (x/h/c and input/sr/h/c)', async () => {
  const feeds: Array<Record<string, FakeTensor>> = [];
  const session = (inputs: string[], outputs: string[]): OrtSession => ({
    inputNames: inputs, outputNames: outputs,
    run: async (given) => {
      feeds.push(given as Record<string, FakeTensor>);
      return { [outputs[0]]: { data: Float32Array.of(0.75) }, [outputs[1]]: { data: new Float32Array(128).fill(feeds.length) }, [outputs[2]]: { data: new Float32Array(128).fill(-feeds.length) } };
    },
  });
  const sherpa = sileroSpeech(ort, session(['x', 'h', 'c'], ['prob', 'new_h', 'new_c']));
  assert.equal(await sherpa(new Float32Array(FRAME)), 0.75);
  await sherpa(new Float32Array(FRAME));
  assert.deepEqual([feeds[0].x.dims, feeds[0].h.dims, feeds[0].h.data[0], feeds[1].h.data[0], feeds[1].c.data[0]], [[1, FRAME], [2, 1, 64], 0, 1, -1]);
  feeds.length = 0;
  const official = sileroSpeech(ort, session(['input', 'sr', 'h', 'c'], ['output', 'hn', 'cn']));
  await official(new Float32Array(FRAME));
  assert.deepEqual([feeds[0].sr.type, Number(feeds[0].sr.data[0]), Object.keys(feeds[0]).sort()], ['int64', 16_000, ['c', 'h', 'input', 'sr']]);
});

test('the Smart Turn adapter hands Whisper features [1,80,800] of the last 8 s', async () => {
  let fed: FakeTensor | undefined;
  const turn = smartTurn(ort, { inputNames: ['input_features'], outputNames: ['logits'], run: async (feeds) => { fed = feeds.input_features as FakeTensor; return { logits: { data: Float32Array.of(0.5) } }; } });
  assert.equal(await turn(voice(1500)), 0.5);
  assert.deepEqual(fed?.dims, [1, 80, 800]);
  const features = whisperFeatures(voice(1500));
  assert.equal(features.length, 80 * 800);
  const max = features.reduce((a, b) => Math.max(a, b), -Infinity);
  const min = features.reduce((a, b) => Math.min(a, b), Infinity);
  assert.ok(max - min <= 2 + 1e-6, 'the log range is clipped to 8 decades (/4)');
  assert.equal(features[0], features[600], 'the zeros in front are all alike');
  assert.notEqual(features[0], features[799], 'the voice is at the end');
  assert.equal(whisperFeatures(voice(9000)).length, 80 * 800, 'longer lines: the last 8 s');
});

test('review fix: one session per model file for the page; a failed load is tried again', async () => {
  let made = 0;
  const create = async () => { made += 1; return { n: made }; };
  const first = await cachedSession('a.onnx', create);
  assert.equal(await cachedSession('a.onnx', create), first, 'a second conversation reuses the session');
  assert.equal(made, 1);
  await assert.rejects(cachedSession('b.onnx', async () => { throw new Error('404'); }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(await cachedSession('b.onnx', async () => ({ n: 9 })), { n: 9 }, 'not downloaded then, there now');
});
