// A dictation piece as Ogg Opus (src/ui/lib/ogg-opus.ts): packet lengths from the TOC byte, the identification header,
// Ogg pages read back with an independent CRC (BOS/EOS, one serial, sequence numbers, lacing, granule positions with
// the padding trimmed), and the encoder call against a fake WebCodecs AudioEncoder: a second per AudioData, the
// config, and undefined (a WAV then) without an encoder, without Opus or after an encoder error.
// Owns: these assertions only. Never: a real encoder (measured in headless Chromium: see the package report).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPUS_BITRATE, oggFile, oggOpus, opusHead, opusSamples } from '../../../src/ui/lib/ogg-opus.ts';

/** Ogg's CRC bit by bit (polynomial 0x04c11db7, no reflection, start 0): independent of the table in the code. */
function crcBits(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000_0000 ? (crc << 1) ^ 0x04c1_1db7 : crc << 1;
    crc >>>= 0;
  }
  return crc >>> 0;
}

interface Page { flags: number; granule: number; serial: number; sequence: number; packets: Uint8Array[] }

/** Reads every page back, checking the magic, the version and the CRC; packets are joined across lacing values. */
function pages(file: Uint8Array): Page[] {
  const out: Page[] = [];
  for (let at = 0; at < file.length;) {
    assert.equal(String.fromCharCode(...file.subarray(at, at + 4)), 'OggS');
    assert.equal(file[at + 4], 0, 'version 0');
    const view = new DataView(file.buffer, file.byteOffset + at);
    const count = file[at + 26];
    const lacing = [...file.subarray(at + 27, at + 27 + count)];
    const size = 27 + count + lacing.reduce((sum, value) => sum + value, 0);
    const copy = file.slice(at, at + size);
    copy.fill(0, 22, 26);
    assert.equal(view.getUint32(22, true), crcBits(copy), `page ${out.length}: CRC`);
    const packets: Uint8Array[] = [];
    let offset = at + 27 + count;
    let length = 0;
    for (const value of lacing) {
      length += value;
      if (value < 255) { packets.push(file.slice(offset, offset + length)); offset += length; length = 0; }
    }
    assert.equal(length, 0, 'every packet ends on its page');
    out.push({ flags: file[at + 5], granule: view.getUint32(6, true) + view.getUint32(10, true) * 2 ** 32, serial: view.getUint32(14, true), sequence: view.getUint32(18, true), packets });
    at += size;
  }
  return out;
}

const toc = (config: number, code = 0) => (config << 3) | code;

test('a packet\'s length comes from its TOC byte: SILK, hybrid and CELT frame sizes, one, two or counted frames', () => {
  assert.equal(opusSamples(new Uint8Array([toc(9)])), 960, 'SILK wideband 20 ms');
  assert.equal(opusSamples(new Uint8Array([toc(3)])), 2880, 'SILK 60 ms');
  assert.equal(opusSamples(new Uint8Array([toc(12)])), 480, 'hybrid 10 ms');
  assert.equal(opusSamples(new Uint8Array([toc(16)])), 120, 'CELT 2.5 ms');
  assert.equal(opusSamples(new Uint8Array([toc(31, 1)])), 1920, 'two CELT 20 ms frames');
  assert.equal(opusSamples(new Uint8Array([toc(31, 3), 3])), 2880, 'three counted frames');
  assert.equal(opusSamples(new Uint8Array()), 0);
});

test('the identification header: OpusHead, version 1, mono, the pre-skip in 48 kHz samples, the input rate, no gain', () => {
  const head = opusHead(312, 16_000);
  const view = new DataView(head.buffer);
  assert.equal(head.length, 19);
  assert.equal(String.fromCharCode(...head.subarray(0, 8)), 'OpusHead');
  assert.deepEqual([head[8], head[9]], [1, 1]);
  assert.equal(view.getUint16(10, true), 312);
  assert.equal(view.getUint32(12, true), 16_000);
  assert.deepEqual([...head.subarray(16)], [0, 0, 0], 'gain 0, mapping family 0');
});

test('the Ogg file: header pages, then audio pages of a second each with their granule positions; the last trims the padding', () => {
  const sizes = Array.from({ length: 120 }, (_, index) => (index === 7 ? 300 : index === 8 ? 510 : 40 + (index % 9)));
  const packets = sizes.map((size, index) => new Uint8Array(size).fill(index % 251).map((value, at) => (at === 0 ? toc(9) : value)));
  const frames = 120 * 320 - 200; // with the pre-skip, the sound ends 288 samples (48 kHz) before the last packet's end
  const file = oggFile(packets, opusHead(312, 16_000), frames, 16_000);
  const read = pages(file);
  assert.equal(read.length, 2 + 3, 'OpusHead, OpusTags, three audio pages (50 + 50 + 20 packets)');
  assert.deepEqual(read.map((page) => page.sequence), [0, 1, 2, 3, 4]);
  assert.equal(new Set(read.map((page) => page.serial)).size, 1, 'one stream');
  assert.deepEqual(read.map((page) => page.flags), [0x02, 0, 0, 0, 0x04], 'BOS first, EOS last');
  assert.equal(String.fromCharCode(...read[0].packets[0].subarray(0, 8)), 'OpusHead');
  assert.equal(String.fromCharCode(...read[1].packets[0].subarray(0, 8)), 'OpusTags');
  assert.deepEqual(read.map((page) => page.granule), [0, 0, 50 * 960, 100 * 960, 312 + frames * 3]);
  assert.ok(312 + frames * 3 < 120 * 960, 'the last granule is below the packets\' end: padding trimmed');
  assert.deepEqual(read.slice(2).flatMap((page) => page.packets), packets, 'every packet back in order, the long ones across lacing values');
});

