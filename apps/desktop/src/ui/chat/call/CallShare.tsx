// Owner 19.11.2026: the live preview of what this device shows on the call (call-view.ts) – a small tile under the call card
// (call.css: it floats like the card, nothing beside it moves). A drag on it marks a cut-out (call-view-model.ts cutBetween),
// drawn as a frame; the next spoken line takes that cut-out along instead of the whole picture. A tap on the frame's × drops it.
// Owns: the tile's markup and the drag. Never: the stream or what goes out (call-view.ts).

import { useEffect, useRef, useState } from 'preact/hooks';
import { callCut, callShare } from './call-view.ts';
import { cutBetween, type Cut } from './call-view-model.ts';

const pointIn = (box: DOMRect, event: PointerEvent) => ({ x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height });
const style = (cut: Cut) => ({ left: `${cut.x * 100}%`, top: `${cut.y * 100}%`, width: `${cut.w * 100}%`, height: `${cut.h * 100}%` });

export function CallShare(props: { conversationId: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<Cut | undefined>();
  const [ratio, setRatio] = useState(16 / 9); // the tile takes the picture's shape, so a drag maps onto the picture 1:1
  const share = callShare.value;
  const shown = share?.conversationId === props.conversationId ? share : null;
  useEffect(() => {
    if (video.current && shown && video.current.srcObject !== shown.stream) { video.current.srcObject = shown.stream; void video.current.play().catch(() => undefined); }
  }, [shown?.stream]);
  if (!shown) return null;
  const cut = drag ?? callCut.value ?? undefined;

  const down = (event: PointerEvent) => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    start.current = pointIn(box, event);
  };
  const move = (event: PointerEvent) => {
    if (!start.current) return;
    setDrag(cutBetween(start.current, pointIn((event.currentTarget as HTMLElement).getBoundingClientRect(), event)));
  };
  const up = (event: PointerEvent) => {
    if (!start.current) return;
    const marked = cutBetween(start.current, pointIn((event.currentTarget as HTMLElement).getBoundingClientRect(), event));
    start.current = null;
    setDrag(undefined);
    if (marked) callCut.value = marked;
  };

  return (
    <div class="call-share" data-kind={shown.kind} style={{ aspectRatio: String(ratio), width: `min(100%, calc(60vh * ${ratio.toFixed(3)}))` }} title="Drag to cut out a part – it goes with your next sentence"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; setDrag(undefined); }}>
      <video ref={video} muted playsInline onLoadedMetadata={(event) => { const el = event.currentTarget; if (el.videoWidth && el.videoHeight) setRatio(el.videoWidth / el.videoHeight); }} aria-label={shown.kind === 'camera' ? 'Your camera on the call' : 'Your screen on the call'} />
      {cut && (
        <span class="call-cut" style={style(cut)}>
          {!drag && <button type="button" class="call-cut-drop" aria-label="Drop the cut-out" onPointerDown={(event) => event.stopPropagation()} onClick={() => { callCut.value = null; }}>×</button>}
        </span>
      )}
    </div>
  );
}
