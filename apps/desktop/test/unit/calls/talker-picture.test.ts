// Owner 19.11.2026 – a picture shown on the call comes with the person's line (ui/chat/call/call-view.ts); the voice reads no
// images, so its input says that a picture came and that the agent's work sees it (runtime/calls/talker-prompt.ts voiceLine).
// Owns: these assertions only. Never: a model or a runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { Message } from '../../../src/shared/model/chat.ts';
import { voiceLine } from '../../../src/runtime/calls/talker-prompt.ts';

const s = { settings: { get: () => ({ profile: { name: 'Stan' } }) }, secrets: { redact: (text: string) => text } } as unknown as RuntimeServices;
const line = (body: string, attachments: Message['attachments'] = []) => ({ body, attachments }) as unknown as Message;

test('voice line: a picture with the line is named, the words stay as said', () => {
  assert.equal(voiceLine(s, [line('Was ist das?')]), 'Stan said: "Was ist das?"');
  assert.equal(
    voiceLine(s, [line('Was ist das?', [{ fileId: 'f', name: 'Cut-out.jpg', mime: 'image/jpeg', size: 1 }, { fileId: 'a', name: 'Utterance.wav', mime: 'audio/wav', size: 1 }])]),
    'Stan said: "Was ist das?" – and shows a picture with it (Cut-out.jpg); I do not see it, my work does',
  );
});
