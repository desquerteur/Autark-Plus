// A dictation piece as a compact file (owner 10.11.2026: "nicht so einer komplett großen, unkompakten Datei"): the
// piece's 16 kHz mono PCM16 encoded by the page's own WebCodecs AudioEncoder as Opus at 24 kbit/s (measured 16.11.2026 in
// Chromium on a German dictation: 183 KB a minute instead of the WAV's 1.92 MB, encoded in 0.7 s, decoded back to the
// exact length) in a minimal Ogg stream (RFC 7845: an OpusHead page, an OpusTags
// page, then audio pages of about a second with their CRC and granule positions in 48 kHz samples; the last page trims
// the encoder's padding). A page without AudioEncoder or Opus in it, an encoder error or an encode that takes longer than
// ENCODE_MS gives undefined, and the piece stays a WAV (lib/dictation.ts decides when a piece goes compact).
// Owns: the encoder call and the Ogg writer. Never: uploads, keeps audio, or decides which pieces are compact.

/** Opus bit rate: wideband speech at this rate is heard as well as the PCM it came from (16.11.2026: this PC's small
 *  model wrote 9 of 94 words differently from the WAV at 24 kbit/s and 10 at 48 kbit/s: its own variance, not the codec). */
export const OPUS_BITRATE = 24_000;
/** An encode that takes longer than this is given up on: the piece goes up as a WAV (nothing waits forever). */
export const ENCODE_MS = 10_000;
/** libopus' lookahead (6.5 ms) in 48 kHz samples: the pre-skip. Chromium's own header names it in input samples (104
 *  at 16 kHz, measured 16.11.2026), which would leave 4.3 ms of delay, so the file carries its own header. */
const PRE_SKIP = 312;
/** Audio packets per Ogg page (20 ms each: one page a second). */
const PAGE_PACKETS = 50;
const SERIAL = 0x4155_544b; // one stream per file; any fixed number serves
const BOS = 0x02;
const EOS = 0x04;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index << 24;
    for (let bit = 0; bit < 8; bit++) value = value & 0x8000_0000 ? (value << 1) ^ 0x04c1_1db7 : value << 1;
    table[index] = value >>> 0;
  }
  return table;
})();

/** Ogg's CRC32 (polynomial 0x04c11db7, no reflection, start 0) of a page whose CRC field is zero. */
export function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  return crc;
}

/** A packet's length in 48 kHz samples, read from its TOC byte (RFC 6716 3.1). */
export function opusSamples(packet: Uint8Array): number {
  if (!packet.length) return 0;
  const config = packet[0] >> 3;
  const tenths = config < 12 ? [100, 200, 400, 600][config % 4] : config < 16 ? [100, 200][config % 2] : [25, 50, 100, 200][config % 4];
  const code = packet[0] & 3;
  const frames = code === 0 ? 1 : code < 3 ? 2 : (packet[1] ?? 0) & 0x3f;
  return (frames * tenths * 48) / 10;
}

/** The identification header (19 bytes): mono, the pre-skip, the input rate, no gain, mapping family 0. */
export function opusHead(preSkip: number, inputRate: number): Uint8Array {
  const out = new Uint8Array(19);
  const view = new DataView(out.buffer);
  out.set([...'OpusHead'].map((char) => char.charCodeAt(0)));
  out[8] = 1;
  out[9] = 1;
  view.setUint16(10, preSkip, true);
  view.setUint32(12, inputRate, true);
  return out;
}

function opusTags(): Uint8Array {
  const vendor = [...'Autark'].map((char) => char.charCodeAt(0));
  const out = new Uint8Array(8 + 4 + vendor.length + 4);
  out.set([...'OpusTags'].map((char) => char.charCodeAt(0)));
  new DataView(out.buffer).setUint32(8, vendor.length, true);
  out.set(vendor, 12);
  return out; // no user comments
}

