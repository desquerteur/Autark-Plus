// The feedback form's attachment rows, each a fixed box (styles/feedback.css .feedback-shot: thumbnail | checkbox over
// one muted line), so a recording arriving moves nothing. The screenshot is no row any more (feedback 16.11.2026: the
// snapshot overlay shows it full size, its box and "Add photo" are FeedbackOverlay.tsx's):
// - Recording (feedback 16.11.2026, F15): the dictation's voice (recording.ts), checked by default; its thumbnail plays
//   the takes. Shown wherever the form can dictate.
// - Crash report attached: an Android crash report the app handed over (draft.ts attachCrashReport), checked by default.
// Owns: these rows. Never: uploads, records or sends anything.

import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../lib/icons.tsx';
import { CRASH_LABEL, RECORDING_LABEL, recordingText } from './delivery.ts';
import { updateDraft } from './draft.ts';
import type { FeedbackDraft } from './draft.ts';
import { recordingLength } from './recording.ts';

const checked = (event: Event) => (event.currentTarget as HTMLInputElement).checked;

interface Player { audio: HTMLAudioElement; urls: string[] }

export function RecordingRow(props: { draft: FeedbackDraft; disabled: boolean }) {
  const { draft } = props;
  const takes = draft.audio;
  const [playing, setPlaying] = useState(false);
  const player = useRef<Player | null>(null);
  const stop = () => {
    const current = player.current;
    player.current = null;
    if (current) {
      current.audio.onended = null;
      current.audio.pause();
      for (const url of current.urls) URL.revokeObjectURL(url);
    }
    setPlaying(false);
  };
  useEffect(() => stop, []);
  useEffect(() => { if (player.current) stop(); }, [takes]); // a new take: the next play starts from the first
  const play = () => {
    if (player.current) { stop(); return; }
    const urls = takes.map((take) => URL.createObjectURL(take.blob));
    const audio = new Audio();
    let index = 0;
    const next = () => {
      if (player.current?.audio !== audio) return;
      if (index >= urls.length) { stop(); return; }
      audio.src = urls[index++]!;
      void audio.play().catch(stop);
    };
    audio.onended = next;
    player.current = { audio, urls };
    setPlaying(true);
    next();
  };
  const ms = takes.reduce((sum, take) => sum + take.ms, 0);
  return (
    <div class={`feedback-shot feedback-recording${draft.withAudio && takes.length ? '' : ' off'}`}>
      <button type="button" class={`feedback-thumb${takes.length ? '' : ' empty'}`} disabled={!takes.length || props.disabled} onClick={play}
        aria-label={playing ? 'Stop playing' : 'Play the recording'} title={playing ? 'Stop' : 'Play'}>
        <Icon name={playing ? 'stop' : takes.length ? 'play' : 'waveform'} size={18} />
      </button>
      <div class="feedback-shot-text">
        <label class="feedback-check">
          <input type="checkbox" checked={draft.withAudio} disabled={props.disabled} onChange={(event) => updateDraft({ withAudio: checked(event) })} />
          {RECORDING_LABEL}
        </label>
        <p class={`feedback-shot-hint${takes.length ? '' : ' empty'}`} title={recordingText(takes.length, recordingLength(ms), draft.withAudio)}>{recordingText(takes.length, recordingLength(ms), draft.withAudio)}</p>
      </div>
    </div>
  );
}

export function CrashRow(props: { draft: FeedbackDraft; disabled: boolean }) {
  const { draft } = props;
  if (!draft.diagnostics) return null;
  return (
    <label class="feedback-check feedback-crash" title={draft.diagnostics.slice(0, 600)}>
      <input type="checkbox" checked={draft.withDiagnostics} disabled={props.disabled} onChange={(event) => updateDraft({ withDiagnostics: checked(event) })} />
      {CRASH_LABEL}
    </label>
  );
}
