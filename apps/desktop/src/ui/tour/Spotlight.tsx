// B-085 T2: the spotlight tour – startSpotlight() after the first run's Start (ui/onboarding) and from Settings ›
// Feedback "Show the tour". It mounts itself into its own body-level container (preact render, no shell edit), waits
// briefly until the chat's cells are on screen, keeps the steps whose target is there (spotlight-steps.ts) and shows
// them in a native modal <dialog> over the whole window: an SVG shade with a hole and a ring around the target and a
// small bubble (title, one or two sentences, "n / N", Back / Next / Skip; Enter or → next, ← back, Esc ends). The open
// dialog is also what hides the side pane's native website pages (workspace/native-surface.ts hides them under any
// dialog[open]), so the shade lies over them too. The hole follows its target every frame while a step is shown.
// Nothing is stored, nothing navigates, no preference changes; a target that is gone by its turn is passed over in
// the direction the person was going.
// Owns: the overlay and its container. Never: the steps' texts (spotlight-steps.ts) or any live state.

import { render } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { SPOTLIGHT_STEPS, holeOf, isTarget, keyStep, passOver, placeBubble, sameBox } from './spotlight-steps.ts';
import type { Box, Placement, SpotlightStep } from './spotlight-steps.ts';

const WAIT_MS = 4000;
/** The bubble's width beside a target (tour.css .spotlight-bubble). */
const BUBBLE_W = 320;
/** The chat is on screen when its composer is. */
const CHAT_READY = '.composer .send-button';
let host: HTMLElement | null = null;

function findTarget(step: SpotlightStep): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(step.selector)) {
    if (host?.contains(element)) continue;
    const rect = element.getBoundingClientRect();
    if (isTarget(step, { width: rect.width, height: rect.height, placeholder: element.classList.contains('placeholder'), text: element.textContent ?? '' })) return element;
  }
  return null;
}

const present = () => SPOTLIGHT_STEPS.filter((step) => findTarget(step) !== null);

/** The steps on screen once the chat's composer is there (the chat opens right after Start or the replay) – after a few
 * seconds without one, whatever is there. */
function whenReady(): Promise<SpotlightStep[]> {
  return new Promise((resolve) => {
    const ready = () => document.querySelector(CHAT_READY) !== null;
    const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => resolve(present())));
    if (ready()) { settle(); return; }
    const observer = new MutationObserver(() => { if (!ready()) return; observer.disconnect(); clearTimeout(timer); settle(); });
    const timer = setTimeout(() => { observer.disconnect(); resolve(present()); }, WAIT_MS);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/** Starts the tour over what is on screen now; a second call while it runs does nothing. */
export function startSpotlight(): void {
  if (host || typeof document === 'undefined') return;
  const container = document.createElement('div');
  container.className = 'spotlight-host';
  document.body.append(container);
  host = container;
  const end = () => {
    render(null, container);
    container.remove();
    if (host === container) host = null;
  };
  void whenReady().then((steps) => {
    if (host !== container) return;
    if (steps.length) render(<Spotlight steps={steps} onEnd={end} />, container);
    else end();
  });
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

function Spotlight(props: { steps: readonly SpotlightStep[]; onEnd: () => void }) {
  const { steps, onEnd } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<Box | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const direction = useRef<1 | -1>(1);
  const step = steps[index]!;
  const last = index === steps.length - 1;
  const next = () => { direction.current = 1; if (last) onEnd(); else setIndex(index + 1); };
  const back = () => { if (index === 0) return; direction.current = -1; setIndex(index - 1); };

  // The window's size: a new one places the bubble again even where the hole stays put.
  const [view, setView] = useState(viewport);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    const resize = () => setView(viewport());
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); if (element?.open) element.close(); };
  }, []);

  // The hole follows the target every frame (whatever moves or resizes it – a notice, the side pane, the window);
  // a target gone by its turn is passed over in the direction the person was going.
  useLayoutEffect(() => {
    const target = findTarget(step);
    if (!target) {
      const to = passOver(index, steps.length, direction.current);
      if (to === null) onEnd();
      else { direction.current = to > index ? 1 : -1; setIndex(to); }
      return;
    }
    let frame = 0;
    const measure = () => {
      const rect = target.getBoundingClientRect();
      const box = holeOf({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }, viewport());
      setHole((old) => (sameBox(old, box) ? old : box));
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [index]);

  // The bubble is measured at its one bubble width (tour.css; for a moment without the sheet form, so a sheet never
  // lends its height), then placed – first drawn hidden, so it never jumps into view.
  useLayoutEffect(() => {
    const element = bubble.current;
    if (!hole || !element) return;
    const sheet = element.classList.contains('sheet');
    element.classList.remove('sheet');
    const height = element.offsetHeight;
    if (sheet) element.classList.add('sheet');
    setPlace(placeBubble(hole, { width: BUBBLE_W, height }, view));
  }, [hole, index, view]);
  useEffect(() => { bubble.current?.querySelector<HTMLButtonElement>('.spotlight-next')?.focus({ preventScroll: true }); }, [index]);

  const onKeyDown = (event: KeyboardEvent) => {
    const action = keyStep(event.key, event.target instanceof HTMLButtonElement);
    if (!action) return;
    event.preventDefault();
    if (action === 'next') next(); else back();
  };
  const style = place && place.kind !== 'sheet' ? { left: `${place.left}px`, top: `${place.top}px` } : undefined;
  return (
    <dialog ref={dialog} class="spotlight" aria-label="Tour" onKeyDown={onKeyDown}
      onCancel={(event) => { event.preventDefault(); onEnd(); }}>
      <svg class="spotlight-shade" aria-hidden="true">
        <defs>
          <mask id="spotlight-hole">
            <rect width="100%" height="100%" fill="white" />
            {hole && <rect x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx="10" fill="black" />}
          </mask>
        </defs>
        <rect class="spotlight-dim" width="100%" height="100%" mask="url(#spotlight-hole)" />
        {hole && <rect class="spotlight-ring" x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx="10" />}
      </svg>
      <div ref={bubble} class={`spotlight-bubble${place?.kind === 'sheet' ? (place.top ? ' sheet top' : ' sheet') : ''}${place ? '' : ' measuring'}`} style={style}
        role="group" aria-roledescription="tour step" aria-label={`${step.title}, ${index + 1} of ${steps.length}`}>
        <h2 class="spotlight-title">{step.title}</h2>
        <p class="spotlight-text">{step.body}</p>
        <div class="spotlight-foot">
          <span class="spotlight-count">{index + 1} / {steps.length}</span>
          <button type="button" class="button ghost small spotlight-skip" onClick={onEnd}>Skip</button>
          <button type="button" class="button secondary small" disabled={index === 0} onClick={back}>Back</button>
          <button type="button" class="button primary small spotlight-next" onClick={next}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </dialog>
  );
}
