// AF-020: the "Agents" section of a project's page (data-tour="project-agents") – every agent working in the project
// right on the page, the lead first with a crown and "Lead" mark. Per agent one row: its avatar with the real status,
// name, what it does right now (or its role); a click picks it for the page's side chat (on the phone: opens its 1:1).
// The crown cell makes it the lead or takes the lead away again, the person cell opens its agent page. Without agents:
// "Hire a lead from this folder" (folderAgents.create, then projects.update).
// Owns: this section's markup. Never: who may lead (runtime/projects) or a second agent list (lib/store agents).

import { useState } from 'preact/hooks';
import type { Project } from '../../shared/model/project.ts';
import { agentMap } from '../lib/store.ts';
import { go } from '../lib/router.ts';
import { toastError } from '../lib/toasts.ts';
import { Button, Icon, IconButton } from '../lib/ui.tsx';
import { AgentStatusAvatar, agentLine } from '../team/parts.tsx';
import { agentsLeadFirst } from './projects-model.ts';
import { hireProjectLead, setProjectLead } from './projects-store.ts';

export function ProjectAgents(props: { project: Project; selected?: string; onSelect: (agentId: string) => void }) {
  const { project, selected, onSelect } = props;
  const [hiring, setHiring] = useState(false);
  const list = agentsLeadFirst(project);
  const hire = async () => {
    if (hiring) return;
    setHiring(true);
    try { onSelect(await hireProjectLead(project)); } catch (error) { toastError(error, 'Could not hire a lead'); } finally { setHiring(false); }
  };
  const toggleLead = (agentId: string) => {
    const next = project.leadId === agentId ? '' : agentId;
    void setProjectLead(project.id, next).catch((error) => toastError(error, 'Could not change the lead'));
  };
  return (
    <div class="project-agents" data-tour="project-agents">
      <h2 class="project-section">Agents</h2>
      {list.length ? (
        <div class="project-agent-list" role="list">
          {list.map((entry) => {
            const agent = agentMap.value.get(entry.id);
            const lead = entry.id === project.leadId;
            const line = agent ? (agentLine(agent) || agent.role) : '';
            return (
              <div key={entry.id} role="listitem" class={`project-agent${entry.id === selected ? ' active' : ''}${lead ? ' lead' : ''}`}>
                <button type="button" class="project-agent-open" aria-pressed={entry.id === selected} title={`Write with ${entry.name}`} onClick={() => onSelect(entry.id)}>
                  {agent ? <AgentStatusAvatar agent={agent} size={28} /> : <Icon name="user" size={20} />}
                  <span class="project-agent-text">
                    <span class="project-agent-name">{entry.name}{lead && <span class="project-lead-mark"><Icon name="crown" size={12} />Lead</span>}</span>
                    {line && <span class="project-agent-line">{line}</span>}
                  </span>
                </button>
                <IconButton icon="crown" size="small" pressed={lead} label={lead ? `Remove ${entry.name} as lead` : `Make ${entry.name} the lead`} onClick={() => toggleLead(entry.id)} />
                <IconButton icon="user" size="small" label={`${entry.name}'s agent page`} onClick={() => go.agent(entry.id)} />
              </div>
            );
          })}
        </div>
      ) : (
        <div class="project-agents-empty">
          <span class="project-muted">Nobody works in this project yet.</span>
          {!project.missing && <Button icon="crown" busy={hiring} onClick={() => void hire()}>Hire a lead from this folder</Button>}
        </div>
      )}
      {list.length > 0 && !project.leadId && <p class="project-muted project-agents-hint">Tip: the crown makes an agent the project lead – it answers first and coordinates the others.</p>}
    </div>
  );
}
