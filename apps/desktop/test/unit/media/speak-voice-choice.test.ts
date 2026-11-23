// KI-Runde 17.11.2026 (package T): media.speak's pull of the local voice leaves the person's reading voice as it is (the
// pull is asked with a choose that says no), the voice-over still speaks; a failure that is no WorkforceError is logged
// with its tool and cause and reaches the agent after the tool's sentence (ten failures had read only "Creating the
// speech failed.").
// Owns: these assertions only. Never: the real voice engine or the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, call, fakeVoice, textOf, toolSetup } from './generate-fixture.ts';

function speakSetup(stt: Record<string, unknown>) {
  const chosen: { localTts?: string } = {};
  const warned: Array<[string, Record<string, unknown>]> = [];
  const t = toolSetup([account('acc_local', 'local', 'http://127.0.0.1:9/v1')], { stt });
  Object.assign(t.h.services, {
    catalog: { list: () => [], get: () => undefined },
    settings: { get: () => ({ routing: { functions: {} }, voice: chosen, profile: { language: 'en' } }) },
    log: { debug() {}, info() {}, warn: (message: string, data: Record<string, unknown>) => { warned.push([message, data]); }, error() {} },
  });
  return { t, chosen, warned };
}

test('media.speak pulls the local voice without choosing it as the person\'s reading voice, and speaks', async () => {
  const voice = fakeVoice({ installed: false });
  const asked: Array<boolean | undefined> = [];
  const stt = { ...voice.stt, pullLocal: async (id: string, options?: { choose?: () => boolean }) => { asked.push(options?.choose?.()); return voice.stt.pullLocal(id); } };
  const { t, chosen } = speakSetup(stt);
  try {
    const { out } = await call('media.speak', { text: 'Hello there, this is a voice-over.' }, t.ctx());
    assert.equal(out.isError, undefined, textOf(out));
    assert.deepEqual(asked, [false], 'the pull is told not to choose');
    assert.equal(chosen.localTts, undefined, 'the reading voice stays as the person set it');
  } finally { t.temp.cleanup(); }
});

test('media.speak: a failure is logged with its cause, and the agent reads the cause', async () => {
  const voice = fakeVoice({ installed: true });
  const stt = { ...voice.stt, speak: async () => { throw new Error('onnxruntime could not load the model file'); } };
  const { t, warned } = speakSetup(stt);
  try {
    const { out } = await call('media.speak', { text: 'Hello there.' }, t.ctx());
    assert.equal(out.isError, true);
    assert.match(textOf(out), /onnxruntime could not load the model file/);
    assert.ok(warned.some(([message, data]) => message === 'generation failed' && data.tool === 'media.speak' && /onnxruntime/.test(String(data.error))), JSON.stringify(warned));
  } finally { t.temp.cleanup(); }
});
