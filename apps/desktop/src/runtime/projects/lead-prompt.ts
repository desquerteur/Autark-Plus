// AF-020: the volatile prompt's "Project lead" section – an agent the person made the lead of a project (Projects tab)
// learns that it leads it, who else works in it and that it coordinates them. '' for every other agent (one kv read).
// Owns: this text. Never: decides who leads (runtime/projects/service.ts) or what the agent may call (the tool sets).

import type { Agent } from '../../shared/model/org.ts';
import type { RuntimeServices } from '../contracts.ts';
import { projectsOf, type LedProject } from './service.ts';

const MAX_OTHERS = 12;

const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** The section's text for the projects given (pure, so the wording is testable). */
export function leadSectionText(projects: readonly LedProject[]): string {
  if (!projects.length) return '';
  const lines = ['## Project lead'];
  for (const project of projects) {
    lines.push(`I lead the project "${oneLine(project.name)}" (${oneLine(project.folder)}). The person comes to me first about it: I keep the overview, plan the work and say who does what.`);
    if (!project.others.length) {
      lines.push('No other agent works in it yet – I do the work myself, or suggest hiring one when it needs more hands.');
      continue;
    }
    const shown = project.others.slice(0, MAX_OTHERS).map((agent) => `${oneLine(agent.name)} (${agent.id})`);
    const more = project.others.length > MAX_OTHERS ? ` and ${project.others.length - MAX_OTHERS} more` : '';
    lines.push(`Its other agents: ${shown.join(', ')}${more}. I hand them bounded parts (agents.delegate, or tasks.create for them), talk to them with chat.direct, and report the result to the person.`);
  }
  return lines.join('\n');
}

/** The "Project lead" section for `agent` ('' when it leads no project). */
export function projectLeadSection(services: RuntimeServices, agent: Pick<Agent, 'id'>): string {
  if (!services.db || !services.org) return ''; // a reduced services object (tests, tools) has no projects
  return leadSectionText(projectsOf(services).ledBy(agent.id));
}
