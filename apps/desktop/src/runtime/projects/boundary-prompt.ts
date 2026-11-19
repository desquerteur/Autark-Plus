// AF-026: the volatile prompt's "My project" section – an agent in a project learns whom it reaches (its project's
// agents and the person) and that it answers an outsider only in the chat the outsider started (projects/isolation.ts).
// '' for every agent outside a project. Owns: this text. Never: decides what the agent may reach (isolation.ts does).

import type { Agent } from '../../shared/model/org.ts';
import type { RuntimeServices } from '../contracts.ts';
import { projectOfAgent } from './isolation.ts';

const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** The section's text for project `name` (pure, so the wording is testable). */
export function boundarySectionText(name: string): string {
  return [
    '## My project',
    `I work in the project "${oneLine(name)}". I reach only its agents and the person: agents outside it I neither see nor write to – I open no chat with them and delegate, hand or assign them nothing.`,
    'An agent from outside may write to me; then I answer in that chat (or a thread on its message), and nowhere else.',
  ].join('\n');
}

/** The "My project" section for `agent` ('' when it works in no project). */
export function projectBoundarySection(services: RuntimeServices, agent: Pick<Agent, 'id'>): string {
  if (!services.db || !services.org) return ''; // a reduced services object (tests, tools) has no projects
  const project = projectOfAgent(services, agent.id);
  return project ? boundarySectionText(project.name) : '';
}
