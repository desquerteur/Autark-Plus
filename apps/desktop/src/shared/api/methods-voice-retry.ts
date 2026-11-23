// RPC contract part (B-082): hearing a sent recording again. Handler: runtime/rpc/handlers/voice-retry.ts.
// Merged into Methods by module augmentation. Owns: this method shape. Never: behaviour.

declare module '../api/methods.ts' {
  interface Methods {
    /** B-082: hears the recording of my own sent audio-only message again whose hearing failed (meta.dictation.failed); the text lands in its body. */
    'voice.retranscribe': { params: { messageId: string }; result: { ok: true } };
  }
}

export {};
