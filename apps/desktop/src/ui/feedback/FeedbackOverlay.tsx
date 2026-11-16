// Feedback 16.11.2026 (F11, F15 – "der ganze Bildschirm ist einfach im Freeze … nur unten … die Buttons"): the snapshot
// overlay, which replaced the menu popover, its screenshot row and "Paint over". A press on the feedback cell (or the
// shortcut) froze the window (popover-state.ts snapshot); this modal <dialog> – opened after any open dialog, so it lies
// above them, and the side browser's native view hides under it (workspace/native-surface.ts) – shows that shot over the
// whole window at 1:1, so the app stands still. The person paints straight on it (AnnotationCanvas: Pen by default, Box,
// Undo – opaque marks, flattened into the report's one JPEG at Send) and writes or talks in the slim dock at the bottom
// (FeedbackPanel.tsx FeedbackForm, the paint tools and the screenshot box from here). Pressing the cell again – the
// overlay draws its slot at the cell's spot (lib/dialog.tsx DialogSlot) – or the shortcut freezes the overlay itself:
// a new snapshot with the old one and the dock in it, the words stay. The arrow or Escape closes it and keeps the draft.
// On the phone the same, full screen, with the Android app's own shot; where nothing captures the window (the iPhone web
// app, a browser) the dock lies over the live screen and "Add photo" picks a screenshot or photo to paint on.
// Owns: the overlay dialog, the frozen stage, the paint tools and the screenshot box. Never: the form's words, sending or
// taking the snapshot (popover-state.ts).

import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { DialogSlot } from '../lib/dialog.tsx';
import { Icon } from '../lib/icons.tsx';
import { errorText } from '../lib/rpc.ts';
import { AnnotationCanvas } from './AnnotationCanvas.tsx';
import { canCaptureWindow, pickedImage } from './bridge.ts';
import { PHOTO_ADD, PHOTO_HINT, SHOT_HINT, SHOT_LABEL, SHOT_MISSING } from './delivery.ts';
import { feedbackDraft, updateDraft } from './draft.ts';
import type { FeedbackDraft } from './draft.ts';
import { FeedbackForm } from './FeedbackPanel.tsx';
import type { PaintMark, PaintTool } from './paint.ts';
import { loadImage } from './paint-image.ts';
import { closeFeedback, frozen, overlayShown } from './popover-state.ts';

/** What the screenshot box has to say beside the form's own messages (a picked file that could not be used). */
const shotNote = signal<string | null>(null);

export function FeedbackOverlay(props: { onInbox: () => void }) {
  const shown = overlayShown.value;
  const ref = useRef<HTMLDialogElement>(null);
  const [modal, setModal] = useState(false); // in the top layer: the cell's slot can follow it there
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (shown && !dialog.open) dialog.showModal();
    if (!shown && dialog.open) dialog.close();
    setModal(dialog.open);
    shotNote.value = null;
  }, [shown]);
  return (
    <dialog ref={ref} class="feedback-overlay" aria-label="Feedback"
      onCancel={(event) => { event.preventDefault(); closeFeedback(); }} // Escape: the draft stays
      // closed by the system; the close event of a quick close→reopen comes late and closes nothing
      onClose={() => { if (overlayShown.peek() && !ref.current?.open) closeFeedback(); }}>
      {shown && <Frozen onInbox={props.onInbox} />}
      {shown && modal && <DialogSlot anywhere />}
    </dialog>
  );
}

function Frozen(props: { onInbox: () => void }) {
  const draft = feedbackDraft.value;
  const [tool, setTool] = useState<PaintTool>('pen');
  // A mark belongs to the shot it was drawn on (a new snapshot meanwhile: it is dropped with that shot).
  const paint = (mark: PaintMark, on: string) => {
    const current = feedbackDraft.peek();
    if (current.shot === on) updateDraft({ marks: [...current.marks, mark], painted: null });
  };
  return (
    <>
      <Stage draft={draft} tool={tool} onMark={paint} />
      <FeedbackForm onClose={closeFeedback} onInbox={props.onInbox} note={shotNote.value}
        tools={<ShotTools draft={draft} tool={tool} setTool={setTool} />} />
    </>
  );
}

/** The frozen screen: the shot at 1:1 (its own pixels, never upscaled past the window) with the marks' layer over it. */
function Stage(props: { draft: FeedbackDraft; tool: PaintTool; onMark: (mark: PaintMark, on: string) => void }) {
  const { shot, marks, withShot } = props.draft;
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImage(null);
    if (!shot) return;
    let live = true;
    loadImage(shot).then((loaded) => { if (live) setImage(loaded); }, () => undefined);
    return () => { live = false; };
  }, [shot]);
  if (!shot) return null; // nothing frozen (the iPhone web app before a photo): the dock lies over the live screen
  return (
    <div class={`feedback-stage${withShot ? '' : ' off'}`}>
      <div class="feedback-frame">
        <img src={shot} alt="" draggable={false} />
        {image && <AnnotationCanvas image={image} marks={marks} tool={props.tool} disabled={!withShot} onMark={(mark) => props.onMark(mark, shot)} />}
      </div>
    </div>
  );
}

/** The dock's first cells: where nothing captures the window "Add photo" (then "Other photo"), the Screenshot box (the
 *  frozen screen dims while it does not go), Pen, Box and Undo. */
function ShotTools(props: { draft: FeedbackDraft; tool: PaintTool; setTool: (tool: PaintTool) => void }) {
  const { draft, tool } = props;
  const capture = canCaptureWindow();
  const picker = useRef<HTMLInputElement>(null);
  const painting = draft.shot !== null && draft.withShot;
  const pick = () => picker.current?.click();
  const picked = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = ''; // the same file again is a new choice
    if (!file) return;
    try {
      feedbackDraft.value = frozen(feedbackDraft.peek(), await pickedImage(file));
      shotNote.value = null;
    } catch (error) {
      shotNote.value = errorText(error);
    }
  };
  return (
    <div class="feedback-tools">
      {!capture && ( // one fixed cell: "Add photo", then "Other photo"
        <button type="button" class="feedback-chip feedback-photo" onClick={pick} title={PHOTO_HINT}>
          <Icon name="camera" size={16} />{draft.shot ? 'Other photo' : PHOTO_ADD}
        </button>
      )}
      <label class="feedback-check feedback-chip" title={draft.shot ? SHOT_HINT : capture ? SHOT_MISSING : PHOTO_HINT}>
        <input type="checkbox" checked={draft.withShot && draft.shot !== null} disabled={draft.shot === null}
          onChange={(event) => updateDraft({ withShot: (event.currentTarget as HTMLInputElement).checked })} />
        {SHOT_LABEL}
      </label>
      <div class="segmented feedback-paint" role="group" aria-label="Paint">
        <button type="button" class={tool === 'pen' ? 'selected' : ''} aria-pressed={tool === 'pen'} disabled={!painting} onClick={() => props.setTool('pen')}>Pen</button>
        <button type="button" class={tool === 'box' ? 'selected' : ''} aria-pressed={tool === 'box'} disabled={!painting} onClick={() => props.setTool('box')}>Box</button>
      </div>
      <button type="button" class="icon-button small" aria-label="Undo" title="Undo" disabled={!painting || !draft.marks.length}
        onClick={() => updateDraft({ marks: draft.marks.slice(0, -1), painted: null })}>
        <Icon name="arrow-counter-clockwise" size={16} />
      </button>
      {!capture && <input ref={picker} type="file" accept="image/*" hidden onChange={(event) => void picked(event.currentTarget)} />}
    </div>
  );
}
