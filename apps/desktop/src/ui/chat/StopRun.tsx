// Feedback 16.11.2026 (F20, owner; Mika's UX pass): one agent's own Stop – icon and the word, so it reads without
// hover and on touch. While runs.cancel goes out and until the run's row goes it says "Stopping…"; a failure says
// why in a toast and offers Stop again. Used at the end of the chat's live line (one stoppable agent working,
// ChatHeader.tsx) and in each row of the working popover (WorkingPopover.tsx).
// Owns: that button. Never: stops another run than its own, or all agent work (shell/work-stop.ts).

import { useState } from 'preact/hooks';
import { rpc } from '../lib/rpc.ts';
import { toastError } from '../lib/toasts.ts';
import { Icon } from '../lib/ui.tsx';

export function StopRun(props: { runId: string; name: string; class?: string }) {
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    try { await rpc.call('runs.cancel', { runId: props.runId }); } catch (err) { toastError(err, `Could not stop ${props.name}`); setStopping(false); }
  };
  return (
    <button type="button" class={`stop-run${props.class ? ` ${props.class}` : ''}`} aria-busy={stopping || undefined} disabled={stopping}
      title={`Stop ${props.name} now – others keep working`} aria-label={stopping ? `Stopping ${props.name}` : `Stop ${props.name}`} onClick={() => void stop()}>
      <Icon name="stop-circle" size={14} />
      <span>{stopping ? 'Stopping…' : 'Stop'}</span>
    </button>
  );
}
