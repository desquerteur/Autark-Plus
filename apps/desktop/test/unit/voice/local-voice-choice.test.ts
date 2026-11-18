// KI-Runde 17.11.2026 (package T): a local voice pulled with a choose that says no (a generation's pull) leaves the
// person's reading voice unset, and speak uses the chosen voice, else a downloaded one – so a voice-over speaks without
// becoming the voice that reads to the person (src/runtime/voice/local/service.ts).
// Owns: these assertions only. Never: the real addon or the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localSpeechModel, type LocalSpeechModel } from '../../../src/shared/model/local-speech-models.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import { LocalSpeech } from '../../../src/runtime/voice/local/service.ts';
import { LocalSpeechEngine } from '../../../src/runtime/voice/local/engine.ts';
import { fakeAddon, installFake, quietLog, tempData } from './local-fixture.ts';

const VOICE = localSpeechModel('supertonic-3-int8', 'tts')!;

test('a pull whose choose says no leaves localTts as it is; speak then uses the downloaded voice', async () => {
  const data = tempData();
  const updates: unknown[] = [];
  const settings = { profile: { language: 'en' }, voice: { vocabulary: [], localStt: '', localTts: '' } };
  const services = {
    paths: { data: data.dir }, log: quietLog,
    settings: { get: () => settings, update: (patch: { voice: Record<string, unknown> }) => { updates.push(patch); Object.assign(settings.voice, patch.voice); return settings; } },
    bus: { emit: () => undefined },
  } as unknown as RuntimeServices;
  const engine = new LocalSpeechEngine({ dataDir: () => data.dir, log: quietLog, addon: () => fakeAddon().addon, freeMemoryMb: () => 4_000 });
  const install = async (model: LocalSpeechModel) => { installFake(data.dir, model); };
  const local = new LocalSpeech({ services: () => services, engine, install, hardware: () => ({ totalRamMb: 8_192, freeRamMb: 2_000, cpuCores: 8 }) });
  try {
    await assert.rejects(local.speak({ text: 'Hello.' }), /No local voice is downloaded on this PC/, 'nothing downloaded: a clear refusal');
    await local.pull(VOICE.id, { choose: () => false });
    assert.deepEqual(updates, [], 'the reading voice stays unset');
    assert.equal(local.ttsModel(), undefined, 'nothing is chosen');
    const spoken = await local.speak({ text: 'Hello.' });
    assert.ok(spoken.sampleRate > 0, 'the downloaded voice speaks');
  } finally { data.done(); }
});
