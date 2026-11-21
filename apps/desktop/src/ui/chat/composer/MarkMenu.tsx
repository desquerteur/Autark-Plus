// B-082: the menu of one unsure place in the composer. A click or tap that leaves the caret in an unsure span opens it
// (Composer.tsx), anchored above that span's first line (MarkLayer's <mark>), an overlay inside the field's box –
// nothing moves. It shows the AI's other words for the place with their likelihood, best first, and a one-line input
// with an arrow button for the person's own word (Enter applies it, Esc closes). A choice replaces exactly that place,
// drops its mark and puts the caret after it. It closes on a click elsewhere, on typing in the field and when the
// focus leaves both. Buttons keep the focus in the field (no keyboard flicker on the phone); only the input takes it.
// Owns: the menu and applying a choice to the draft. Never: the span rules (draft-marks.ts) or the highlight (MarkLayer.tsx).

import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { SpanMark } from '../../../shared/voice/marks.ts';
import { Icon } from '../../lib/ui.tsx';
import { draftFor, updateDraft } from './draft.ts';
import { replaceMark } from './draft-marks.ts';

const GAP = 6;

export function MarkMenu(props: {
  conversationId: string; field: RefObject<HTMLTextAreaElement>; layer: RefObject<HTMLDivElement>;
  mark: SpanMark; onClose: () => void; onCaret: (caret: number) => void;
}) {
  const { conversationId, field, layer, mark, onClose } = props;
  const root = useRef<HTMLDivElement>(null);
  const [own, setOwn] = useState('');
  const marks = draftFor(conversationId).peek().marks;
  const index = marks?.uncertain?.indexOf(mark) ?? -1;

  // Above the span's first line, inside the field's box sideways.
  useLayoutEffect(() => {
    const menu = root.current;
    const box = menu?.offsetParent?.getBoundingClientRect();
    const rect = layer.current?.querySelector(`[data-mark="${index}"]`)?.getClientRects()[0];
    if (!menu || !box || !rect) return;
    menu.style.left = `${Math.max(0, Math.min(rect.left - box.left, box.width - menu.offsetWidth))}px`;
    menu.style.bottom = `${box.bottom - rect.top + GAP}px`;
  }, [index]);

  useEffect(() => {
    const area = field.current;
    const inside = (node: EventTarget | null) => node instanceof Node && (root.current?.contains(node) || node === area);
    const press = (event: PointerEvent) => { if (!inside(event.target)) onClose(); };
    const blur = (event: FocusEvent) => { if (!inside(event.relatedTarget)) onClose(); };
    document.addEventListener('pointerdown', press, true);
    area?.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', press, true); area?.removeEventListener('blur', blur); };
  }, []); // onClose only clears the composer's open mark: the first one serves the menu's whole life

  if (index < 0) return null;

  const apply = (value: string, typed: boolean) => {
    const draft = draftFor(conversationId).peek();
    const done = draft.marks && value ? replaceMark(draft.text, draft.marks, draft.marks.uncertain?.indexOf(mark) ?? -1, value, typed) : null;
    onClose();
    if (!done) return;
    updateDraft(conversationId, { text: done.text, marks: done.marks });
    requestAnimationFrame(() => {
      const area = field.current;
      if (!area) return;
      area.focus({ preventScroll: true });
      area.setSelectionRange(done.caret, done.caret);
      props.onCaret(done.caret);
    });
  };

  const alts = [...mark.alts].sort((a, b) => b.pct - a.pct);
  return (
    <div ref={root} class="mark-menu" role="dialog" aria-label="Other words for this place"
      onMouseDown={(event) => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault(); }}
      onFocusOut={(event) => { if (!(event.relatedTarget instanceof Node && (root.current?.contains(event.relatedTarget) || event.relatedTarget === field.current))) onClose(); }}>
      {alts.map((alt, i) => (
        <button type="button" class="menu-item mark-alt" key={i} onClick={() => apply(alt.t, false)}>
          <span class="mark-alt-word">{alt.t}</span><span class="mark-alt-pct">{Math.round(alt.pct)}%</span>
        </button>
      ))}
      <form class="mark-own" onSubmit={(event) => { event.preventDefault(); apply(own.trim(), true); }}>
        <input class="mark-own-input" value={own} placeholder="Your word" aria-label="Your word"
          onInput={(event) => setOwn((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); field.current?.focus({ preventScroll: true }); } }} />
        <button type="submit" class="mark-own-apply" aria-label="Apply" disabled={!own.trim()}><Icon name="arrow-right" size={16} /></button>
      </form>
    </div>
  );
}
