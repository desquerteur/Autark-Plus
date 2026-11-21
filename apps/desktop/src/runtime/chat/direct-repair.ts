// B-078 D7 for existing data: once at start (kv marker), every marked default 1:1 with its pair (settings.directPair) loses the agents outside
// the pair. An open task such an agent owns in that chat moves first into its own 1:1 with the one who gave it
// (assigned by, else created by; the system or the agent itself: the pair's owner side) – the same room
// tasks/owners.ts routeOwner picks today – so no work loses its room. The chat keeps the "Removed …" line
// setMembers writes and, when work moved, one quiet line saying where it went on.
// B-080 (live: Jonas's step task_1m6psj5hcrynvcj52 stayed in Konrad–Lena's 1:1 with its review wake): steps move too –
// a step goes with its task when that moves, else on its own to its giver –, and a second pass under its own marker
// moves, once, the open work agents outside the pair left behind in such a 1:1 when the first pass ran before this.
// Owns: those passes. Never: removes a member of the pair, a person or a bridged contact ('ext:…'), runs a pass twice,
// or touches a group chat.

import { HUMAN_ID, SYSTEM_ID } from '../../shared/ids.ts';
import { isPersonId } from '../../shared/model/people.ts';
import type { RuntimeServices } from '../contracts.ts';
import { KvRepo } from '../store/kv.ts';
import { moveTaskChat } from '../tasks/owners.ts';
import { findOrCreateDirect } from './direct.ts';

type Deps = Pick<RuntimeServices, 'db' | 'chats' | 'tasks' | 'bus' | 'clock' | 'log'> & Partial<Pick<RuntimeServices, 'org' | 'people' | 'settings'>>;

const MARKER = { ns: 'b078', key: 'direct-two' };
const LEFT_WORK_MARKER = { ns: 'b080', key: 'direct-left-work' };

/**
 * Removes the extra agents of the owner's and everyone's marked 1:1s once, and once moves the open work agents outside
 * the pair left there; returns how many agents left plus how many left-behind tasks moved.
 */
export function repairDirectChats(s: Deps): number {
  const kv = new KvRepo(s.db);
  const first = kv.get(MARKER.ns, MARKER.key) === undefined;
  const second = kv.get(LEFT_WORK_MARKER.ns, LEFT_WORK_MARKER.key) === undefined;
  if (!first && !second) return 0;
  const rows = markedDirects(s);
  let removed = 0;
  if (first) {
    for (const { id, pair } of rows) removed += removeExtras(s, id, pair);
    kv.set(MARKER.ns, MARKER.key, { at: s.clock.now(), removed }, s.clock.now());
  }
  let moved = 0;
  if (second) {
    for (const { id, pair } of rows) moved += moveLeftWork(s, id, pair);
    kv.set(LEFT_WORK_MARKER.ns, LEFT_WORK_MARKER.key, { at: s.clock.now(), moved }, s.clock.now());
  }
  return removed + moved;
}

/** The marked default 1:1s with their pair. */
function markedDirects(s: Deps): Array<{ id: string; pair: string[] }> {
  const rows = s.db.all<{ id: string; pair: string }>(
    `SELECT c.id AS id, json_extract(c.settings, '$.directPair') AS pair FROM conversations c
      WHERE json_extract(c.settings, '$.direct') = 1 AND json_array_length(json_extract(c.settings, '$.directPair')) = 2`);
  const out: Array<{ id: string; pair: string[] }> = [];
  for (const row of rows) {
    try { out.push({ id: row.id, pair: JSON.parse(row.pair) as string[] }); } catch { /* not a pair */ }
  }
  return out;
}

