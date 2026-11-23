// D13: the composers' mic button (chat composer, task composer) in its one 36 px slot: Dictate →
// starting (a spinner from the tap until the microphone is open) → Stop → transcribing (spinner with a small ×: a click stops
// waiting for the text – feedback 08604667, 18.11.2026; voice.ts cancelTranscribing).
// It never takes the focus from the field (mousedown is prevented), so the take goes to the
// field's caret or selection, read at the click; a field that was not focused gets it appended.
// Its title says why this page gives no text right now (lib/dictation.ts dictationNote); while this PC's
// speech model still downloads ("Speech model downloading NN %") it stays disabled. useDictationField puts
// the caret after the inserted words and gives the waveform its state.
// AF-017 (#18): with `onHoldSend` (the chat composer) a take shows ✓ ("Done": the words go into the field; then
// composer/dictation-send.ts decides what follows), and a press held HOLD_MS is push-to-talk: the take starts at once
// and the release sends it (feedback/press.ts PressTracker – a short press stays the tap above; Esc or a lost pointer
// discards the held take).
// Owns: the button and the caret hand-over. Never: dictation itself (voice.ts).

import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';
import { dictationNote } from '../../lib/dictation.ts';
import { Icon, IconButton, Spinner } from '../../lib/ui.tsx';
import type { DictationTarget } from './dictation-insert.ts';
import type { WaveState } from './DictationWave.tsx';
import { PressTracker } from '../../feedback/press.ts';
import { cancelDictation, cancelTranscribing, dictating, dictationCaret, dictationStarting, startDictation, transcribing } from './voice.ts';

/** The field's caret/selection right now (`focused`: the take goes there, else it is appended). */
export function targetOf(field: HTMLTextAreaElement | null): DictationTarget | undefined {
  if (!field) return undefined;
  return { start: field.selectionStart, end: field.selectionEnd, focused: typeof document !== 'undefined' && document.activeElement === field };
}

/** The mic waits for this PC's speech model (its download or unpacking) – nothing could hear a take yet. */
export function waitsForSpeechModel(note: string | undefined): boolean {
  return note?.startsWith('Speech model') === true;
}

/** AF-017: a mic press – a tap toggles the take, a hold talks until release (`send`: the released take goes out). */
export function talkPress(keyOf: () => string, field: RefObject<HTMLTextAreaElement>, handlers: { stop: () => void; send: () => void }): PressTracker {
  let started: Promise<void> = Promise.resolve();
  let key = keyOf();
  return new PressTracker({
    press: () => { key = keyOf(); }, // the chat at the press (a composer reused for another chat hands over its key)
    tap: () => { if (dictating.peek() === key) handlers.stop(); else void startDictation(key, targetOf(field.current)); },
    holdStart: () => { started = startDictation(key, targetOf(field.current)); },
    holdEnd: () => { void started.then(() => { if (dictating.peek() === key) handlers.send(); }); },
    holdCancel: () => { void started.then(() => cancelDictation()); },
  }, { canHold: () => dictating.peek() !== keyOf() && !dictationStarting.peek() });
}

/** A press on the mic: its release is heard on the window (the cell swaps to its starting spinner during a hold). */
function holdPress(tracker: PressTracker): void {
  const up = () => { off(); tracker.up(); };
  const cancel = () => { off(); tracker.cancel(); };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
  const off = () => { removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel); removeEventListener('keydown', key, true); };
  addEventListener('pointerup', up);
  addEventListener('pointercancel', cancel);
  addEventListener('keydown', key, true);
  tracker.down();
}

export function MicButton(props: { draftKey: string; field: RefObject<HTMLTextAreaElement>; onStop: () => void; onHoldSend?: () => void; tracker?: PressTracker }) {
  const key = props.draftKey;
  const tracker = props.onHoldSend ? props.tracker ?? null : null;
  if (transcribing.value.has(key)) {
    return (
      <button type="button" class="icon-button dictation-transcribing" aria-label="Cancel transcription" title="Transcribing – click to cancel"
        onMouseDown={(event) => event.preventDefault()} onClick={() => cancelTranscribing(key)}>
        <Spinner size={20} label="Transcribing dictation" /><Icon name="x" size={10} />
      </button>
    );
  }
  if (dictationStarting.value === key) {
    return <button type="button" class="icon-button dictation-starting" aria-label="Starting dictation" title="Starting dictation" disabled><Spinner size={16} label="Starting dictation" /></button>;
  }
  const active = dictating.value === key;
  const note = active ? undefined : dictationNote();
  return (
    <IconButton icon={active ? (tracker ? 'check' : 'stop') : 'microphone'} label={active ? (tracker ? 'Done dictating' : 'Stop dictation') : 'Dictate'} pressed={active}
      title={note ?? (active ? (tracker ? 'Done – the words go into the field (➤ sends them)' : 'Stop dictation') : tracker ? 'Dictate – tap, or hold to talk and send' : 'Dictate')} disabled={waitsForSpeechModel(note)}
      onMouseDown={(event) => event.preventDefault()} // the field keeps its focus and caret
      onPointerDown={tracker ? (event) => { if (event.button === 0) holdPress(tracker); } : undefined}
      onContextMenu={tracker ? (event) => event.preventDefault() : undefined} // a long press opens no menu on a phone
      onClick={(event) => {
        if (tracker) { if (event.detail === 0) tracker.key(); return; } // a pointer press was the tracker's; Enter/Space is a tap
        void (active ? props.onStop() : startDictation(key, targetOf(props.field.current)));
      }} />
  );
}

/** The waveform's state for this draft. */
export function waveState(key: string): WaveState {
  if (dictating.value === key) return 'live';
  return dictationStarting.value === key ? 'starting' : 'idle';
}

/** After a take went into this draft: the caret after its words (when the field still has the focus). */
export function useDictationField(key: string, field: RefObject<HTMLTextAreaElement>, onCaret?: (caret: number) => void): void {
  const placed = dictationCaret.value;
  useEffect(() => {
    if (!placed || placed.conversationId !== key) return;
    const frame = requestAnimationFrame(() => {
      const area = field.current;
      if (!area || document.activeElement !== area) return;
      const caret = Math.min(placed.caret, area.value.length);
      area.setSelectionRange(caret, caret);
      onCaret?.(caret);
    });
    return () => cancelAnimationFrame(frame);
  }, [placed?.seq]);
}
