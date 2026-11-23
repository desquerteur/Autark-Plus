// RPC handlers: spaces, agents (list/get/org tree/templates/hire/update/archive/restore), live
// activity, run audit (runs, items) and cancelling a run. agents.update also checks that an image
// avatar is a stored image and that 'Works on' names this PC (stored as none) or a linked PC (O6).
// Owns: param checks and scope rules for these methods. Never: business logic – it delegates
// to the org service, the dispatcher and the run journal. Agents hired here are createdBy 'human'.
// Tiers: reads with 'chat'; hiring, editing, archiving, spaces and run insight with 'manage'. runs.items is a
// 'chat' method for the runs of chats the device can open (the "Worked … · N steps" line under an
// answer, C5) and, B-054 P10, for chat-free runs whose task (if any) still exists; every other run's
// items need 'manage' (checkRunAccess).
// agents.archive takes an optional successorId (org/service.ts: the successor takes over role, place, reports, tasks).
// B-057: agents.runs lists the agent's own turns only (its splits' runs are under their groups, splits.list); runs.items
// judges a split's run as its group's parent run – the rule of splits.list/get (people/events.ts splitPlace).
// AF-012: runs.cancel stops any running run by its id – a main-lane turn through the dispatcher, a split's run as the
// person's Stop of that split (splits.stop) – the Stop per sub-agent of the agent view.
// agents.log (shared/api/methods-log.ts): the agent's activity log – its turns, oldest first, with every journaled item
// (runs/log.ts); 'manage' like agents.runs, since it shows every run of the agent, whichever chat or task it worked for.
// Wave 3: agents.update `base.instructions` = the text an editor started from; instructions changed meanwhile
// (SYSTEM.md taken over, another edit) refuse the edit as a conflict (root/text-doc.ts staleBase).
// Feedback F10/F21 (16.11.2026): agents.activity lists the runs of the person's other PCs too (deviceId set), and
// runs.cancel of a run this PC does not have goes to the PC that runs it (devices/sync/live.ts cancelThere).
// F13: hireInput, updateAgent and archiveAgent take who acts – the owner here, a CEO person in people/rpc-ceo.ts.

import { HUMAN_ID } from '../../../shared/ids.ts';
import { MAX_SYSTEM_MD } from '../../../shared/model/agent-core.ts';
import type { Agent, Space } from '../../../shared/model/org.ts';
import type { Run } from '../../../shared/model/runs.ts';
import { WorkforceError } from '../../../shared/errors.ts';
import { id, input, notFound, num, onlyKeys, optBool, optId, optNum, optOneOf, optText, text } from '../params.ts';
import { scopeHas } from '../table.ts';
import { splitPlace } from '../../people/events.ts';
import { staleBase } from '../../root/text-doc.ts';
import { clearChatRetry } from '../../agents/redelivery.ts';
import { readAgentLog } from '../../runs/log.ts';
import { allActivity } from '../../chat/live.ts';
import { liveSyncOf } from '../../devices/sync/live.ts';
import '../../../shared/api/methods-log.ts'; // agents.log (module augmentation)
import type { HandlerContext, HandlerTable } from '../table.ts';

const TODO = { capability: 'todo' } as const;
const CHAT = { capability: 'chat' } as const;
const MANAGE = { capability: 'manage' } as const;
/** Who changes an agent through these methods – the person. */
const PERSON = { by: HUMAN_ID } as const;
const SPACE_KINDS = ['company', 'brand', 'private', 'custom'] as const;
/** Fields the human may change through agents.update (identity, org place, model policy). */
const AGENT_PATCH = ['name', 'role', 'avatar', 'instructions', 'mode', 'skills', 'modelPolicy', 'managerId', 'spaceId', 'team', 'deviceId', 'voice'] as const;