/** The first pass for one 1:1: its agents outside the pair leave, their open work moves first; returns how many left. */
function removeExtras(s: Deps, chatId: string, pair: string[]): number {
  let removed = 0;
  const extra = s.chats.members(chatId).filter((member) => member.leftAt === undefined && member.kind === 'agent' && !pair.includes(member.memberId));
  for (const member of extra) {
    try {
      const moved = moveWork(s, chatId, member.memberId, pair);
      s.chats.setMembers(chatId, { remove: [member.memberId] }, SYSTEM_ID);
      removed++;
      if (moved) noteMoved(s, chatId, member.memberId, moved);
    } catch (error) {
      s.log.warn('a third member of a 1:1 stayed', { conversationId: chatId, memberId: member.memberId, error: String(error) });
    }
  }
  return removed;
}

/** B-080, the second pass for one 1:1: open work of agents outside the pair that is still there moves; returns how many tasks. */
function moveLeftWork(s: Deps, chatId: string, pair: string[]): number {
  const owners = s.db.all<{ assignee_id: string }>(
    `SELECT DISTINCT assignee_id FROM tasks WHERE conversation_id = ? AND assignee_kind = 'agent' AND assignee_id IS NOT NULL
       AND status IN ('open', 'waiting')`, [chatId]).map((row) => row.assignee_id).filter((id) => !pair.includes(id));
  let total = 0;
  for (const agentId of owners) {
    try {
      const moved = moveWork(s, chatId, agentId, pair);
      if (moved) noteMoved(s, chatId, agentId, moved);
      total += moved;
    } catch (error) {
      s.log.warn('left-behind work of a 1:1 stayed', { conversationId: chatId, agentId, error: String(error) });
    }
  }
  return total;
}

function noteMoved(s: Deps, chatId: string, agentId: string, moved: number): void {
  const name = s.org?.get(agentId)?.name ?? 'This colleague';
  s.chats.status(chatId, { type: 'note', text: `${name} continues ${moved === 1 ? 'one task' : `${moved} tasks`} from here in a 1:1 of its own` });
}

/**
 * Moves `agentId`'s open tasks of `chatId` – steps too (B-080) – into its 1:1 with their giver; returns how many moved. A
 * step under a task of its own list goes where the top of that chain goes (a step of a step too: moveTaskChat takes only
 * a task's direct steps, so each one still in the chat moves on its own call).
 */
function moveWork(s: Deps, chatId: string, agentId: string, pair: readonly string[]): number {
  type Row = { id: string; parent_id: string | null; assigned_by: string | null; created_by: string };
  const tasks = s.db.all<Row>(
    `SELECT id, parent_id, assigned_by, created_by FROM tasks WHERE conversation_id = ? AND assignee_kind = 'agent' AND assignee_id = ?
       AND status IN ('open', 'waiting')`, [chatId, agentId]);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const fallback = pair.includes(HUMAN_ID) ? HUMAN_ID : pair.find((id) => isPersonId(id)) ?? pair[0];
  const rooms = new Map<string, string>();
  const roomOf = (task: Row, seen: Set<string> = new Set()): string => {
    const known = rooms.get(task.id);
    if (known) return known;
    seen.add(task.id);
    const parent = task.parent_id && !seen.has(task.parent_id) ? byId.get(task.parent_id) : undefined;
    let room: string;
    if (parent) room = roomOf(parent, seen); // it goes with its task
    else {
      const given = task.assigned_by ?? task.created_by;
      const giver = !given || given === SYSTEM_ID || given === agentId ? fallback : given;
      room = findOrCreateDirect(s, giver, agentId, { createdBy: giver });
    }
    rooms.set(task.id, room);
    return room;
  };
  for (const task of tasks) {
    const room = roomOf(task);
    if (room === chatId || s.tasks.get(task.id)?.conversationId !== chatId) continue; // stays, or already moved with its task
    moveTaskChat(s, task.id, room);
  }
  for (const task of tasks) {
    const view = s.tasks.get(task.id);
    if (view && view.conversationId !== chatId) s.bus.emit('task.upserted', view);
  }
  return tasks.filter((task) => s.tasks.get(task.id)?.conversationId !== chatId).length;
}
