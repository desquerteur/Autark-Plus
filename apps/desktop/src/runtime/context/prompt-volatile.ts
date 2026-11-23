// The LIVE part of the prompt (the first block of the turn input, never the system prompt): what changes between turns,
// each section under a fixed name (a resumed native session gets only the changed ones, agents/volatile-delta.ts). Order:
// now (date, time and zone, the model the turn runs on), the split's own facts (B-057), "My environment now"
// (environment.ts), who works nearby (work-presence), the models line, "## My chats" (chat-overview.ts), my split groups
// still at work, my home project and its skills (agent-core/prompt.ts), "## Pinned" – always-skills and pinned notes
// with the day they were saved under one cap (knowledge/always.ts) –, the current task, "## My tasks" each with its next
// look, "## Given by me" (work I gave that others own) and my own schedules. A section says real news only: no counters, no previews of my own lines, times absolute in the person's
// zone (context/time.ts). One agent, one context: every section reads the agent's own mode (the turn's mode is its own);
// only the current task depends on what woke the turn. A split's turn (thread `split:<id>`) drops its main self's
// sections.
// B-083: "## Now" says what I run on – model · effort and the turn's temperature (route.temperature; where the model
// samples at its own setting, my stance for the step with TEMPERATURE_FACT) – and my start model and who set it.
// Owner 15.11.2026: "## Now" also names the engine the turn runs in ("in Claude Code"; environment.ts engineName) – the
// engines the system has stand in "My environment now".
// B-089: the models line is its own section, so a price refresh or a catalog relist re-sends only that section.
// Owns: those renderings and their caps. A failing source is skipped (logged), never fatal.
// Never: state reconstructed from memory similarity - tasks and schedules come from their services; any list of what
// memory holds, or a hint of the subconscious (it shows real tool calls, agents/turn-prepare.ts).

import type { RuntimeServices } from '../contracts.ts';
import type { Agent } from '../../shared/model/org.ts';
import type { ModeInfo } from '../../shared/model/knowledge.ts';
import type { RouteDecision } from '../../shared/model/providers.ts';
import type { Schedule } from '../../shared/model/tasks.ts';
import { excerpt } from '../../shared/text/chat-names.ts';
import { temperatureText } from '../../shared/model/runs.ts';
import { dayName, dueText, fullDateTime, profileZone } from './time.ts';
import { TEMPERATURE_FACT, takesTemperature } from '../engines/http/temperature.ts'; // B-083
import { currentTaskSection, taskLine } from './task-text.ts';
import { namesFor } from '../tasks/next.ts';
import { chatOverview } from './chat-overview.ts'; // 13.11.2026: "## My chats"
import { modelsFactsLine } from './setup-facts.ts';
import { SPLIT_SKIP, activeSplitsLine, splitFacts, splitSection } from './split-section.ts'; // B-057
import { ALWAYS_CHARS, alwaysLines, alwaysSet } from '../knowledge/always.ts';
import { homeSection } from '../agent-core/prompt.ts'; // B-044: the home project and its skills (names + descriptions)
import { projectLeadSection } from '../projects/lead-prompt.ts'; // AF-020: the projects it leads
import { projectBoundarySection } from '../projects/boundary-prompt.ts'; // AF-026: whom an agent in a project reaches
import { engineName, environmentNow, ownFileTools } from './environment.ts'; // disk, companies and PCs, sign-ins, connected apps
import { workNearbySection } from '../work-presence/context-line.ts'; // B-055 G (Q11): who else is changing files near this agent's work
import { personalitySection } from '../personality/prompt.ts'; // AF-006: "## My personality", read fresh each turn

/** The one cap of what always stands in the prompt (knowledge/always.ts). */
export const PINNED_CAP = ALWAYS_CHARS;
const MAX_TASKS = 10;
const MAX_SCHEDULES = 10;

export interface VolatileInput {
  agent: Agent;
  conversationId?: string;
  taskId?: string;
  /** B-054: the turn's thread (TurnPlan.thread) – its native session's key. */
  thread?: string;
  /** The turn's mode – the agent's own (agents/turn-prepare.ts); absent: the agent's mode key is looked up. */
  mode?: ModeInfo;
  route: RouteDecision;
}

function nowSection(services: RuntimeServices, input: VolatileInput, zone: string): string {
  const { route } = input;
  const now = services.clock.now();
  return [`## Now`, `${fullDateTime(now, zone)} (${zone})`, runsOnLine(services, route), startModelLine(services, input.agent, zone, now)]
    .filter(Boolean).join('\n');
}

/** A model's catalog name, else its id without the provider prefix. */
function modelName(services: RuntimeServices, id: string): string {
  try { return services.catalog.get(id)?.name ?? id.slice(id.indexOf(':') + 1); } catch { return id.slice(id.indexOf(':') + 1); }
}

