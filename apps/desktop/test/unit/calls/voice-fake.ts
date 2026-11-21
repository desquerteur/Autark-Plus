// A scripted call voice for the tests of runtime/calls (KI-Runde 17.11.2026): one kept conversation per call whose `say`
// streams the scripted text in small pieces, records how it was opened, every input and every close, and can fail a line.
// The default fake engine can never answer a call voice (its prompt is not scriptable,
// measured in the maintainers' call runs), so a test of the voice scripts it here.
// Owns: that fake. Never: a real model, a real engine or a chat row.

import type { ChatLine, ChatOpener, ChatSaid, KeptChat } from '../../../src/runtime/decision/engine-runner.ts';

export interface FakeVoice {
  opener: ChatOpener;
  /** How the calls opened their conversations (one per call). */
  opens: Array<{ purpose: string; system: string }>;
  /** Every input, in order (one per spoken line, run note or end ask). */
  inputs: string[];
  /** How many conversations were opened at their call's start. */
  started: number;
  /** How many conversations were closed. */
  closed: number;
  /** The lines whose answer is still being written (resolve one to let its answer end). */
  writing: Array<() => void>;
}

/** What one input is answered with: streamed text, a thrown error, or text that is written and then never ends (`restart`:
 *  a first try's text written before it, then the line runs once more – ChatLine.onRestart). */
export type FakeSaid = string | Error | { stream: string; then: 'hang'; restart?: string };

/** `script` answers each input by its text and number. */
export function fakeVoice(script: (input: string, index: number) => FakeSaid): FakeVoice {
  const fake: FakeVoice = { opens: [], inputs: [], started: 0, closed: 0, writing: [], opener: () => ({ open: () => {}, say: async () => ({ text: '', by: '', kept: false }), close: () => {} }) };
  fake.opener = (open) => {
    fake.opens.push({ purpose: open.purpose, system: open.system });
    let lines = 0;
    const chat: KeptChat = {
      open(): void { fake.started += 1; },
      async say(line: ChatLine): Promise<ChatSaid> {
        const index = fake.inputs.length;
        fake.inputs.push(line.input);
        const answer = script(line.input, index);
        if (answer instanceof Error) throw answer;
        const text = typeof answer === 'string' ? answer : answer.stream;
        if (typeof answer !== 'string' && answer.restart !== undefined) {
          for (const piece of answer.restart.match(/[\s\S]{1,12}/g) ?? []) { line.onText?.(piece); await Promise.resolve(); }
          line.onRestart?.();
        }
        for (const piece of text.match(/[\s\S]{1,12}/g) ?? []) {
          if (line.signal?.aborted) throw new Error('the voice was cut off');
          line.onText?.(piece);
          await Promise.resolve();
        }
        if (typeof answer !== 'string') { // it writes on and on: only the call's end or a newer line stops it
          await new Promise<void>((resolve) => {
            fake.writing.push(resolve);
            line.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          throw new Error('the voice was cut off');
        }
        return { text, by: 'fake:small', kept: lines++ > 0 };
      },
      close(): void { fake.closed += 1; },
    };
    return chat;
  };
  return fake;
}
