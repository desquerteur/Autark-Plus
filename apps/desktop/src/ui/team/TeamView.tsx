// #/team without an agent or a person. The org chart lives in the sidebar tree (TeamNav.tsx); the main zone shows the agent
// directory (AF-017, agents/AgentDirectory.tsx) – every agent with its project, status and chat – and, one tab away, the whole
// org at one look (upstream F18): one headline from the live state ("12 agents · 3 working · 1 waiting") and the same tree as
// the sidebar (TeamTree.tsx), read-only and fully open; a row opens that agent's or person's page. On the phone the Team tab
// IS the sidebar tree, with the directory one tap away ("All agents").
// Owns: this main page and the phone's tab body. Never: its own tree model, carets or expand state.

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { Header } from '../lib/header.tsx';
import { agents, isMobile } from '../lib/store.ts';
import { teamHeadline } from './model.ts';
import { ensureSpaces, liveByAgent } from './org-state.ts';
import { TeamTree } from './TeamTree.tsx';
import type { Expand } from './TeamTree.tsx';
import { TeamNav } from './TeamNav.tsx';
import { AgentDirectory } from '../agents/AgentDirectory.tsx'; // AF-017

type TeamTab = 'chart' | 'directory';
/** The phone's choice between the org chart and the directory (the chart first, as the Team tab always was). */
const phoneTab = signal<TeamTab>('chart');
/** The computer's choice: the directory first (AF-017), the org overview one tab away. */
const deskTab = signal<TeamTab>('directory');

function TeamTabs(props: { tab: TeamTab; set: (tab: TeamTab) => void }) {
  return (
    <div class="team-tabs" role="tablist" aria-label="Team">
      <button type="button" role="tab" aria-selected={props.tab === 'chart'} class="directory-seg" onClick={() => props.set('chart')}>Org chart</button>
      <button type="button" role="tab" aria-selected={props.tab === 'directory'} class="directory-seg" onClick={() => props.set('directory')}>All agents</button>
    </div>
  );
}

const ALL_OPEN: Expand = { open: () => true, line: 'role' };

export function TeamView() {
  useEffect(() => { ensureSpaces(); }, []);
  if (isMobile.value) {
    const tab = phoneTab.value;
    return (
      <div class="team-view">
        <TeamTabs tab={tab} set={(next) => { phoneTab.value = next; }} />
        <div class="team-scroll">{tab === 'chart' ? <TeamNav /> : <AgentDirectory />}</div>
      </div>
    );
  }
  const tab = deskTab.value;
  return (
    <div class="team-view">
      <Header zone="main" class="team-header" title="Team" />
      <TeamTabs tab={tab} set={(next) => { deskTab.value = next; }} />
      <div class="team-scroll">
        {tab === 'directory' ? <AgentDirectory /> : (
          <div class="team-overview">
            <p class="team-headline tabular">{teamHeadline(agents.value, liveByAgent.value)}</p>
            <div class="team-rows"><TeamTree expand={ALL_OPEN} /></div>
          </div>
        )}
      </div>
    </div>
  );
}