/** B-083: "I run on X · effort Y[ · temperature Z], in <engine>." – a temperature the model does not take (thinking stays on, owner 09.11.) is my stance for this step. */
function runsOnLine(services: RuntimeServices, route: RouteDecision): string {
  let info: ReturnType<RuntimeServices['catalog']['get']>;
  try { info = services.catalog.get(route.modelId); } catch { info = undefined; /* catalog not wired */ }
  const runs = `I run on ${info?.name ?? route.modelId} · effort ${route.effort}`;
  const engine = route.engine ? `, in ${engineName(services, route)}` : '';
  if (route.temperature === undefined) return `${runs}${engine}.`;
  const warmth = temperatureText(route.temperature);
  const model = info?.model ?? route.modelId.slice(route.modelId.indexOf(':') + 1);
  if (takesTemperature(route.engine, model, route.effort)) return `${runs} · temperature ${warmth}${engine}.`;
  return `${runs}${engine}; temperature ${warmth} is my stance for this step, as this model samples at its own setting – ${TEMPERATURE_FACT}.`;
}

/** B-083: my start model (agent page, a manager's agents.update, or my own) and who set it, when – "on my page" for the owner's. */
function startModelLine(services: RuntimeServices, agent: Agent, zone: string, now: number): string {
  const { pin, pinBy } = agent.modelPolicy ?? {};
  if (!pin || pin === 'auto') return '';
  const who = !pinBy ? '' : pinBy.self ? ` (I set it myself, ${dayName(pinBy.at, zone, now)})` : ` (set by ${pinBy.name}${pinBy.name === ownerName(services) ? ' on my page' : ''}, ${dayName(pinBy.at, zone, now)})`;
  return `My start model: ${modelName(services, pin)}${who}.`;
}

function pinnedSection(services: RuntimeServices, agent: Agent, zone: string, conversationId?: string, mode?: ModeInfo): string {
  // B-078 D12: one always set – the always-skills and the pinned notes (each with the day it was saved), one cap (knowledge/always.ts)
  const lines = alwaysLines(services, agent, alwaysSet(services, agent, mode, conversationId), zone);
  return lines.length ? ['## Pinned', ...lines].join('\n') : '';
}

function ownerName(services: RuntimeServices): string {
  try { return services.settings.get().profile.name?.trim() || 'the person'; } catch { return 'the person'; }
}

/**
 * "## My tasks": my unfinished tasks but the current one (a piece of a listed task stands with it), each with its next
 * look; one more line for planned wakes that carry no task – or "Nothing is planned for me." when there is nothing.
 */
function myTasksSection(services: RuntimeServices, agent: Agent, currentTaskId: string | undefined, zone: string): string {
  const open = services.tasks.openFor(agent.id);
  const ids = new Set(open.map((task) => task.id));
  const top = open.filter((task) => task.id !== currentTaskId && !(task.parentId && (ids.has(task.parentId) || task.parentId === currentTaskId)));
  const now = services.clock.now();
  const names = namesFor(services, zone);
  const lines = top.slice(0, MAX_TASKS).map((task) => taskLine(task, names, now));
  if (top.length > MAX_TASKS) lines.push(`(+${top.length - MAX_TASKS} more – tasks.list)`);
  const planned = services.wakes.list(agent.id).filter((wake) => wake.claimedAt === undefined && !wake.taskId && wake.dueAt > now);
  if (planned.length) lines.push(`- ${planned.length} more look${planned.length === 1 ? '' : 's'} planned without a task, the next ${dueText(Math.min(...planned.map((wake) => wake.dueAt)), zone, now)}`);
  if (!lines.length && currentTaskId) return '';
  return ['## My tasks', ...(lines.length ? lines : ['Nothing is planned for me.'])].join('\n');
}

/** "## Given by me": unfinished work I gave that someone else owns, newest first, with its state – it stays my business. */
function givenSection(services: RuntimeServices, agent: Agent, zone: string): string {
  const given = services.tasks.list({ givenBy: agent.id, includeSteps: true, limit: MAX_TASKS + 1 });
  if (!given.length) return '';
  const now = services.clock.now();
  const names = namesFor(services, zone);
  const lines = given.slice(0, MAX_TASKS).map((task) => taskLine(task, names, now, { owner: true, mine: agent.id }));
  if (given.length > MAX_TASKS) lines.push('(more – tasks.list whose "given")');
  return ['## Given by me', ...lines].join('\n');
}

