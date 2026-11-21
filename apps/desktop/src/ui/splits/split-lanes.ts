// A split group as lanes over time (the activity log's split block, SplitLanes.tsx): the time from the first part's
// start is cut at every part's start and end; each piece is one row with a column per part running in it. When a part
// ends, the rows below have one column less – it went back to the main agent – until the last part ends and the log
// goes on in the main line. Parts that start within START_SNAP_MS of a cut join that row (parts start a few ms apart),
// so a row is cut where a part comes back or a later part starts. A part's journaled items go into the row of their time (before its start: its first row;
// after its end: its last). Parts that have not started are listed as waiting.
// Owns: these rules (unit-tested in test/unit/splits/split-lanes.test.ts). Never: imports the store, rpc or the DOM.

/** Starts this close to the row before begin in that row. */
export const START_SNAP_MS = 2000;

export interface LanePart { id: string; idx: number; startedAt?: number; endedAt?: number }

export interface Lane<T> {
  partId: string;
  items: T[];
  /** The part's first row (its full header). */
  first: boolean;
  /** The part ends with this row (its end line). */
  ends: boolean;
}

export interface LaneRow<T> { from: number; to?: number; lanes: Lane<T>[] }

/** The rows of a group's parts (idx order inside a row) and the parts still waiting to start. */
export function laneRows<T extends { createdAt: number }>(parts: readonly LanePart[], itemsOf: (partId: string) => readonly T[]): { rows: LaneRow<T>[]; waiting: LanePart[] } {
  const started = parts.filter((part) => part.startedAt !== undefined).sort((a, b) => a.idx - b.idx);
  const waiting = parts.filter((part) => part.startedAt === undefined).sort((a, b) => a.idx - b.idx);
  const ends = new Set(started.flatMap((part) => (part.endedAt === undefined ? [] : [part.endedAt])));
  const cuts: number[] = [];
  for (const at of [...new Set([...started.map((part) => part.startedAt!), ...ends])].sort((a, b) => a - b)) {
    const last = cuts[cuts.length - 1];
    if (last === undefined || ends.has(at) || at - last > START_SNAP_MS) cuts.push(at);
  }
  const rows: LaneRow<T>[] = [];
  cuts.forEach((from, index) => {
    const to = cuts[index + 1];
    const active = started.filter((part) => part.startedAt! <= from + START_SNAP_MS && (part.endedAt === undefined || part.endedAt > from)
      && (to === undefined || part.startedAt! < to));
    if (!active.length) return;
    rows.push({ from, ...(to === undefined ? {} : { to }), lanes: active.map((part) => ({ partId: part.id, items: [], first: false, ends: part.endedAt !== undefined && part.endedAt === to })) });
  });
  for (const part of started) {
    const own = rows.map((row) => ({ row, lane: row.lanes.find((lane) => lane.partId === part.id) })).filter((entry) => entry.lane !== undefined);
    if (!own.length) continue;
    own[0].lane!.first = true;
    for (const item of itemsOf(part.id)) {
      const at = own.filter((entry) => entry.row.from <= item.createdAt).pop() ?? own[0];
      at.lane!.items.push(item);
    }
  }
  return { rows, waiting };
}
