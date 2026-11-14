// AF-021: effort as a slider with stops (instead of the row of buttons) – Auto, then the efforts the model offers
// (effort-slider.ts). Dragging, a click on the track or on a stop's label, and the keys (arrows, Home/End,
// PageUp/PageDown) move it; role="slider" with aria-valuetext names the stop. A drag shows where it is and saves once on
// release; a click or a key saves at once. The current stop's label is highlighted (colour only, B-044 §2).
// Owns: drawing and input. Never: decides the stops or stores anything (onChange does).

import { useRef, useState } from 'preact/hooks';
import type { Effort } from '../../../shared/model/providers.ts';
import { EFFORT_LABEL } from '../live-text.ts';
import { AUTO_STEP, indexAt, keyStep, stopPercent, type EffortStep } from './effort-slider.ts';

export const stepLabel = (step: EffortStep): string => (step === AUTO_STEP ? 'Auto' : EFFORT_LABEL[step as Effort]);

export function EffortSlider(props: { steps: readonly EffortStep[]; index: number; onChange: (step: EffortStep) => void; disabled?: boolean }) {
  const { steps } = props;
  const count = steps.length;
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | undefined>(undefined);
  const shown = drag ?? props.index;
  const commit = (index: number) => { if (index !== props.index) props.onChange(steps[index]); };
  const at = (x: number) => {
    const box = track.current?.getBoundingClientRect();
    return box ? indexAt(x, box.left, box.width, count) : props.index;
  };
  const percent = stopPercent(shown, count);
  const first = stopPercent(0, count);
  const last = stopPercent(count - 1, count);
  return (
    <div class="menu-section effort-slider" data-disabled={props.disabled ? '' : undefined}>
      <div class="effort-head"><span>Effort</span><span class="effort-value">{stepLabel(steps[shown])}</span></div>
      <div ref={track} class={`effort-track${drag !== undefined ? ' dragging' : ''}`} role="slider" tabIndex={props.disabled ? -1 : 0}
        aria-label="Effort" aria-valuemin={0} aria-valuemax={count - 1} aria-valuenow={shown} aria-valuetext={stepLabel(steps[shown])}
        aria-disabled={props.disabled || undefined}
        onPointerDown={(event) => {
          if (props.disabled || event.button !== 0) return;
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
          (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
          setDrag(at(event.clientX));
        }}
        onPointerMove={(event) => { if (drag !== undefined) setDrag(at(event.clientX)); }}
        onPointerUp={(event) => {
          if (drag === undefined) return;
          const index = at(event.clientX);
          setDrag(undefined);
          commit(index);
        }}
        onPointerCancel={() => setDrag(undefined)}
        onKeyDown={(event) => {
          if (props.disabled) return;
          const next = keyStep(event.key, props.index, count);
          if (next === undefined) return;
          event.preventDefault();
          event.stopPropagation(); // the menu's own arrow keys stay out of it
          commit(next);
        }}>
        <span class="effort-rail" style={{ left: `${first}%`, right: `${100 - last}%` }} />
        <span class="effort-fill" style={{ left: `${first}%`, width: `${Math.max(0, percent - first)}%` }} />
        {steps.map((step, index) => (
          <span key={step} class={`effort-stop${index <= shown ? ' passed' : ''}`} style={{ left: `${stopPercent(index, count)}%` }} />
        ))}
        <span class="effort-thumb" style={{ left: `${percent}%` }} />
      </div>
      <div class="effort-labels" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
        {steps.map((step, index) => (
          <button type="button" key={step} tabIndex={-1} class={`effort-label${index === shown ? ' on' : ''}`} disabled={props.disabled}
            onClick={() => commit(index)}>{stepLabel(step)}</button>
        ))}
      </div>
    </div>
  );
}