export function register(table: HandlerTable): void {
  // ---------------------------------------------------------------- spaces
  table.add('spaces.list', (_params, ctx) => ctx.services.org.spaces(), CHAT);
  table.add('spaces.save', (params, ctx) => {
    const o = input(params);
    onlyKeys(o, ['id', 'name', 'kind', 'color', 'sort']);
    const space: Partial<Space> & { name: string } = { name: text(o, 'name', { max: 80 }) };
    const spaceId = optId(o, 'id');
    if (spaceId) space.id = spaceId;
    const kind = optOneOf(o, 'kind', SPACE_KINDS);
    if (kind) space.kind = kind;
    if (o.color === null) space.color = null as unknown as undefined; // null clears the color (org service)
    else if (o.color !== undefined) space.color = text(o, 'color', { max: 40 });
    const sort = optNum(o, 'sort', { min: -1_000_000, max: 1_000_000 });
    if (sort !== undefined) space.sort = sort;
    return ctx.services.org.saveSpace(space);
  }, MANAGE);
  table.add('spaces.archive', (params, ctx) => {
    ctx.services.org.archiveSpace(id(input(params)));
    return { ok: true };
  }, MANAGE);

  // ---------------------------------------------------------------- agents
  table.add('agents.list', (params, ctx) => ctx.services.org.list({ includeArchived: optBool(input(params), 'includeArchived') ?? false }), TODO);
  table.add('agents.get', (params, ctx) => ctx.services.org.require(id(input(params))), CHAT);
  table.add('agents.org', (_params, ctx) => ctx.services.org.tree(), CHAT);
  table.add('agents.templates', (_params, ctx) => ctx.services.org.templates(), CHAT);
  table.add('agents.create', (params, ctx) => ctx.services.org.create(hireInput(params, HUMAN_ID)), MANAGE);
  table.add('agents.update', (params, ctx) => updateAgent(params, ctx, HUMAN_ID), MANAGE);
  table.add('agents.archive', (params, ctx) => archiveAgent(params, ctx, HUMAN_ID), MANAGE);
  table.add('agents.restore', (params, ctx) => ctx.services.org.restore(id(input(params)), PERSON), MANAGE);
  table.add('agents.activity', (_params, ctx) => allActivity(ctx.services.bus, ctx.services.dispatcher.activity()), CHAT); // F10: with the runs of the person's other PCs

  // ---------------------------------------------------------------- runs
  table.add('agents.runs', (params, ctx) => {
    const o = input(params);
    const agentId = id(o);
    ctx.services.org.require(agentId);
    const limit = optNum(o, 'limit', { min: 1, max: 200 }) ?? 50;
    // B-057: the agent's own turns – its splits' runs are listed under their groups (splits.list).
    const runs = ctx.services.runs.listTopLevel?.(agentId, limit) ?? ctx.services.runs.list(agentId, limit);
    return runs.filter((run) => !run.splitId); // a journal without listTopLevel
  }, MANAGE);
  table.add('agents.log', (params, ctx) => {
    const o = input(params);
    onlyKeys(o, ['id', 'before']);
    const agentId = id(o);
    ctx.services.org.require(agentId);
    const before = optNum(o, 'before', { min: 0 });
    return readAgentLog(ctx.services.db, agentId, before === undefined ? {} : { before });
  }, MANAGE);
  table.add('runs.items', (params, ctx) => {
    const runId = id(input(params), 'runId');
    checkRunAccess(ctx, ctx.services.runs.get(runId) ?? notFound('Run', { runId }));
    return ctx.services.runs.items(runId);
  }, CHAT);
  table.add('runs.cancel', async (params, ctx) => {
    const runId = id(input(params), 'runId');
    if (await cancelRunHere(ctx.services, runId)) return { ok: true };
    // F21/F10 (16.11.2026): a run another of the person's PCs runs (its live state is here) – that PC stops it.
    if (await liveSyncOf(ctx.services)?.cancelThere(runId)) return { ok: true };
    return notFound('Run', { runId });
  }, MANAGE);
}

/** agents.create's params → the hire made by `createdBy`. */
export function hireInput(params: unknown, createdBy: string): Parameters<HandlerContext['services']['org']['create']>[0] {
  const o = input(params);
  onlyKeys(o, ['name', 'template', 'role', 'managerId', 'spaceId', 'instructions', 'mode']);
  return {
    name: optText(o, 'name', { max: 80 }),
    template: optText(o, 'template', { max: 80 }),
    role: optText(o, 'role', { max: 80, allowEmpty: true }),
    managerId: optId(o, 'managerId'),
    spaceId: optId(o, 'spaceId'),
    instructions: optText(o, 'instructions', { max: MAX_SYSTEM_MD, allowEmpty: true, multiline: true }),
    mode: optText(o, 'mode', { max: 60 }),
    createdBy,
  };
}

/** agents.update by `by`: the patch's fields, an editor's stale text, the avatar image and 'Works on' (checkPlacement). */
export function updateAgent(params: unknown, ctx: HandlerContext, by: string): Agent {
  const o = input(params);
  onlyKeys(o, ['id', 'patch', 'base']);
  const agentId = id(o);
  const patch = input(o.patch);
  onlyKeys(patch, AGENT_PATCH, 'patch');
  const base = o.base === undefined ? undefined : input(o.base);
  if (base) onlyKeys(base, ['instructions'], 'base');
  const baseText = base ? optText(base, 'instructions', { max: MAX_SYSTEM_MD, allowEmpty: true, multiline: true }) : undefined;
  if (baseText !== undefined && typeof patch.instructions === 'string' && staleBase(ctx.services.org.require(agentId).instructions, baseText, patch.instructions)) {
    throw new WorkforceError('conflict', 'The instructions changed while you were editing (in SYSTEM.md or another edit). Load the new text and save again.');
  }
  checkPlacement(ctx, patch);
  // Values are validated by the org service (names, avatars, policies, cycles).
  return ctx.services.org.update(agentId, patch as Partial<Agent>, { by });
}

/** agents.archive by `by`, with an optional successor. */
export function archiveAgent(params: unknown, ctx: HandlerContext, by: string): { ok: true } {
  const o = input(params);
  onlyKeys(o, ['id', 'successorId']);
  const successorId = optId(o, 'successorId');
  ctx.services.org.archive(id(o), { by, ...(successorId ? { successorId } : {}) });
  return { ok: true };
}

