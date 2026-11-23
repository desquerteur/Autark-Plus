// The rules that protect colleagues when work is given – one place for every path (an agent's task tools, the owner's
// window, a colleague's device, a routine, the watcher's pick):
//  1. A colleague sees a task only in a chat they are in: work given to them from a chat they are not in moves to the
//     giver's 1:1 with them; chat-free work stays chat-free (they read it as its owner, people/access.ts).
//  2. People and agents give each other work where they may work together: a colleague gives to agents of their spaces
//     when their scope allows giving tasks to agents; an agent gives to a colleague who may work with it.
//  3. A colleague changes only work that is theirs: they own it, made it or gave it (mayChange).
//  4. A form asking for a password or key goes to the person who owns the organisation only.
// Owns: those checks. Never: writes a task, notifies anyone or adds a member to a group chat.

import { HUMAN_ID, SYSTEM_ID } from '../../shared/ids.ts';
import { WorkforceError } from '../../shared/errors.ts';
import { isPersonId } from '../../shared/model/people.ts';
import type { Task } from '../../shared/model/tasks.ts';
import type { RuntimeServices } from '../contracts.ts';
import { findOrCreateDirect } from '../chat/direct.ts';
import { secretFields } from '../secrets/capture.ts';
import { PeopleRepo } from './repo.ts';
import { mayUseAgent, membership } from './access.ts';

type Deps = Pick<RuntimeServices, 'db' | 'chats'> & Partial<Pick<RuntimeServices, 'org' | 'clock' | 'settings'>> & Partial<Pick<RuntimeServices, 'people'>>;
type To = { kind: 'agent'; id: string } | { kind: 'human'; id?: string } | { kind: 'team' };

const personOf = (s: Pick<RuntimeServices, 'db'>, id: string) => { try { return new PeopleRepo(s.db).get(id); } catch { return undefined; } };

/**
 * Checks that `by` may give work (`task`: its chat and widget; none yet for a new one) to `to`; returns the chat the
 * work lives in for that receiver – a colleague outside its chat gets it in the giver's 1:1 with them.
 */
export function checkMayGive(s: Deps, by: string, to: To, task: Pick<Task, 'conversationId' | 'widget'> | undefined): string | undefined {
  const chat = task?.conversationId;
  if (to.kind === 'agent' && isPersonId(by)) {
    const person = personOf(s, by);
    if (!person || !person.scopes.assignAgents || !mayUseAgent(person, s.org?.get(to.id))) {
      throw new WorkforceError('forbidden', 'You do not give tasks to this agent.', { details: { agentId: to.id } });
    }
    return chat;
  }
  if (to.kind !== 'human' || !to.id || to.id === HUMAN_ID) return chat;
  const person = personOf(s, to.id);
  if (!person || person.status === 'revoked') throw new WorkforceError('not_found', 'This person is no longer in the organisation.', { details: { personId: to.id } });
  const name = person.name || 'This person';
  if (!isPersonId(by) && by !== HUMAN_ID && by !== SYSTEM_ID && !mayUseAgent(person, s.org?.get(by))) {
    throw new WorkforceError('forbidden', `${name} does not work with me (not in the spaces the person gave them).`, { details: { personId: to.id } });
  }
  if (secretFields(task?.widget).length) {
    throw new WorkforceError('forbidden', `A form that asks for a password or key goes to the person who owns the organisation, not to ${name}.`, { details: { personId: to.id } });
  }
  if (!chat || membership(s.db, to.id, chat)) return chat;
  return findOrCreateDirect(s, by === SYSTEM_ID ? HUMAN_ID : by, to.id, { createdBy: by === SYSTEM_ID ? HUMAN_ID : by });
}

/** Rule 3: a colleague changes only work that is theirs – they own it, made it or gave it. */
export function mayChange(personId: string, task: Pick<Task, 'assigneeId' | 'createdBy' | 'assignedBy'>): boolean {
  return task.assigneeId === personId || task.createdBy === personId || task.assignedBy === personId;
}
