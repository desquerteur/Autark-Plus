// AF-026: project isolation – a one-way street. An agent IN a project (its home project as the Projects tab shows it,
// AF-018 projects/service.ts; the project's lead, AF-020, is one of its agents) reaches only the agents of that project
// and the person. Agents outside it – without a project or in another project – it neither sees nor reaches. Agents
// outside every project reach project agents as before, and the person (the owner, colleagues per_…) is never limited.
// Answers: an outsider that writes to a project agent does so in a chat the outsider (or the person) started. The
// project agent may write in exactly that chat – and in a thread on one of its messages – so it can answer; it never
// opens a chat with an outsider, brings one into a chat, delegates, hands or assigns work to one (a chat the project
// agent started itself never counts as an answer, even when an outsider sits in it from before).
// A project the person removed from the list (its kv row `hidden`) is no project here: its agents are free again.
// Where it is held (each gate asks this file, nothing else decides): chat-joins.ts scopeRefusal for every new member
// pair (chat.send {to}, chat.direct, chat.create, chat.add_members), chat.send and schedules.message for every post,
// agents/handoff.ts (delegate, handoff), tasks.create / tasks.assign, agents.list / update / archive, and the RPC entry
// for an agent's own wf (rpc/project-gate.ts) – messages.send runs chat.send, so a post by wf is held there too.
// Owns: this rule and its wording. Never: limits the person, changes members or chats, or reads a project folder.

import path from 'node:path';
import type { RuntimeServices } from '../contracts.ts';
import '../contracts/agent-core.ts';
import { KvRepo } from '../store/kv.ts';
import { PROJECTS_NS, projectId, type ProjectRecord } from './service.ts';

export type IsolationServices = Pick<RuntimeServices, 'org' | 'db'> & Partial<Pick<RuntimeServices, 'agentCore' | 'chats'>>;

/** The project an agent works in: id and name. */
export interface AgentProject { id: string; name: string }

/** How deep a thread's parents are followed to find who started the conversation. */
const MAX_PARENTS = 5;

/** The project `agentId` works in (its home project, unless the person removed it from the list); undefined: none. */
export function projectOfAgent(s: IsolationServices, agentId: string): AgentProject | undefined {
  const homes = s.agentCore?.homes;
  if (!homes) return undefined;
  let folder: string | undefined;
  try { folder = homes.stored(agentId); } catch { folder = undefined; }
  if (!folder) return undefined;
  const id = projectId(folder);
  let record: ProjectRecord | undefined;
  try { record = new KvRepo(s.db).get<ProjectRecord>(PROJECTS_NS, id); } catch { record = undefined; }
  if (record?.hidden) return undefined;
  return { id, name: record?.name?.trim() || path.basename(folder) || folder };
}

const isAgent = (s: IsolationServices, id: string): boolean => s.org.get(id) !== undefined;
const nameOf = (s: IsolationServices, id: string): string => s.org.get(id)?.name ?? id;

/** The refusal's wording for `name` (`id`) outside `project`. */
export function outsideText(name: string, id: string, project: string): string {
  return `${name} (${id}) is outside my project "${project}": an agent in a project reaches only the agents of its project and the person. When ${name} writes to me, I answer in that chat.`;
}

/** True when `viewerId` may see and reach agent `otherId` (always for the person, agents outside every project and non-agents). */
export function mayReach(s: IsolationServices, viewerId: string, otherId: string): boolean {
  return reachRefusal(s, viewerId, otherId) === undefined;
}

/**
 * Why agent `fromId` may not reach `toId` (undefined: it may). Only an agent in a project is limited, and only towards
 * agents outside it; the person, colleagues, external members and unknown ids are left to the caller's own checks.
 */
export function reachRefusal(s: IsolationServices, fromId: string, toId: string, home = projectOfAgent(s, fromId)): string | undefined {
  if (!home || fromId === toId || !isAgent(s, toId)) return undefined;
  if (projectOfAgent(s, toId)?.id === home.id) return undefined;
  return outsideText(nameOf(s, toId), toId, home.name);
}

/** The first refusal among `ids` (see reachRefusal); undefined when agent `fromId` may reach every one of them. */
export function firstReachRefusal(s: IsolationServices, fromId: string, ids: readonly string[]): string | undefined {
  const home = projectOfAgent(s, fromId);
  if (!home) return undefined;
  for (const id of ids) {
    const why = reachRefusal(s, fromId, id, home);
    if (why) return why;
  }
  return undefined;
}

/** `agents` as agent `viewerId` sees them: an agent in a project sees itself and its project's agents only. */
export function visibleAgents<T extends { id: string }>(s: IsolationServices, viewerId: string, agents: readonly T[]): T[] {
  const home = projectOfAgent(s, viewerId);
  if (!home) return [...agents];
  return agents.filter((agent) => agent.id === viewerId || projectOfAgent(s, agent.id)?.id === home.id);
}

/** True when the conversation was started by someone outside project `projectIdOf` – the person, a colleague, the system or an outside agent (a thread: its parent's starter). */
export function startedFromOutside(s: IsolationServices, conversationId: string, projectIdOf: string, depth = 0): boolean {
  const chat = s.chats?.get(conversationId);
  if (!chat) return false;
  const by = chat.createdBy;
  if (!isAgent(s, by) || projectOfAgent(s, by)?.id !== projectIdOf) return true;
  const parent = chat.settings?.anchorId ? chat.settings.parentId : undefined; // a thread answers one message of its parent chat
  return parent !== undefined && depth < MAX_PARENTS && startedFromOutside(s, parent, projectIdOf, depth + 1);
}

/**
 * Why agent `agentId` may not post into `conversationId` (undefined: it may). A chat with no agent from outside its
 * project is free; one with outsiders only when they (or the person) started it – the answer to an incoming message.
 */
export function postRefusal(s: IsolationServices, agentId: string, conversationId: string): string | undefined {
  const home = projectOfAgent(s, agentId);
  if (!home || !s.chats) return undefined;
  let members: ReturnType<NonNullable<IsolationServices['chats']>['members']>;
  try { members = s.chats.members(conversationId); } catch { return undefined; }
  const outsiders = members.filter((member) => member.kind === 'agent' && !member.leftAt && member.memberId !== agentId && projectOfAgent(s, member.memberId)?.id !== home.id);
  if (!outsiders.length || startedFromOutside(s, conversationId, home.id)) return undefined;
  const names = outsiders.slice(0, 3).map((member) => `${nameOf(s, member.memberId)} (${member.memberId})`).join(', ') + (outsiders.length > 3 ? ` and ${outsiders.length - 3} more` : '');
  return `${names} ${outsiders.length === 1 ? 'is' : 'are'} outside my project "${home.name}", and this chat was started inside it: an agent in a project writes to agents outside it only in a chat they (or the person) started, as an answer.`;
}
