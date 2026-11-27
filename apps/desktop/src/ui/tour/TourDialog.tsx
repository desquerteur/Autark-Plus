// B-055: the feedback tour as a dialog over the app (replay from Settings › Feedback "Watch how it
// works", openTour() in open.ts; also the palette and the spotlight tour's feedback step). AF-002: the first run does not
// show it (upstream's choice card is not part of Autark-Plus's setup assistant). A native modal dialog: Esc, the × and Continue close it (closeTour);
// a click on the backdrop too. The player starts at its poster on every opening (it mounts afresh).
// Feedback 16.11.2026 (F15): in the phone layout (`phone`, the shell's) it plays the phone's tour – the variant is the
// opening's and stays while it plays (a window made narrow meanwhile keeps the computer's).
// Owns: mounting the player while `tourOpen` is true. Never: the timeline or the scene.

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { closeTour, tourAutoplay, tourOpen, tourVariant } from './open.ts';
import type { Variant } from './scene-layout.ts';
import { TOUR_TITLE, TourPlayer } from './TourPlayer.tsx';

export function TourDialog(props: { phone?: boolean }) {
  if (!tourOpen.value) return null;
  return <TourModal variant={props.phone ? 'phone' : 'desktop'} />;
}

function TourModal(props: { variant: Variant }) {
  // the opening's variant, also when the shell mounts this afresh after a layout switch (open.ts tourVariant)
  const [variant] = useState(() => tourVariant.peek() ?? (tourVariant.value = props.variant));
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return (
    <dialog
      ref={ref} class={`dialog tour-dialog ${variant}`} aria-label={TOUR_TITLE}
      onCancel={(event) => { event.preventDefault(); closeTour(); }}
      onClick={(event) => { if (event.target === ref.current) closeTour(); }}
    >
      <TourPlayer onDone={closeTour} autoplay={tourAutoplay.peek()} variant={variant} />
    </dialog>
  );
}
