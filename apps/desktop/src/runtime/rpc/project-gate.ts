// AF-026: the RPC side of project isolation (the rule: projects/isolation.ts). An agent's own wf (AF-001: an owner socket
// that carries the agent's id) has the person's methods, so an agent in a project could reach outsiders through them. For
// such a socket every call is checked before its handler runs: a param that names an agent (AGENT_KEYS, one level into
// `patch`; `id` of the agents.* methods) must name one the agent may reach, else 'forbidden' with the rule's wording. And
// the agent lists it reads show only what it may see (agents.list, agents.org, agents.activity).
// messages.send needs nothing here: handlers/chats.ts sendAsAgent holds the rule (AF-001 membership + AF-026 project check).
// Owns: which params name agents and which results are filtered. Never: touches the person's own sockets or other scopes.

import { WorkforceError } from '../../shared/errors.ts';
import type { ClientScope } from '../../shared/api/protocol.ts';
import type { OrgNode } from '../../shared/model/org.ts';
import { firstReachRefusal, projectOfAgent, visibleAgents, type IsolationServices } from '../projects/isolation.ts';

/** Params that name agents (a string or a list of strings). */
const AGENT_KEYS = ['agentId', 'agentIds', 'memberId', 'add', 'lead', 'assigneeId', 'managerId', 'leadId', 'ownerAgentId', 'successorId', 'to', 'members'] as const;

/** The agent behind an agent's own wf socket (undefined: the person, a device, a colleague, …). */
export function gatedAgent(scope: ClientScope): string | undefined {
  return scope.kind === 'owner' && scope.agentId ? scope.agentId : undefined;
}

const strings = (value: unknown): string[] => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/** Every value of `params` that may name an agent. */
export function namedIds(method: string, params: unknown): string[] {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return [];
  const o = params as Record<string, unknown>;
  const ids: string[] = [];
  for (const source of [o, o.patch]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const key of AGENT_KEYS) ids.push(...strings((source as Record<string, unknown>)[key]));
  }
  if (method.startsWith('agents.')) ids.push(...strings(o.id));
  return ids;
}

/** Throws 'forbidden' when `agentId` (an agent's wf) names an agent outside its project in `params`. */
export function gateParams(s: IsolationServices, agentId: string, method: string, params: unknown): void {
  const ids = namedIds(method, params);
  if (!ids.length) return;
  const why = firstReachRefusal(s, agentId, ids);
  if (why) throw new WorkforceError('forbidden', why, { details: { method } });
}

function pruneTree(nodes: readonly OrgNode[], keep: (id: string) => boolean): OrgNode[] {
  return nodes.flatMap((node) => {
    const reports = pruneTree(node.reports, keep);
    return keep(node.agent.id) ? [{ ...node, reports }] : reports; // an outsider's reports move up a level
  });
}

/** `result` of `method` as agent `agentId` may see it (unchanged for an agent outside every project). */
export function gateResult(s: IsolationServices, agentId: string, method: string, result: unknown): unknown {
  if (!Array.isArray(result) || !projectOfAgent(s, agentId)) return result;
  if (method === 'agents.list') return visibleAgents(s, agentId, result as Array<{ id: string }>);
  const seen = new Set(visibleAgents(s, agentId, s.org.list({ includeArchived: true })).map((agent) => agent.id));
  if (method === 'agents.org') return pruneTree(result as OrgNode[], (id) => seen.has(id));
  if (method === 'agents.activity') return (result as Array<{ agentId?: string }>).filter((entry) => !entry.agentId || seen.has(entry.agentId));
  return result;
}
