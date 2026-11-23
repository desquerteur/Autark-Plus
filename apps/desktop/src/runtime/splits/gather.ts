// Fan-in of split parts (B-057 S6/S15; owner 13.11.2026: "die letzte Nachricht wird automatisch der Main-Sitzung
// zurückgegeben" – a flowing split and merge): each part returns on its own. A part whose run ended for good wakes its
// origin at once (returned – reason 'child', on the thread it split in, coalesceKey 'splits:<groupId>', a short note) while
// its siblings may still work; when every split of a running group has ended the group is 'settled' and wakes it once more
// (same key: a wake not yet claimed takes both). The results are not in the note: the origin's next turn on that thread
// gets one "Split results" block (pendingResults – every part there that ended and has not reached it yet, with what it
// did, digest.ts); when that turn ends 'done' those parts are gathered (markGathered – Split.gatheredAt; a settled group
// whose parts all reached it is 'gathered' and its native sessions are released – release.ts; a fan-in wake not yet
// claimed is withdrawn once nothing of its group waits to reach the origin).
// A group the person stopped wakes nobody. agents.split_results reads the full texts (results); FIXES-3 A3 (18.11.2026,
// measured: one extra quiet turn for results the agent had already read): the ended parts it showed are gathered when the
// reading turn ends 'done', like an input block's.
// Decision 10 (17.11.2026): while the turn that split waits for a part (wait.ts) that part's end wakes nobody – the call
// that split it brings the same block back inside the turn (waitedResults), and those parts are gathered when that turn
// ends 'done' like the next turn's block. When the call's answer reaches nobody (it was cut, or its turn failed) the
// ended parts it held wake their origin once (wakeUnread).
// Owns: settle, the origin's wakes, pendingResults, markGathered, results and the waiting call's block. Never: starts or
// stops a split.

import { WorkforceError } from '../../shared/errors.ts';
import { SPLIT_TERMINAL, type Split, type SplitGroup } from '../../shared/model/splits.ts';
import { isTerminal, type SplitCore } from './core.ts';
import { fullResults, resultsBlock } from './results.ts';
import { partDigest } from './digest.ts';
import type { WaitNote } from './wait.ts';

export const coalesceKey = (groupId: string): string => `splits:${groupId}`;
const NOTE_GOAL = 120;

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The group's fan-in wake's note (short; the results come as an input block). */
export function wakeNote(group: SplitGroup, statuses: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  const list = [...counts].map(([status, count]) => `${count} ${status}`).join(', ');
  return `My ${statuses.length === 1 ? 'part' : `${statuses.length} parts`} for "${cut(group.goal, NOTE_GOAL)}" ended (${list}). What they did and their last words are in this turn's input under "Split results": I merge them.`;
}

/** A part's own fan-in wake's note. */
export function returnNote(group: SplitGroup, split: Pick<Split, 'idx' | 'title' | 'status'>): string {
  return `My part #${split.idx} "${cut(split.title, 80)}" (of "${cut(group.goal, NOTE_GOAL)}") ended (${split.status}). What it did and its last words are in this turn's input under "Split results": I merge them.`;
}

function wakeOrigin(core: SplitCore, group: SplitGroup, note: string): void {
  core.deps.wakes.wake({
    agentId: group.agentId, reason: 'child', note, coalesceKey: coalesceKey(group.id),
    ...(group.conversationId ? { conversationId: group.conversationId } : {}), ...(group.taskId ? { taskId: group.taskId } : {}),
    ...(group.origin ? { origin: group.origin } : {}),
  });
}

/** A part's run ended for good: its origin wakes at once, its siblings may still work (a stopped group wakes nobody). */
export function returned(core: SplitCore, splitId: string): void {
  const split = core.repo.getSplit(splitId);
  const group = split ? core.repo.getGroup(split.groupId) : undefined;
  if (!split || !group || !isTerminal(split.status) || group.status !== 'running') return;
  if (core.waits.waiting(splitId)) return; // decision 10: the turn that split it waits for it – its call returns it
  try { wakeOrigin(core, group, returnNote(group, split)); } catch (error) {
    core.deps.log.warn('a part\'s return did not wake its origin; its group\'s end will', { splitId, error: String(error) });
  }
}

