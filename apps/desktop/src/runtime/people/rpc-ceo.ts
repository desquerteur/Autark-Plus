// What a person with the role 'ceo' calls beyond a member (F13, owner 15.11.2026: "zwei CEOs … der auch praktisch über den
// Agents, über den Managern steht"): the hire templates; hiring, editing, archiving and restoring agents with the owner's
// own checks (rpc/handlers/org.ts); adding, editing, inviting, revoking and removing the members of the organisation with
// their devices, audit lines and chats as metadata (people/service.ts) – ids in their view (perspective.ts). The owner's
// row, another CEO's and the role itself stay the owner's, and so do the setup, place and SYSTEM.md of his own agents
// (access.ts ownersOwnAgent) and his private chats with a member. Their company view of chats and tasks is people/access.ts;
// plan accounts, keys, secrets, Settings and the owner's own 1:1s have no person variant at all, so they stay closed.
// Admitting a device stays the owner's decision (people/join.ts).
// Owns: these person variants (table.addPerson with `ceo`) and the people.save params. Never: runs the owner's handler or
// acts on the owner's row.

import { WorkforceError } from '../../shared/errors.ts';
import { isHumanActor, isPersonId, type Person, type PersonChat, type PersonScopes } from '../../shared/model/people.ts';
import type { Agent, Avatar } from '../../shared/model/org.ts';
import type { RuntimeServices } from '../contracts.ts';
import { archiveAgent, hireInput, updateAgent } from '../rpc/handlers/org.ts';
import { id, input, onlyKeys, optNum, optObj, optOneOf, optText, type Obj } from '../rpc/params.ts';
import type { HandlerContext, HandlerTable } from '../rpc/table.ts';
import { chatAccess, ownersOwnAgent } from './access.ts';
import type { PeopleService, SaveInput } from './service.ts';
import { realId, viewAgent, viewId, viewPerson } from './perspective.ts';
import { caller } from './rpc-base.ts';

const CEO = { ceo: true } as const;

/** people.save's params (the owner's and a CEO's). */
export function saveInput(params: unknown): SaveInput {
  const o = input(params);
  onlyKeys(o, ['id', 'name', 'title', 'avatar', 'managerId', 'scopes', 'role']);
  const managerId = o.managerId === null ? null : optText(o, 'managerId', { max: 128 });
  const role = optOneOf(o, 'role', ['member', 'ceo'] as const);
  return {
    id: optText(o, 'id', { max: 64 }), name: optText(o, 'name', { max: 80 }), title: optText(o, 'title', { max: 80, allowEmpty: true }),
    avatar: optObj(o, 'avatar') as Avatar | undefined, ...(o.managerId !== undefined ? { managerId } : {}),
    scopes: optObj(o, 'scopes') as PersonScopes | undefined, // cleaned by the service (people/repo.ts cleanScopes)
    ...(role ? { role } : {}),
  };
}

function peopleOf(ctx: HandlerContext): PeopleService {
  if (!ctx.services.people) throw new WorkforceError('unavailable', 'People are not available on this PC.');
  return ctx.services.people;
}

/** An agent's setup and place: the owner's own agents keep them as he set them (access.ts ownersOwnAgent). */
const OWNERS_SETUP = ['instructions', 'mode', 'skills', 'managerId', 'spaceId', 'deviceId'];

/** An agent as the CEO sees it: whole, the owner's own without their SYSTEM.md. */
function seen(ctx: HandlerContext, ceo: Person, agent: Agent): Agent {
  return viewAgent(ceo.id, agent, true, ownersOwnAgent(ctx.services.org, ceo.id, agent));
}

/** The member `viewIdOf` names (in the CEO's view) – never the owner or a CEO, themselves included. */
function memberOf(ctx: HandlerContext, ceo: Person, viewIdOf: string): Person {
  const target = peopleOf(ctx).require(realId(ceo.id, viewIdOf));
  if (target.owner || target.role === 'ceo') throw new WorkforceError('forbidden', 'The owner of the organisation changes the CEOs.', { details: { personId: viewIdOf } });
  return target;
}

