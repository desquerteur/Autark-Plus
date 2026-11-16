// B-078 ("schnell zur Seite wischen"): on the phone, a sideways swipe in a chat switches between its messages and its
// area (the chat's tabs) – the same as the header's Chat tabs cell (lib/shell-state.ts setChatArea): towards the left
// opens the area, towards the right goes back to the messages. A swipe counts only when it starts at least EDGE_PX from
// both screen edges (the system's own Back gesture keeps the edges), is clearly sideways and long enough, and does not
// start in a text field, in something that scrolls sideways itself, or on a surface that turns a finger into input of its
// own (the mirrored PC browser or screen, role="application" – a sideways drag there scrolls the PC page or moves its
// slider, it never closes the area). One passive listener set on the phone frame's main
// element (shell/MobileShell.tsx); no animation of its own, so nothing else moves.
// F30 (owner 16.11.2026: "auf dem Handy … zur Seite schweifen", to reply): a swipe towards the right that starts on a
// message while the messages show replies to that message (chatSwipe) – the composer's reply quote and its field's
// focus are the feedback. With the area open the same swipe still goes back to the messages; a swipe towards the left
// still opens the area; a start on a status line, a task card or empty room is no reply.
// Owns: the gesture and its thresholds. Never: what the area shows, or swipes outside a chat.

/** 24 dp from each edge stays the system's (CSS pixels are dp in a phone's browser). */
export const EDGE_PX = 24;
/** How far the finger travels sideways before it counts. */
export const SWIPE_PX = 64;

export type SwipeTurn = 'area' | 'messages' | null;

/** What a finished touch means (pure): the area, the messages, or nothing. */
export function swipeTurn(start: { x: number; y: number }, end: { x: number; y: number }, width: number): SwipeTurn {
  if (start.x < EDGE_PX || start.x > width - EDGE_PX) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 2 * Math.abs(dy)) return null;
  return dx < 0 ? 'area' : 'messages';
}

/** What a finished sideways swipe does in a chat (pure): towards the right on a message while the area is closed it
 *  replies to that message; otherwise it is the area or the messages. */
export function chatSwipe(to: Exclude<SwipeTurn, null>, messageId: string | undefined, areaOpen: boolean): Exclude<SwipeTurn, null> | 'reply' {
  return to === 'messages' && messageId && !areaOpen ? 'reply' : to;
}

/** The message a touch starts on: a text message's row (`article.message`), not a status line or a task card. */
export const SWIPED_MESSAGE = 'article.message[data-message-id]';

/** Elements whose sideways moves are their own: fields, touch surfaces of the PC browser/screen, `.no-swipe`. */
export const OWNS_SIDEWAYS = 'input, textarea, select, [contenteditable="true"], [role="application"], .browser-touch, .no-swipe';

/** True when the touch starts where a sideways move belongs to the element (OWNS_SIDEWAYS, sideways scrollers). */
export function ownsSideways(target: EventTarget | null): boolean {
  for (let node = target as HTMLElement | null; node && node !== document.body; node = node.parentElement) {
    if (node.matches?.(OWNS_SIDEWAYS)) return true;
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
  }
  return false;
}

/**
 * Listens on `root`; `chat()` names the open chat (undefined outside one), `turn` switches – with the message the touch
 * started on (SWIPED_MESSAGE), when it started on one. Returns the stop.
 */
export function watchChatSwipe(root: HTMLElement, chat: () => string | undefined, turn: (chatId: string, to: Exclude<SwipeTurn, null>, messageId?: string) => void): () => void {
  let start: { x: number; y: number; messageId?: string } | undefined;
  const down = (event: TouchEvent) => {
    const on = (event.target as Element | null)?.closest?.(SWIPED_MESSAGE)?.getAttribute('data-message-id') ?? undefined;
    start = event.touches.length === 1 && chat() && !ownsSideways(event.target) ? { x: event.touches[0].clientX, y: event.touches[0].clientY, ...(on ? { messageId: on } : {}) } : undefined;
  };
  const up = (event: TouchEvent) => {
    const from = start;
    start = undefined;
    const id = chat();
    const touch = event.changedTouches[0];
    if (!from || !id || !touch) return;
    const to = swipeTurn(from, { x: touch.clientX, y: touch.clientY }, window.innerWidth);
    if (to) turn(id, to, from.messageId);
  };
  const cancel = () => { start = undefined; };
  root.addEventListener('touchstart', down, { passive: true });
  root.addEventListener('touchend', up, { passive: true });
  root.addEventListener('touchcancel', cancel, { passive: true });
  return () => {
    root.removeEventListener('touchstart', down);
    root.removeEventListener('touchend', up);
    root.removeEventListener('touchcancel', cancel);
  };
}