function oggPage(packets: readonly Uint8Array[], granule: number, flags: number, sequence: number): Uint8Array {
  const lacing: number[] = [];
  for (const packet of packets) {
    for (let left = packet.length; left >= 255; left -= 255) lacing.push(255);
    lacing.push(packet.length % 255);
  }
  const out = new Uint8Array(27 + lacing.length + packets.reduce((total, packet) => total + packet.length, 0));
  const view = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53]); // OggS, version 0
  out[5] = flags;
  view.setUint32(6, granule % 2 ** 32, true);
  view.setUint32(10, Math.floor(granule / 2 ** 32), true);
  view.setUint32(14, SERIAL, true);
  view.setUint32(18, sequence, true);
  out[26] = lacing.length;
  out.set(lacing, 27);
  let offset = 27 + lacing.length;
  for (const packet of packets) { out.set(packet, offset); offset += packet.length; }
  view.setUint32(22, oggCrc(out), true);
  return out;
}

/** The Ogg Opus file of encoded packets; `frames` input samples at `inputRate` mark where the sound ends. */
export function oggFile(packets: readonly Uint8Array[], head: Uint8Array, frames: number, inputRate: number): Uint8Array {
  const pages = [oggPage([head], 0, BOS, 0), oggPage([opusTags()], 0, 0, 1)];
  const end = (head[10] | (head[11] << 8)) + Math.round((frames * 48_000) / inputRate);
  let total = 0;
  let previous = 0;
  for (let at = 0; at < packets.length;) {
    const page: Uint8Array[] = [];
    let segments = 0;
    while (at < packets.length && page.length < PAGE_PACKETS && (!page.length || segments + Math.floor(packets[at].length / 255) + 1 <= 255)) {
      segments += Math.floor(packets[at].length / 255) + 1;
      total += opusSamples(packets[at]);
      page.push(packets[at++]);
    }
    const last = at === packets.length;
    const granule = last ? Math.max(previous, Math.min(total, end)) : total; // the last page trims the padding
    pages.push(oggPage(page, granule, last ? EOS : 0, pages.length));
    previous = granule;
  }
  const out = new Uint8Array(pages.reduce((size, page) => size + page.length, 0));
  let offset = 0;
  for (const page of pages) { out.set(page, offset); offset += page.length; }
  return out;
}

/** A piece's PCM16 (16 kHz mono) as an Ogg Opus blob, or undefined when this page cannot encode it (see the header). */
export async function oggOpus(pcm: readonly Uint8Array[], rate: number): Promise<Blob | undefined> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return undefined;
  const config: AudioEncoderConfig = { codec: 'opus', sampleRate: rate, numberOfChannels: 1, bitrate: OPUS_BITRATE };
  let encoder: AudioEncoder | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!(await AudioEncoder.isConfigSupported(config)).supported) return undefined;
    const packets: Uint8Array[] = [];
    encoder = new AudioEncoder({
      output: (chunk) => {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        packets.push(bytes);
      },
      error: () => undefined, // flush() rejects with it
    });
    encoder.configure(config);
    const samples = new Uint8Array(pcm.reduce((total, chunk) => total + chunk.byteLength, 0) & ~1); // whole PCM16 samples
    let offset = 0;
    for (const chunk of pcm) { const part = chunk.subarray(0, samples.length - offset); samples.set(part, offset); offset += part.length; }
    const frames = samples.length / 2;
    for (let from = 0; from < frames; from += rate) { // a second per AudioData
      const count = Math.min(rate, frames - from);
      const data = new AudioData({ format: 's16', sampleRate: rate, numberOfChannels: 1, numberOfFrames: count, timestamp: Math.round((from * 1e6) / rate), data: samples.subarray(from * 2, (from + count) * 2) });
      encoder.encode(data);
      data.close();
    }
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('encode timed out')), ENCODE_MS); });
    await Promise.race([encoder.flush(), deadline]);
    if (!packets.length) return undefined;
    return new Blob([oggFile(packets, opusHead(PRE_SKIP, rate), frames, rate).buffer as ArrayBuffer], { type: 'audio/ogg' });
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch { /* closed by its error */ }
  }
}