/** `chatsOf`: a person's chats as metadata (rpc/handlers/people.ts, the owner's people.chats). */
export function registerPersonCeo(table: HandlerTable, chatsOf: (services: RuntimeServices, personId: string) => PersonChat[]): void {
  // ---------------------------------------------------------------- agents
  table.addPerson('agents.templates', (_params, ctx) => { caller(ctx); return ctx.services.org.templates(); }, CEO);
  table.addPerson('agents.create', (params, ctx) => {
    const person = caller(ctx);
    const hire = hireInput(params, person.id);
    const managerId = hire.managerId === undefined ? undefined : realId(person.id, hire.managerId);
    // A hire names an agent as manager (org/hire.ts); a person manager is set right after it, the owner is the top.
    const agent = ctx.services.org.create({ ...hire, managerId: managerId && !isHumanActor(managerId) ? managerId : undefined });
    const placed = managerId && isPersonId(managerId) ? ctx.services.org.update(agent.id, { managerId }, { by: person.id }) : agent;
    return seen(ctx, person, placed);
  }, CEO);
  table.addPerson('agents.update', (params, ctx) => {
    const person = caller(ctx);
    const o = input(params);
    const patch = o.patch && typeof o.patch === 'object' && !Array.isArray(o.patch) ? { ...(o.patch as Obj) } : o.patch;
    if (patch && typeof patch === 'object' && OWNERS_SETUP.some((key) => key in (patch as Obj)) && ownersOwnAgent(ctx.services.org, person.id, ctx.services.org.require(id(o)))) {
      throw new WorkforceError('forbidden', 'This agent works for the owner personally – its instructions, mode, skills and place stay as he set them.', { details: { agentId: o.id } });
    }
    if (patch && typeof patch === 'object' && typeof (patch as Obj).managerId === 'string') (patch as Obj).managerId = realId(person.id, (patch as Obj).managerId as string);
    return seen(ctx, person, updateAgent({ ...o, patch }, ctx, person.id));
  }, CEO);
  table.addPerson('agents.archive', (params, ctx) => archiveAgent(params, ctx, caller(ctx).id), CEO);
  table.addPerson('agents.restore', (params, ctx) => {
    const person = caller(ctx);
    return seen(ctx, person, ctx.services.org.restore(id(input(params)), { by: person.id }));
  }, CEO);

  // ---------------------------------------------------------------- members of the organisation
  table.addPerson('people.save', (params, ctx) => {
    const person = caller(ctx);
    const save = saveInput(params);
    if (save.role !== undefined) throw new WorkforceError('forbidden', 'The owner of the organisation gives and takes the CEO role.');
    if (save.id !== undefined) save.id = memberOf(ctx, person, save.id).id;
    if (typeof save.managerId === 'string') save.managerId = realId(person.id, save.managerId);
    return viewPerson(person.id, peopleOf(ctx).save(save, person.id), true);
  }, CEO);
  table.addPerson('people.invite', async (params, ctx) => {
    const person = caller(ctx);
    const invite = await peopleOf(ctx).invite(memberOf(ctx, person, id(input(params))).id, person.id);
    return { ...invite, personId: viewId(person.id, invite.personId) };
  }, CEO);
  table.addPerson('people.closeInvite', (params, ctx) => {
    const person = caller(ctx);
    peopleOf(ctx).closeInvite(memberOf(ctx, person, id(input(params))).id, person.id);
    return { ok: true };
  }, CEO);
  table.addPerson('people.revoke', (params, ctx) => {
    const person = caller(ctx);
    return viewPerson(person.id, peopleOf(ctx).revoke(memberOf(ctx, person, id(input(params))).id, person.id), true);
  }, CEO);
  table.addPerson('people.remove', (params, ctx) => {
    peopleOf(ctx).remove(memberOf(ctx, caller(ctx), id(input(params))).id);
    return { ok: true };
  }, CEO);
  table.addPerson('people.removeDevice', (params, ctx) => {
    const person = caller(ctx);
    const o = input(params);
    return viewPerson(person.id, peopleOf(ctx).removeDevice(memberOf(ctx, person, id(o)).id, id(o, 'deviceId'), person.id), true);
  }, CEO);
  table.addPerson('people.audit', (params, ctx) => {
    const person = caller(ctx);
    const o = input(params);
    return peopleOf(ctx).audit(memberOf(ctx, person, id(o)).id, optNum(o, 'limit', { min: 1, max: 500 }))
      .map((line) => ({ ...line, actor: viewId(person.id, line.actor) }));
  }, CEO);
  // A member's chats as metadata – of those with the owner only the ones the CEO reads (his own stay his, titles included).
  table.addPerson('people.chats', (params, ctx) => {
    const person = caller(ctx);
    return chatsOf(ctx.services, memberOf(ctx, person, id(input(params))).id).filter((entry) => {
      if (!entry.withOwner) return true;
      const chat = ctx.services.chats.get(entry.id);
      return Boolean(chat && chatAccess(ctx.services.db, person.id, chat));
    });
  }, CEO);
}