function scheduleLine(schedule: Schedule, zone: string, now: number): string {
  const when = schedule.nextAt ? `next ${dueText(schedule.nextAt, zone, now)}` : 'no next run';
  const repeat = schedule.spec.cron ? ` · cron "${schedule.spec.cron}"` : schedule.spec.everyMs ? ` · every ${Math.round(schedule.spec.everyMs / 60_000)} min` : schedule.spec.times ? ` · daily at ${schedule.spec.times.join(', ')}` : '';
  return `- ${schedule.id} · ${schedule.kind} · ${excerpt(schedule.title, 100)} · ${when}${repeat}`;
}

function schedulesSection(services: RuntimeServices, agent: Agent, zone: string): string {
  const own = services.scheduler.list({ ownerId: agent.id }).filter((schedule) => schedule.active);
  if (!own.length) return '';
  const now = services.clock.now();
  const lines = own.slice(0, MAX_SCHEDULES).map((schedule) => scheduleLine(schedule, zone, now));
  if (own.length > MAX_SCHEDULES) lines.push(`(+${own.length - MAX_SCHEDULES} more – schedules.list)`);
  return ['## My schedules', ...lines].join('\n');
}

/** The agent's own mode (the turn's mode when given); undefined when the mode library does not know it. */
function ownMode(services: RuntimeServices, input: VolatileInput): ModeInfo | undefined {
  if (input.mode) return input.mode;
  try { return services.modes.get(input.agent.mode); } catch { return undefined; }
}

/** One rendered section of the volatile prompt under its fixed name ('now', 'environment', 'task' …); `failed`: its builder threw (text ''). */
export interface VolatileSection { name: string; text: string; failed?: true }

/** The volatile prompt as one string (the sections in order, a blank line apart). */
export function buildVolatile(services: RuntimeServices, input: VolatileInput): string {
  return volatileSections(services, input).filter((section) => !section.failed).map((section) => section.text).join('\n\n');
}

/**
 * The volatile prompt's non-empty sections in order, each under its fixed name (B-049 F6: a resumed native session gets
 * only the changed ones, agents/volatile-delta.ts). A section whose builder threw comes back as `failed` with no text,
 * so the delta keeps its last record instead of calling it no longer current.
 */
export function volatileSections(services: RuntimeServices, input: VolatileInput): VolatileSection[] {
  const { agent, conversationId, taskId } = input;
  const zone = profileZone(services); // the Now line's zone; saved/indexed days use the same one (knowledge/age.ts)
  const split = splitFacts(services, input.thread); // B-057: a split's turn (thread split:<id>)
  const reach = conversationId ?? split?.group?.conversationId; // B-057 S15: a split's pinned notes are its parent chat's
  const mode = ownMode(services, input);
  const sections: Array<[string, () => string]> = [
    ['now', () => nowSection(services, input, zone)],
    ['personality', () => personalitySection(services, agent)], // AF-006: the global personality with the agent's own over it
    ['split', () => (split ? splitSection(agent, split) : '')], // B-057 S5: who it is, its part, the other parts, its rules
    ['environment', () => environmentNow(services, { agent, mode })],
    ['models', () => modelsFactsLine(services)], // B-089: the connected models with price, smarts and how a turn is paid (B-078 D16)
    ['work-nearby', () => workNearbySection(services, { agent, taskId })], // B-055 G (Q11): at most 3 lines / 300 chars, '' when no one works nearby
    ['chats', () => chatOverview(services, agent.id, conversationId)],
    ['splits', () => (split ? '' : activeSplitsLine(services, agent.id, input.thread, conversationId))], // B-057 R1-4: its split groups still at work (B-080: from every chat, this thread's first)
    ['home', () => homeSection(services, agent, mode?.key, ownFileTools(services, input.route?.engine))], // B-044: the home project turns start in and the skills found there
    ['project-lead', () => (split ? '' : projectLeadSection(services, agent))], // AF-020: it leads a project – the overview and its agents
    ['project', () => projectBoundarySection(services, agent)], // AF-026: in a project it reaches only that project's agents
    ['pinned', () => pinnedSection(services, agent, zone, reach, mode)],
    ['task', () => (taskId ? currentTaskSection(services, taskId, zone) : '')],
    ['tasks', () => myTasksSection(services, agent, taskId, zone)],
    ['given', () => givenSection(services, agent, zone)],
    ['schedules', () => schedulesSection(services, agent, zone)],
  ];
  const out: VolatileSection[] = [];
  for (const [name, build] of sections) {
    if (split && SPLIT_SKIP.has(name)) continue; // B-057: its main self's sections
    try {
      const text = build();
      if (text.trim()) out.push({ name, text });
    } catch (error) {
      services.log?.debug('volatile prompt section skipped', { section: name, error: String(error) });
      out.push({ name, text: '', failed: true });
    }
  }
  return out;
}