/**
 * Stops one of this PC's runs by its id; false when this PC has no such run. Finished runs have nothing to stop; the
 * call stays idempotent. Stopping by run id never hits another turn of the same agent (interrupt() without a chat
 * stops whatever runs). Also the Stop another PC forwards (devices/sync/live.ts).
 */
export async function cancelRunHere(
  services: Pick<HandlerContext['services'], 'runs' | 'dispatcher' | 'db'> & Partial<Pick<HandlerContext['services'], 'splits' | 'promptQueue'>>, runId: string,
): Promise<boolean> {
  const run = services.runs.get(runId);
  if (!run) {
    // AF-012: a turn the dispatcher has started but not yet journaled stops by its id too – the dispatcher knows its own
    // runs (cancelRun is false for an unknown id), agent.activity may not name it yet.
    const early = services.dispatcher.activity().find((item) => item.runId === runId && !item.split);
    if (early?.conversationId) services.promptQueue?.pause(early.conversationId, 'stop'); // AF-016
    return Boolean(await services.dispatcher.cancelRun?.(runId));
  }
  if (run.status === 'running' || run.status === 'queued') {
    if (run.conversationId && !run.taskId && !run.splitId) clearChatRetry(services, run.agentId, run.conversationId);
    const { dispatcher, splits } = services;
    if (run.conversationId && !run.splitId) services.promptQueue?.pause(run.conversationId, 'stop'); // AF-016: its chat's queue waits
    // AF-012: a split's run is the person's Stop of that one part (the split service ends it as stopped – never retried):
    // the agent view's Stop per sub-agent. Every other run stops through the dispatcher, by its id.
    if (run.splitId && splits) splits.stop({ splitId: run.splitId }, HUMAN_ID);
    else if (dispatcher.cancelRun) await dispatcher.cancelRun(runId);
    else await dispatcher.interrupt(run.agentId, run.conversationId);
  }
  return true;
}

// ---------------------------------------------------------------- O6: avatar image and 'Works on'

const FILE_ID = /^[a-f0-9]{64}$/;

/**
 * An image avatar must be an uploaded image; `deviceId` must be this PC (stored as none – the
 * default) or a linked PC (not revoked, not still pairing) – the targets the agents.update tool
 * accepts (tools/registry.ts resolveDevice).
 */
function checkPlacement(ctx: HandlerContext, patch: Record<string, unknown>): void {
  const avatar = patch.avatar as { kind?: unknown; value?: unknown } | null | undefined;
  if (avatar && typeof avatar === 'object' && avatar.kind === 'image') {
    const file = typeof avatar.value === 'string' && FILE_ID.test(avatar.value) ? ctx.services.files.get(avatar.value) : undefined;
    if (!file || !file.mime.startsWith('image/')) throw new WorkforceError('bad_request', 'Choose an uploaded image for the avatar.', { details: { param: 'patch.avatar' } });
  }
  const deviceId = patch.deviceId;
  if (typeof deviceId !== 'string') return;
  if (deviceId === ctx.services.devices.self().id) { patch.deviceId = null; return; }
  const pc = ctx.services.devices.list().find((device) => device.id === deviceId);
  if (!pc || pc.kind !== 'pc' || pc.status === 'revoked' || pc.status === 'pairing') {
    throw new WorkforceError('bad_request', 'Choose this PC or a linked PC.', { details: { param: 'patch.deviceId' } });
  }
}

// ---------------------------------------------------------------- C5: run items in a chat

/**
 * A device without 'manage' reads only the items of a run that worked in a chat it can open
 * (every chat a 'chat' device may list, hidden team rooms and archived chats included), or – B-054
 * P10 – of a run without a chat whose task, if it has one, still exists. Never a run whose chat is
 * gone. The owner and 'manage' devices read every run.
 */
function checkRunAccess(ctx: HandlerContext, asked: Run): void {
  if (scopeHas(ctx.scope, 'manage')) return;
  const run = judgedRun(ctx, asked);
  if (run.conversationId && ctx.services.chats.get(run.conversationId)) return;
  if (!run.conversationId && (!run.taskId || ctx.services.tasks.get(run.taskId))) return;
  throw new WorkforceError('forbidden', 'Open this on your PC, or allow this phone in Settings › Devices.', { details: { runId: asked.id } });
}

/**
 * B-057: a split's run has no chat or task of its own – it is judged as its group's parent run (that turn's chat or
 * task), the rule splits.list/get apply (handlers/splits.ts); a split that cannot be found is not found.
 */
function judgedRun(ctx: HandlerContext, run: Run): Pick<Run, 'id' | 'conversationId' | 'taskId'> {
  if (!run.splitId) return run;
  const place = splitPlace(ctx.services, run.splitId) ?? notFound('Split', { id: run.splitId });
  return ctx.services.runs.get(place.parentRunId) ?? { id: place.parentRunId, conversationId: place.conversationId, taskId: place.taskId };
}
