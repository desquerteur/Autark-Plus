// #/team without an agent or a person. On a computer: the whole org at one look – one headline from the live state
// ("12 agents · 3 working · 1 waiting") and the same tree as the sidebar (TeamTree.tsx), read-only and fully open,
// so who is under whom shows without a click; a row opens that agent's or person's page. F18 (owner 15.11.2026): the
// page shows the structure, not the activity – each agent's line is its role and "· N reports" for a manager; what
// they do now stays in the avatar ring and the headline. On the phone the Team tab IS the sidebar tree (TeamNav.tsx).
// Owns: this main page and the phone's tab body. Never: its own tree model, carets or expand state.

import { useEffect } from 'preact/hooks';
import { Header } from '../lib/header.tsx';
import { agents, isMobile } from '../lib/store.ts';
import { teamHeadline } from './model.ts';
import { ensureSpaces, liveByAgent } from './org-state.ts';
import { TeamTree } from './TeamTree.tsx';
import type { Expand } from './TeamTree.tsx';
import { TeamNav } from './TeamNav.tsx';

const ALL_OPEN: Expand = { open: () => true, line: 'role' };

export function TeamView() {
  useEffect(() => { ensureSpaces(); }, []);
  if (isMobile.value) return <div class="team-view"><div class="team-scroll"><TeamNav /></div></div>;
  return (
    <div class="team-view">
      <Header zone="main" class="team-header" title="Team" />
      <div class="team-scroll">
        <div class="team-overview">
          <p class="team-headline tabular">{teamHeadline(agents.value, liveByAgent.value)}</p>
          <div class="team-rows"><TeamTree expand={ALL_OPEN} /></div>
        </div>
      </div>
    </div>
  );
}