/** A fake WebCodecs pair: what the encoder was configured with and given, and one 20 ms packet per 320 input frames. */
function fakeCodecs(options: { supported?: boolean; failFlush?: boolean } = {}) {
  const seen = { config: undefined as unknown, data: [] as Array<{ format: string; frames: number; rate: number; timestamp: number; bytes: number }>, closed: 0 };
  class FakeAudioData {
    readonly init: AudioDataInit;
    constructor(init: AudioDataInit) { this.init = init; seen.data.push({ format: init.format, frames: init.numberOfFrames, rate: init.sampleRate, timestamp: init.timestamp, bytes: (init.data as Uint8Array).byteLength }); }
    close() { /* nothing held */ }
  }
  type Output = (chunk: { byteLength: number; copyTo(target: Uint8Array): void }) => void;
  class FakeAudioEncoder {
    static async isConfigSupported(config: AudioEncoderConfig) { return { supported: options.supported !== false, config }; }
    state = 'unconfigured';
    private readonly output: Output;
    private pending = 0;
    constructor(init: { output: Output; error: (error: Error) => void }) { this.output = init.output; }
    configure(config: AudioEncoderConfig) { seen.config = config; this.state = 'configured'; }
    encode(data: FakeAudioData) {
      this.pending += data.init.numberOfFrames;
      for (; this.pending >= 320; this.pending -= 320) this.output({ byteLength: 60, copyTo: (target) => { target.fill(1); target[0] = toc(9); } });
    }
    async flush() {
      if (options.failFlush) throw new Error('encoder broke');
      if (this.pending) { this.output({ byteLength: 60, copyTo: (target) => { target.fill(1); target[0] = toc(9); } }); this.pending = 0; }
    }
    close() { this.state = 'closed'; seen.closed += 1; }
  }
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.AudioEncoder = FakeAudioEncoder;
  globals.AudioData = FakeAudioData;
  return { seen, restore: () => { delete globals.AudioEncoder; delete globals.AudioData; } };
}

/** `frames` of PCM16 in 32 ms blocks, then an odd 3-byte block (its half sample is dropped). */
function take(frames: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < frames * 2; at += 1024) chunks.push(new Uint8Array(Math.min(1024, frames * 2 - at)));
  return [...chunks, new Uint8Array(3)];
}

test('oggOpus encodes the piece a second per AudioData with the page\'s own encoder and returns an Ogg Opus blob', async () => {
  const codecs = fakeCodecs();
  try {
    const blob = await oggOpus(take(40_000), 16_000);
    assert.ok(blob);
    assert.equal(blob.type, 'audio/ogg');
    assert.deepEqual(codecs.seen.config, { codec: 'opus', sampleRate: 16_000, numberOfChannels: 1, bitrate: OPUS_BITRATE });
    assert.deepEqual(codecs.seen.data.map((data) => [data.frames, data.timestamp]), [[16_000, 0], [16_000, 1_000_000], [8001, 2_000_000]], '2.5 s plus one whole sample of the odd block');
    assert.ok(codecs.seen.data.every((data) => data.format === 's16' && data.rate === 16_000 && data.bytes === data.frames * 2));
    const read = pages(new Uint8Array(await blob.arrayBuffer()));
    assert.equal(new DataView(read[0].packets[0].buffer).getUint16(10, true), 312, 'its own pre-skip in 48 kHz samples');
    assert.equal(read.at(-1)!.granule, 312 + 40_001 * 3, 'ends where the sound ends');
    assert.equal(codecs.seen.closed, 1, 'the encoder is closed');
  } finally { codecs.restore(); }
});

test('without an encoder, without Opus or after an encoder error there is no compact file (the piece stays a WAV)', async () => {
  assert.equal(await oggOpus(take(16_000), 16_000), undefined, 'no AudioEncoder here');
  const unsupported = fakeCodecs({ supported: false });
  try { assert.equal(await oggOpus(take(16_000), 16_000), undefined); } finally { unsupported.restore(); }
  const broken = fakeCodecs({ failFlush: true });
  try {
    assert.equal(await oggOpus(take(16_000), 16_000), undefined);
    assert.equal(broken.seen.closed, 1, 'closed after the error too');
  } finally { broken.restore(); }
});
