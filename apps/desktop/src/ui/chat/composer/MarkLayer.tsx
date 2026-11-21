// B-082: the unsure places of a draft, painted behind the composer's textarea. A mirror of the text with the same box,
// font, padding, line height and wrapping (composer.css `.mark-layer`; it scrolls like the field, so it gets a
// scrollbar at the same moment and wraps at the same width), its letters invisible: only the soft highlight of each
// unsure span shows through the transparent field. Dictated parts get nothing visible. Copying from the field gives
// the plain text by nature. Rendered only while the draft has unsure places; absolute, so nothing moves.
// Owns: the mirror and its scroll sync. Never: the marks themselves (draft-marks.ts) or the menu (MarkMenu.tsx).

import type { ComponentChildren, RefObject } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import type { SpanMark } from '../../../shared/voice/marks.ts';

export function MarkLayer(props: { field: RefObject<HTMLTextAreaElement>; layer: RefObject<HTMLDivElement>; text: string; marks: SpanMark[] }) {
  const { field, layer, text, marks } = props;

  // The field scrolls (wheel, caret, auto-grow at its limit): the mirror follows, line for line.
  useLayoutEffect(() => {
    const area = field.current;
    const mirror = layer.current;
    if (!area || !mirror) return;
    const follow = () => { mirror.scrollTop = area.scrollTop; };
    follow();
    area.addEventListener('scroll', follow, { passive: true });
    return () => area.removeEventListener('scroll', follow);
  });

  const parts: ComponentChildren[] = [];
  let at = 0;
  marks.forEach((mark, index) => {
    if (mark.start < at || mark.end > text.length || mark.end <= mark.start) return;
    parts.push(text.slice(at, mark.start), <mark key={index} class="mark-span" data-mark={index}>{text.slice(mark.start, mark.end)}</mark>);
    at = mark.end;
  });
  parts.push(text.slice(at) + (text.endsWith('\n') ? ' ' : '')); // a last empty line takes its height in the field, too

  return <div ref={layer} class="mark-layer" aria-hidden="true">{parts}</div>;
}