/** A running group whose splits all ended: settled, the origin woken. True when it settled. */
export function settle(core: SplitCore, groupId: string): boolean {
  const group = core.repo.getGroup(groupId);
  if (!group || group.status !== 'running') return false;
  const splits = core.repo.listSplits({ groupId });
  if (!splits.every((split) => isTerminal(split.status))) return false;
  core.deps.db.tx(() => {
    core.repo.updateGroup(groupId, { status: 'settled', endedAt: core.now() });
    // Decision 10: parts a turn of the origin waits for reach it in that call's result, so they wake nobody.
    if (splits.some((split) => split.gatheredAt === undefined && !core.waits.waiting(split.id))) wakeOrigin(core, group, wakeNote(group, splits.map((split) => split.status)));
  });
  return true;
}

const waiting = (split: Split) => isTerminal(split.status) && split.gatheredAt === undefined;

/**
 * Decision 10: the ended parts of `group` that reached nobody – their wake was skipped while a call waited for them, and
 * that call's answer was not read – wake the origin once, with the notes they sent it meanwhile (a stopped group wakes nobody).
 */
export function wakeUnread(core: SplitCore, group: SplitGroup, notes: readonly WaitNote[] = []): void {
  if (group.status !== 'running' && group.status !== 'settled') return;
  const unread = core.repo.listSplits({ groupId: group.id }).filter((split) => waiting(split) && !core.waits.waiting(split.id));
  if (!unread.length) return;
  wakeOrigin(core, group, [wakeNote(group, unread.map((split) => split.status)), ...notesText(notes)].join('\n'));
}

/**
 * The origin's "Split results" block for its next turn on `thread`: every part there that ended and has not reached it
 * yet (its group running or settled), groups oldest first; `splitIds` are those parts.
 */
export function pendingResults(core: SplitCore, agentId: string, thread: string): { splitIds: string[]; text: string } | undefined {
  const groups = core.repo.listGroups({ agentId, thread, statuses: ['running', 'settled'] }).reverse();
  if (!groups.length) return undefined;
  const splits = core.repo.listSplits({ groupIds: groups.map((group) => group.id) });
  const entries = groups.map((group) => {
    const all = splits.filter((split) => split.groupId === group.id).sort((a, b) => a.idx - b.idx);
    return { group, splits: all, shown: all.filter(waiting) };
  }).filter((entry) => entry.shown.length);
  if (!entries.length) return undefined;
  return { splitIds: entries.flatMap((entry) => entry.shown.map((split) => split.id)), text: resultsBlock(core.deps.runs, entries, undefined, (split) => digestOf(core, split)) };
}

/** Decision 10: how many characters of my parts' notes while I waited ride in that call's result. */
const NOTES_CHARS = 6_000;
export const TOLD_WAITING = 'What my parts told me while I waited:';
export const STILL_WORKING = 'My parts that still work come back to me on their own as soon as they end.';

/** The notes of a wait as lines, newest last, within NOTES_CHARS; [] when none came. */
function notesText(notes: readonly WaitNote[]): string[] {
  if (!notes.length) return [];
  const lines: string[] = [];
  let size = 0;
  for (const note of [...notes].reverse()) {
    const line = `- ${note.text.trim()}`;
    if (size + line.length + 1 > NOTES_CHARS) { lines.push(`- … ${notes.length - lines.length} earlier notes`); break; }
    lines.push(line);
    size += line.length + 1;
  }
  return [TOLD_WAITING, ...lines.reverse()];
}

/**
 * Decision 10: the result of the call that split with `wait` – the "Split results" block the origin's next turn would
 * have got for the parts it waited for (`shown`, of the group's `splits`), the notes they sent while it waited, and,
 * while a part of that group still works, that it comes back on its own.
 */
