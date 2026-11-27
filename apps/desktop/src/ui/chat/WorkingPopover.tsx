// The chat header's working popover (B-048 E4.5): the live line in the sub line (LiveLine.tsx) opens
// it over the content – anchored to the always reserved sub line, so nothing in the header or the
// chat moves, and it stays open while a run hands over to the next one. One row per member working
// in this chat (live-text.ts workingRows, ordered by start): avatar and name (both open the agent's
// page – its activity log, where else it works), the model it runs on now · effort in a fixed slot at the line's
// end, what it does now (its step, else its note) and its task. B-057: a running split group is one row ("3 of 5 parts
// working") that opens to its split rows. The rows come from the chat's live bar (the summary's `live`, chat/live.ts).
// "Stop all agent work" (shell/work-stop.ts) stays its last entry for whoever may stop. On a
// phone the popover is a bottom sheet (mobile.css).
// Feedback 16.11.2026 (F20, owner – supersedes "no Stop in the chat" of 21.10.): each agent's row has its own Stop for
// whoever may cancel runs – it ends only that agent's current run (runs.cancel), so in a group the others keep working.
// Owns: the popover's markup and which rows are open. Never: stops other agents than the row's, invents a model or
// steps the runtime did not report, or polls.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ConversationSummary } from '../../shared/model/chat.ts';
import { AgentAvatar, Icon, Popover, Spinner } from '../lib/ui.tsx';
import { StopRun } from './StopRun.tsx';
import { agentMap, tasks } from '../lib/store.ts';
import { go } from '../lib/router.ts';
import { can } from '../lib/session.ts';
import { openTaskDetail } from '../tasks/jump.ts';
import { stopAllWork, workAction, workStop } from '../shell/work-stop.ts';
import { liveRuns, stoppableRun, workingRows, type WorkingRow } from './live-text.ts';
import { SplitList } from '../splits/SplitRows.tsx'; // B-057
import { splitGroups, watchSplits } from '../splits/split-model.ts';

/** The popover's width on the desktop (clamped to the window, lib/popover.tsx). */
const WIDTH = 360;

/** Open state of a chat's working popover; another chat starts closed. `anchor` goes on the sub line. */
export function useWorkingPanel(chatId: string) {
  const anchor = useRef<HTMLDivElement>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === chatId;
  return {
    anchor, open,
    toggle: () => setOpenFor(open ? null : chatId),
    close: () => {
      // The sub line is no focus target (lib/popover.tsx focuses the anchor on Escape): a close from inside hands focus back to the live line.
      if (document.activeElement?.closest('.working-popover')) anchor.current?.querySelector<HTMLElement>('.chat-live')?.focus({ preventScroll: true });
      setOpenFor(null);
    },
  };
}

type Chat = Pick<ConversationSummary, 'id' | 'working' | 'live'>;

export function WorkingPopover(props: { chat: Chat; anchor: HTMLElement | null; open: boolean; onClose: () => void }) {
  const { chat, open, onClose } = props;
  const body = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => body.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  if (!open) return null;
  const rows = workingRows(chat, liveRuns(chat), (id) => agentMap.value.get(id)?.name).map((row) => {
    // Live summaries carry the group id and counts, not its goal. Reading the signal here
    // also fills the reserved model slot when the coalesced splits.list read completes.
    const group = row.groupId ? splitGroups.value.get(row.groupId) : undefined;
    return group ? { ...row, model: group.goal } : row;
  });
  const toggle = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key); else next.add(key);
    setExpanded(next);
  };
  const stop = workAction(workStop.value) === 'stop';
  return (
    <Popover anchor={props.anchor} open={open} onClose={onClose} placement="bottom-start" width={WIDTH} class="working-popover" label="Agent work">
      <div ref={body}>
        <div class="menu-section">
          <div class="menu-title">Working now</div>
          {rows.length
            ? <ul class="working-rows">{rows.map((row) => <Row key={row.key} row={row} open={expanded.has(row.key)} onToggle={() => toggle(row.key)} onLeave={onClose} />)}</ul>
            : <p class="working-empty">Nobody is working right now</p>}
        </div>
        {stop && (
          <div class="menu-section">
            <button type="button" class="menu-item danger" onClick={() => { onClose(); void stopAllWork(); }}>
              <Icon name="stop-circle" size={18} />
              <span class="menu-label">
                <span>Stop all agent work</span>
                <small>Every agent on this PC stops now; their tasks pause.</small>
              </span>
            </button>
          </div>
        )}
      </div>
    </Popover>
  );
}

function Row(props: { row: WorkingRow; open: boolean; onToggle: () => void; onLeave: () => void }) {
  const { row, open } = props;
  const runId = stoppableRun(row, can('runs.cancel'));
  const toAgent = () => { props.onLeave(); go.agent(row.agentId); };
  const task = row.taskId ? tasks.value.find((item) => item.id === row.taskId) : undefined;
  const note = <span class="working-row-note">{row.note}</span>;
  return (
    <li class="working-row" data-agent-id={row.agentId} data-run-id={row.runId}>
      <span class="working-row-avatar"><AgentAvatar agentId={row.agentId} size={24} working onClick={toAgent} /></span>
      <div class="working-row-main">
        <div class="working-row-head">
          <button type="button" class="working-row-name" onClick={toAgent}>{row.name}</button>
          <span class="working-row-model tabular" title={row.model || undefined}>{row.model}</span>
          {runId && <StopRun runId={runId} name={row.name} class="working-row-stop" />}
        </div>
        {row.groupId
          ? <button type="button" class="working-row-toggle" aria-expanded={open} onClick={props.onToggle}>
            <Icon name={open ? 'caret-down' : 'caret-right'} size={12} />{note}
          </button>
          : <span class="working-row-toggle"><span class="working-row-caret" />{note}</span>}
        {row.taskId && can('tasks.get') && (
          <button type="button" class="working-task text-button" onClick={() => { props.onLeave(); openTaskDetail(row.taskId!); }}>
            <Icon name="list-checks" size={14} /><span>{task?.title ?? 'Task'}</span>
          </button>
        )}
        {open && row.groupId && <GroupDetail groupId={row.groupId} />}
      </div>
    </li>
  );
}

/** B-057: an open split group row – its split rows (each opens to its own steps); a group only the activity named is read. */
function GroupDetail(props: { groupId: string }) {
  const readable = can('splits.list');
  const group = splitGroups.value.get(props.groupId);
  const known = Boolean(group);
  useEffect(() => (readable && !known ? watchSplits({ groupId: props.groupId }) : undefined), [props.groupId, readable, known]);
  return (
    <div class="working-row-detail">
      {group ? <SplitList group={group} />
        : readable ? <span class="working-row-loading"><Spinner size={14} /></span> : <p class="working-row-empty">Splits are not available here</p>}
    </div>
  );
}
