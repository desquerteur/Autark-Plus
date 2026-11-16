// An agent's Work page (#/team/<agentId>/work, "Show work" on its page; owner feedback 16.11.2026 F11: "was der Agent
// gerade tut", every status line, the run open to its steps, only the really active tasks, the running work live;
// Mika's draft ux-backlog-20261116/ENTWURF-F11-SHOW-WORK.md). Top to bottom in one scrolled column, the same on a
// phone: Now and Active tasks (WorkNow.tsx), then the activity log (AgentLog.tsx, its own logic unchanged) – the newest
// steps at its end. The page opens at its top; scrolled to its end it follows each new step and turn there, scrolled up
// it stays put and "Jump to now" (in a fixed spot over the page's foot, so nothing moves) brings the end back while
// the agent works. A Now card's line jumps the log to its run's start. Header: Back to the agent's page and the
// agent's name menu (menus.ts agentMenu), as on the profile; on a phone the feedback cell ends the row (feedback/cell.tsx).
// On a phone the agent's answers in the log start closed.
// Owns: the page frame, following the log's end and the jumps. Never: polls, or shows what the runtime did not report.

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { EmptyState, Spinner } from '../lib/ui.tsx';
import { Header, backCell } from '../lib/header.tsx';
import { useContextMenu } from '../lib/context-menu.tsx';
import { keptPage } from '../lib/kept-page.ts';
import { activity, isMobile } from '../lib/store.ts';
import { phoneFeedbackCells } from '../feedback/cell.tsx';
import { go } from '../lib/router.ts';
import { AgentLog, useAgentLog } from './AgentLog.tsx';
import { useAgent } from './AgentView.tsx';
import { TitleMenu } from './TitleMenu.tsx';
import { agentMenu } from './menus.ts';
import { WorkNow, WorkTasks } from './WorkNow.tsx';
import { atEnd, lastEnded, nowCards } from './agent-work.ts';

export function AgentWork(props: { agentId: string }) {
  const { agentId } = props;
  const { agent, missing } = useAgent(agentId);
  const state = useAgentLog(agentId);
  const menu = useContextMenu(() => (agent ? agentMenu(agent) : []));
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(false); // the view shows the page's end: new steps keep it there
  const [away, setAway] = useState(false); // scrolled up from the end
  const cards = nowCards(activity.value, agentId);

  // A new step, turn or card: at the end the view stays at the end; elsewhere it stays where it is.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (following.current) box.scrollTop = box.scrollHeight;
    else setAway(!atEnd(box));
  }, [state.log, cards.length]);

  const onScroll = (event: Event) => {
    keptPage.onScroll(event);
    const end = atEnd(event.currentTarget as HTMLElement);
    following.current = end;
    setAway(!end);
  };
  const jumpToNow = () => {
    const box = scroller.current;
    if (!box) return;
    following.current = true;
    box.scrollTo({ top: box.scrollHeight });
  };
  const jumpToRun = (runId: string) => {
    following.current = false;
    scroller.current?.querySelector(`.log-turn[data-run-id="${CSS.escape(runId)}"]`)?.scrollIntoView({ block: 'start' });
  };

  const back = backCell(() => go.agent(agentId));
  if (!agent) {
    return (
      <div class="agent-view agent-work">
        <Header zone="main" class="agent-header" lead={back} title="" cells={phoneFeedbackCells()} />
        <div class="agent-scroll"><div class="agent-column">{missing ? <EmptyState>This agent no longer exists.</EmptyState> : <Spinner />}</div></div>
      </div>
    );
  }
  return (
    <div class="agent-view agent-work">
      <Header zone="main" class="agent-header" lead={back} title={<TitleMenu name={`${agent.name} · Work`} sections={() => agentMenu(agent)} />} cells={phoneFeedbackCells()} />
      <div class="agent-scroll" ref={scroller} onClickCapture={keptPage.onClickCapture} onScroll={onScroll}>
        <div class="agent-column" {...menu}>
          <WorkNow agentId={agentId} cards={cards} last={state.log ? lastEnded(state.log.runs) : undefined} onJump={jumpToRun} />
          <WorkTasks agentId={agentId} />
          <section class="agent-log" aria-label="Activity log">
            <h3 class="agent-section-title">Activity log</h3>
            <AgentLog state={state} answersOpen={!isMobile.value} />
          </section>
        </div>
      </div>
      {away && cards.length > 0 && <button type="button" class="work-jump" onClick={jumpToNow}>Jump to now</button>}
    </div>
  );
}