export function waitedResults(core: SplitCore, group: SplitGroup, splits: readonly Split[], shown: readonly Split[], notes: readonly WaitNote[]): string {
  const block = resultsBlock(core.deps.runs, [{ group, splits, shown }], undefined, (split) => digestOf(core, split));
  const working = splits.some((split) => !SPLIT_TERMINAL.includes(split.status)); // also a part one of them added (join)
  return [block, ...notesText(notes), ...(working ? [STILL_WORKING] : [])].join('\n');
}

/** What a part did, as its subconscious kept it (digest.ts); '' when nothing can be read. */
function digestOf(core: SplitCore, split: Split): string {
  const services = core.services();
  if (!services?.ledger) return '';
  try { return partDigest(services.ledger, services.runs, split); } catch (error) {
    core.deps.log.debug('a part\'s digest unavailable', { splitId: split.id, error: String(error) });
    return '';
  }
}

/**
 * The origin's turn `runId` that showed those parts ended 'done': they are gathered; a settled group whose parts all
 * reached it is 'gathered'. Returns the ids of the groups it touched.
 */
export function markGathered(core: SplitCore, runId: string, splitIds: readonly string[]): string[] {
  const now = core.now();
  const touched = new Set<string>();
  for (const id of new Set(splitIds)) {
    const split = core.repo.getSplit(id);
    if (!split || !waiting(split)) continue;
    core.repo.updateSplit(id, { gatheredAt: now });
    touched.add(split.groupId);
  }
  if (!touched.size) return [];
  core.deps.log.info('split results gathered', { runId, parts: splitIds.length });
  const done: string[] = [];
  for (const id of touched) {
    const group = core.repo.getGroup(id);
    const splits = core.repo.listSplits({ groupId: id });
    if (!group || splits.some(waiting)) continue; // another part ended meanwhile: its wake brings it
    // What ended reached the origin already: its fan-in wake (when not claimed yet) would bring nothing new.
    try { core.deps.wakes.cancelKey?.(group.agentId, coalesceKey(id)); } catch { /* the wake runs and finds no results */ }
    if (group.status !== 'settled') continue;
    core.repo.updateGroup(id, { status: 'gathered', gatheredAt: now });
    done.push(id);
  }
  if (done.length) core.release(core.repo.listSplits({ groupIds: done }));
  return [...touched];
}

/**
 * agents.split_results: a group's (or its part's) full results – B-080: any group of mine, from whichever thread I split it
 * in (chat.read shows me those chats anyway); without groupId this thread's newest group, else my newest. Another agent's
 * group stays its own. The fan-in (pendingResults, the wake) stays on the group's own thread. `ended`: the parts shown that
 * ended and had not reached me yet (FIXES-3 A3: read is read – gathered when the reading turn ends 'done').
 */
export function results(core: SplitCore, agentId: string, q: { groupId?: string; idx?: number; thread?: string }): { text: string; ended: string[] } {
  let group: SplitGroup | undefined;
  if (q.groupId) {
    group = core.repo.getGroup(q.groupId);
    if (!group) throw new WorkforceError('not_found', `I have no split group ${q.groupId}.`);
    if (group.agentId !== agentId) throw new WorkforceError('forbidden', `Split group ${q.groupId} belongs to another agent.`);
  } else {
    group = (q.thread !== undefined ? core.repo.listGroups({ agentId, thread: q.thread, limit: 1 })[0] : undefined)
      ?? core.repo.listGroups({ agentId, limit: 1 })[0];
  }
  if (!group) return { text: 'I have no split results yet.', ended: [] };
  const splits = core.repo.listSplits({ groupId: group.id }).sort((a, b) => a.idx - b.idx);
  if (q.idx !== undefined && !splits.some((split) => split.idx === q.idx)) throw new WorkforceError('not_found', `Split group ${group.id} has no part #${q.idx}.`);
  const shown = splits.filter((split) => (q.idx === undefined || split.idx === q.idx) && waiting(split));
  return { text: fullResults(core.deps.runs, group, splits, q.idx), ended: group.status === 'running' || group.status === 'settled' ? shown.map((split) => split.id) : [] };
}
