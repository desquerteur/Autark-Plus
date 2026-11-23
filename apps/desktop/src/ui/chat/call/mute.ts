// B-085: Mute of this device's call (the floating call card, CallCard.tsx). One signal; a capture path that honours it
// sends the same length of silence while it is on, so the provider's stream and turn timing go on and the other side
// hears nothing. Realtime voice sends silence of the same length (realtime-call.ts); the voice conversation drops muted
// blocks and a take in progress (composer/conversation-audio.ts). A new call starts unmuted (startRealtime/stopRealtime,
// voice.ts startVoice).
// Owns: the muted flag and the silence it turns a block into. Never: opens or closes a microphone.

import { signal } from '@preact/signals';

/** This device's call microphone is muted. */
export const callMuted = signal(false);

export function setCallMuted(on: boolean): void {
  callMuted.value = on;
}

/** What a capture sends for `samples`: the block itself, or silence of the same length while muted. */
export function heardSamples(samples: Float32Array, muted = callMuted.peek()): Float32Array {
  return muted ? new Float32Array(samples.length) : samples;
}
