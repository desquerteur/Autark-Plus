// Bridge of the 13.11.2026 context rebuild: the one-time conversions of data from before it, run once at runtime start
// (runtime/main.ts), each part idempotent. This file is deleted in the version after the bridge.
// Tasks: rows in the old shape (statuses working / needs_you / blocked / cancelled, waitingOn {kind, id, reason}, ledger
// tried / nextCheckAt / escalation / cancelledBy / lastProgressAt) become the four states with their wait
// (shared/model/tasks.ts); a row an older PC still sends is read the same way (tasks/repo.ts toTask) and rewritten at
// the watcher's next pass (tasks/watch.ts); the old follow-up wakes go once – the watcher plans each task's look anew.
// Old own steps (same-owner child rows) are the parent's plan now: an unfinished one is dropped (foldOwnSteps), so it
// is not woken as work of its own.
// SYSTEM.md (14.11.2026: the file is the agent's whole standing text, org/standard.ts): a copied old standard above
// "## My role" goes where it equals a shipped standard or the one recorded at the agent's hire or last renewal (whitespace
// aside); an edited head stays as the agent's own "# How I work" (without the shipped preface line); a file without one
// gets today's "# How I work" on top – the person's own team version (<data>/prompts/rules.md, then how-i-work.md) or the
// standard's of the agent's kind – and one wake to make it its own. "## Your role" becomes "## My role" and an old shipped
// role text today's (org/role-upgrade.ts). Agents at home on another CEO PC are converted there and reach this PC by sync.
// Tool names: the tools an agent learned to hold directly (tools/learned.ts) under a name the rebuild merged take the
// tool that does it now (RENAMED_TOOLS), and so does every such name in a SYSTEM.md (a tool's name is a fact, not the
// agent's voice); nothing else stores a tool's name or an argument spelling.
// HUMAN.md (owner 15.11.2026, agent-core/human.ts; 16.11.2026: the "I'm not a robot" line is set once for every agent,
// settings profile.forEveryAgent): once per PC, a HUMAN.md of an agent at home here whose whole text is that default
// line (German or English) is emptied, so the line stands once, for every agent; a HUMAN.md with anything else stays.
// Owns: those conversions. Never: deletes a task row or drops a column (older PCs keep reading the rows), or changes a
// SYSTEM.md below its role heading beyond the heading, an exact old shipped role text and merged tool names.

import path from 'node:path';
import type { RuntimeServices } from '../contracts.ts';
import type { Task, TaskLedger, TaskStatus, TaskWait } from '../../shared/model/tasks.ts';
import { PAUSED_REASON } from '../../shared/model/tasks.ts';
import { HUMAN_ID } from '../../shared/ids.ts';
import { KvRepo } from '../store/kv.ts';
import { cleanTemplate, OVERRIDE_MAX_BYTES, renderTemplate } from '../context/templates.ts';
import { readText } from '../root/text-doc.ts';
import { ROOT_PROMPTS } from '../root/layout.ts';
import { homeElsewhere } from '../devices/sync/home.ts';
import { ownHowIWork, roleLineIndex } from '../org/system-parts.ts';
import { standardKind, standardName } from '../org/standard.ts';
import { splitAtHave, systemMdValues } from '../org/hire.ts';
import { standardHead } from '../org/standard-upgrade.ts';
import { loadPreviousBodies, modernRoleSuffix, type RoleUpgradeFacts } from '../org/role-upgrade.ts';
import { LEARNED_NS } from '../tools/learned.ts';
import { isCoreFolderName } from '../agent-core/layout.ts';
import { readHuman, writeHuman } from '../agent-core/human.ts';
import { humanDefault } from '../../shared/model/agent-core.ts';

const KV = 'bridge.kontext-1311';

/** A wait as an older build stored it. */
interface OldWait { kind?: string; id?: string; ids?: string[]; reason?: string; since?: number; until?: number }
type OldLedger = TaskLedger & { lastProgressAt?: number; tried?: unknown; nextCheckAt?: unknown; escalation?: unknown; cancelledBy?: unknown };

/** An older wait in the new shape (a new one stays as it is). */
function waitOf(wait: (TaskWait & OldWait) | undefined, since: number): TaskWait | undefined {
  if (!wait) return undefined;
  if (wait.on) return wait;
  const base = { why: wait.reason || 'Waiting', since: wait.since ?? since, ...(wait.until !== undefined ? { until: wait.until } : {}) };
  if (wait.kind === 'human') return { on: 'who', who: wait.id || 'human', ...base };
  if (wait.kind === 'agent') return { on: 'who', ...(wait.id ? { who: wait.id } : {}), ...base };
  if (wait.kind === 'task') return { on: 'task', ids: [...new Set([...(wait.ids ?? []), ...(wait.id ? [wait.id] : [])])], ...base };
  return { on: 'outside', ...base };
}

/** The ledger without what the rebuild dropped; lastProgressAt becomes movedAt. */
function ledgerOf(ledger: OldLedger | undefined): TaskLedger {
  const { tried: _t, nextCheckAt: _n, escalation: _e, cancelledBy: _c, lastProgressAt, ...rest } = ledger ?? {};
  return lastProgressAt !== undefined && rest.movedAt === undefined ? { ...rest, movedAt: lastProgressAt } : rest;
}

/** True when the task still has a piece of the old shape. */
export function oldShape(task: Pick<Task, 'status' | 'waitingOn' | 'ledger'>): boolean {
  const status = task.status as string;
  if (status === 'working' || status === 'needs_you' || status === 'blocked' || status === 'cancelled') return true;
  if (task.waitingOn && !(task.waitingOn as TaskWait).on) return true;
  if (status === 'open' && task.waitingOn) return true;
  const ledger = task.ledger as OldLedger | undefined;
  return Boolean(ledger && ['tried', 'nextCheckAt', 'escalation', 'cancelledBy', 'lastProgressAt'].some((key) => key in ledger));
}

/** The task in the four states (tasks/repo.ts toTask runs every row through it; a new row comes back as it is). */
export function simpleTask(task: Task): Task {
  if (!oldShape(task)) return task;
  const status = task.status as string;
  const wait = waitOf(task.waitingOn as (TaskWait & OldWait) | undefined, task.updatedAt);
  const out: Task = { ...task, ledger: ledgerOf(task.ledger as OldLedger) };
  delete out.waitingOn;
  let next: TaskStatus = status === 'done' ? 'done' : status === 'cancelled' ? 'dropped' : 'open';
  if (status === 'open' && wait?.why === PAUSED_REASON) { next = 'waiting'; out.waitingOn = { ...wait, on: 'who', who: wait.who ?? 'human' }; }
  else if (status === 'waiting' || status === 'blocked' || (status === 'needs_you' && task.assigneeKind !== 'human')) {
    next = 'waiting';
    out.waitingOn = wait ?? { on: status === 'needs_you' ? 'who' : 'outside', ...(status === 'needs_you' ? { who: 'human' } : {}), why: status === 'needs_you' ? 'Needs you' : 'Waiting', since: task.updatedAt };
    if (status === 'needs_you' && out.waitingOn.on !== 'who') out.waitingOn = { ...out.waitingOn, on: 'who', who: 'human' };
  }
  out.status = next;
  return out;
}

/** Rewrites every stored row still in the old shape (status, waiting_on, ledger); returns how many. */
export function convertTaskRows(db: RuntimeServices['db']): number {
  const rows = db.all<{ id: string; status: string; waiting_on: string | null; ledger: string; assignee_kind: string; updated_at: number }>(
    `SELECT id, status, waiting_on, ledger, assignee_kind, updated_at FROM tasks
      WHERE status IN ('working', 'needs_you', 'blocked', 'cancelled')
         OR (waiting_on IS NOT NULL AND (status = 'open' OR json_extract(waiting_on, '$.kind') IS NOT NULL))
         OR json_extract(ledger, '$.tried') IS NOT NULL OR json_extract(ledger, '$.nextCheckAt') IS NOT NULL
         OR json_extract(ledger, '$.lastProgressAt') IS NOT NULL OR json_extract(ledger, '$.cancelledBy') IS NOT NULL
         OR json_extract(ledger, '$.escalation') IS NOT NULL`,
  );
  // the look the old system planned (ledger.nextCheckAt) stays the task's next look
  db.run(`UPDATE tasks SET next_at = CAST(json_extract(ledger, '$.nextCheckAt') AS INTEGER)
    WHERE next_at IS NULL AND status NOT IN ('done', 'cancelled', 'dropped') AND json_extract(ledger, '$.nextCheckAt') IS NOT NULL`);
  for (const row of rows) {
    const parse = <T>(text: string | null): T | undefined => { try { return text ? JSON.parse(text) as T : undefined; } catch { return undefined; } };
    const task = simpleTask({
      status: row.status, waitingOn: parse(row.waiting_on), ledger: parse(row.ledger) ?? {}, assigneeKind: row.assignee_kind, updatedAt: Number(row.updated_at),
    } as unknown as Task);
    db.run('UPDATE tasks SET status = ?, waiting_on = ?, ledger = ? WHERE id = ?',
      [task.status, task.waitingOn ? JSON.stringify(task.waitingOn) : null, JSON.stringify(task.ledger ?? {}), row.id]);
  }
  return rows.length;
}

/**
 * The old own steps (child rows of the same agent owner, no widget, no dependsOn, no children): the parent's plan holds
 * that work – it becomes the steps ("✓ " before a done one) when the parent has no plan yet – and each unfinished step
 * row is dropped, so no turn runs on it by itself. The rows stay (older PCs keep reading them). Returns how many dropped.
 */
export function foldOwnSteps(db: RuntimeServices['db'], now: number): number {
  const steps = db.all<{ id: string; parent_id: string; title: string; status: string; ledger: string }>(
    `SELECT c.id, c.parent_id, c.title, c.status, p.ledger FROM tasks c JOIN tasks p ON p.id = c.parent_id
      WHERE c.assignee_kind = 'agent' AND p.assignee_kind = 'agent' AND c.assignee_id = p.assignee_id
        AND c.widget IS NULL AND c.depends_on IN ('', '[]') AND NOT EXISTS (SELECT 1 FROM tasks g WHERE g.parent_id = c.id)
      ORDER BY c.parent_id, c.sort, c.created_at`);
  const unfinished = (status: string) => status === 'open' || status === 'waiting';
  const byParent = new Map<string, typeof steps>();
  for (const step of steps) byParent.set(step.parent_id, [...(byParent.get(step.parent_id) ?? []), step]);
  let dropped = 0;
  for (const [parentId, own] of byParent) {
    const open = own.filter((step) => unfinished(step.status));
    if (!open.length) continue;
    let ledger: TaskLedger = {};
    try { ledger = JSON.parse(own[0].ledger || '{}') as TaskLedger; } catch { /* an unreadable ledger starts empty */ }
    if (!ledger.plan?.length) {
      const plan = own.filter((step) => step.status === 'done' || unfinished(step.status)).map((step) => `${step.status === 'done' ? '✓ ' : ''}${step.title}`);
      db.run('UPDATE tasks SET ledger = ? WHERE id = ?', [JSON.stringify({ ...ledger, plan }), parentId]);
    }
    for (const step of open) {
      db.run(`UPDATE tasks SET status = 'dropped', next_at = NULL, completed_at = ? WHERE id = ?`, [now, step.id]);
      db.run('DELETE FROM wakes WHERE claimed_at IS NULL AND task_id = ?', [step.id]);
    }
    dropped += open.length;
  }
  return dropped;
}

/** The task part, once per PC: rows converted, the old own steps folded, the old follow-up wakes gone (their looks are planned anew). */
function tasksPart(s: Pick<RuntimeServices, 'db' | 'clock'>): number {
  const converted = convertTaskRows(s.db);
  const kv = new KvRepo(s.db);
  if (!kv.get<boolean>(KV, 'own-steps')) {
    foldOwnSteps(s.db, s.clock.now());
    kv.set(KV, 'own-steps', true, s.clock.now());
  }
  if (kv.get<boolean>(KV, 'tasks')) return converted;
  // a queued retry/review keeps its time as the task's next look
  s.db.run(`UPDATE tasks SET next_at = (SELECT MIN(w.due_at) FROM wakes w WHERE w.task_id = tasks.id AND w.claimed_at IS NULL AND w.reason IN ('retry', 'review'))
    WHERE next_at IS NULL AND status NOT IN ('done', 'cancelled', 'dropped')
      AND EXISTS (SELECT 1 FROM wakes w WHERE w.task_id = tasks.id AND w.claimed_at IS NULL AND w.reason IN ('retry', 'review'))`);
  s.db.run(`DELETE FROM wakes WHERE claimed_at IS NULL AND task_id IS NOT NULL AND reason IN ('retry', 'review')`);
  kv.set(KV, 'tasks', true, s.clock.now());
  return converted;
}

/** What the earlier SYSTEM.md updater recorded per agent (kv agent-prompt-defaults): the standard and the text then. */
interface SavedDefault { template?: string; baseline?: string }
const SAVED_DEFAULTS = 'agent-prompt-defaults';
/** The earlier updater's record of the shipped global prompts (kv prompt-defaults, context/prompt-updates.ts). */
const PROMPT_DEFAULTS = 'prompt-defaults';

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** True when `head` (above the role heading of `text`) is a shipped standard or the one recorded for this agent. */
function standardAbove(text: string, head: string, saved: SavedDefault | undefined): boolean {
  if (standardHead(text, saved?.template ? [saved.template] : [])) return true;
  const base = saved?.baseline?.replace(/\r\n?/g, '\n').split('\n');
  const at = base ? roleLineIndex(base) : -1;
  return at > 0 && squash(base!.slice(0, at).join('\n')) === squash(head);
}

/** An edited head without the shipped preface ("This is my/your SYSTEM.md …"): from its "# How I work", else its first heading. */
function withoutPreface(head: string): string {
  const lines = head.trim().split('\n');
  if (!/^This is (my|your) SYSTEM\.md/.test(lines[0] ?? '')) return head.trim();
  const how = lines.findIndex((line) => line.trim() === '# How I work');
  const at = how >= 0 ? how : lines.findIndex((line) => line.trim().startsWith('#'));
  return at < 0 ? '' : lines.slice(at).join('\n').trim();
}

/** One SYSTEM.md in the new form: the agent's own part, with an edited head kept on top as its own "# How I work". */
export function ownSystemMd(text: string, saved: SavedDefault | undefined, facts: RoleUpgradeFacts): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const at = roleLineIndex(lines);
  if (at < 0) return text; // no role heading: an own text, read as it is
  const suffix = modernRoleSuffix(lines.slice(at).join('\n'), facts).trim();
  const head = lines.slice(0, at).join('\n');
  if (!head.trim()) return suffix === lines.slice(at).join('\n').trim() ? text : suffix;
  if (standardAbove(text, head, saved)) return suffix;
  const own = withoutPreface(head);
  return own ? `${own}\n\n${suffix}` : suffix;
}

/** The person's own team text (<data>/prompts/how-i-work.md, else the older rules.md), rendered under "# How I work"; '' without one. */
function ownTeamHow(s: Pick<RuntimeServices, 'paths'>, values: Readonly<Record<string, string>>): string {
  for (const name of ['how-i-work', 'rules']) {
    const read = readText(path.join(s.paths.data, ROOT_PROMPTS, `${name}.md`), { maxBytes: OVERRIDE_MAX_BYTES });
    const text = read.kind === 'ok' ? renderTemplate(cleanTemplate(read.text), values).replace(/^# [^\n]*\n*/, '').trim() : '';
    if (text) return `# How I work\n${text}`;
  }
  return '';
}

/** The wake of an agent whose SYSTEM.md got today's "# How I work" on top. */
export const WHOLE_NOTE = 'My SYSTEM.md is my whole standing text now: the team\'s "# How I work" stands in it on top of my role and what I have here, and the team\'s standard is the comment at its end (no comment reaches the model). From here all of it is mine: I read it once, take out what does not fit my work and sharpen what does – where I am sure – and keep my agreements under "What I have here" (skill system-prompt). One line in my 1:1 with my manager or the person says what I changed.';

/** The SYSTEM.md part, once per PC: every agent at home here in the new form; one that got "# How I work" is woken once. */
function systemMdPart(s: RuntimeServices): number {
  const kv = new KvRepo(s.db);
  if (kv.get<boolean>(KV, 'system-md')) return 0;
  kv.delete(PROMPT_DEFAULTS, 'compaction');
  s.prompts?.invalidate();
  const values = systemMdValues(s.settings.get());
  const standard = (mode: string) => renderTemplate(s.prompts?.text(standardName(standardKind(mode))) ?? '', values);
  const have = splitAtHave(standard('general')).tail;
  const facts = { templates: s.org.templates(), previous: loadPreviousBodies(path.join(s.paths.resources, 'agents')), have };
  const team = ownTeamHow(s, values);
  const lived = s.db.get(`SELECT 1 AS hit FROM messages WHERE author_kind = 'human' LIMIT 1`) !== undefined; // a fresh install starts from today's texts
  let changed = 0;
  for (const agent of s.org.list({ includeArchived: true })) {
    if (homeElsewhere(s, agent.id)) continue;
    try {
      let next = ownSystemMd(agent.instructions, kv.get<SavedDefault>(SAVED_DEFAULTS, agent.id), { ...facts, template: agent.template });
      const how = team || ownHowIWork(standard(agent.mode)).how;
      const whole = next.trim() !== '' && !ownHowIWork(next).how && how !== '';
      if (whole) next = `${how}\n\n${next.trim()}`;
      if (next !== agent.instructions) {
        s.org.update(agent.id, { instructions: next }, { by: HUMAN_ID, reason: 'SYSTEM.md is my whole standing text now.' });
        changed++;
      }
      if (whole && lived && agent.archivedAt === undefined) {
        s.wakes.wake({ agentId: agent.id, reason: 'review', coalesceKey: `standard:${agent.id}`, origin: { source: 'standard', label: 'SYSTEM.md is all mine' }, note: WHOLE_NOTE });
      }
      kv.delete(SAVED_DEFAULTS, agent.id);
    } catch (error) {
      s.log.warn('SYSTEM.md not converted', { agentId: agent.id, error: String((error as Error)?.message ?? error) });
    }
  }
  kv.set(KV, 'system-md', true, s.clock.now());
  return changed;
}

/** Tool names the rebuild merged → the tool that does that work now. */
export const RENAMED_TOOLS: Readonly<Record<string, string>> = {
  'skills.find': 'knowledge.find', 'knowledge.recall': 'knowledge.find', 'references.find': 'knowledge.find',
  'skills.load': 'knowledge.open', 'library.read': 'knowledge.open',
  'knowledge.remember': 'memory.write', 'knowledge.correct': 'memory.write', 'references.capture': 'memory.write',
  'secrets.run': 'shell.exec', 'agents.split_stop': 'agents.split_tell', 'chat.notes.append': 'chat.notes.write',
};

/** The learned tools under today's names (each once, order kept); returns how many agents changed. */
export function renameLearned(s: Pick<RuntimeServices, 'db' | 'clock'>): number {
  const kv = new KvRepo(s.db);
  const now = (names: unknown) => (Array.isArray(names) ? [...new Set(names.map((name) => (typeof name === 'string' ? RENAMED_TOOLS[name] ?? name : name)))] : names);
  let changed = 0;
  for (const { key, value } of kv.list<{ core?: unknown; used?: unknown }>(LEARNED_NS)) {
    const next = { ...value, core: now(value?.core), used: now(value?.used) };
    if (JSON.stringify(next) === JSON.stringify(value)) continue;
    kv.set(LEARNED_NS, key, next, s.clock.now());
    changed++;
  }
  return changed;
}

const MERGED_NAME = new RegExp(`(?<![\\w.])(${Object.keys(RENAMED_TOOLS).map((name) => name.replace(/\./g, '\\.')).join('|')})(?!\\w)`, 'g');

/** A text with every merged tool name as the tool that does it now (a tool's name is a fact, not the agent's voice). */
export function withToolNames(text: string): string {
  return text.replace(MERGED_NAME, (name) => RENAMED_TOOLS[name] ?? name);
}

/** Each SYSTEM.md of an agent at home here under today's tool names; returns how many changed. */
export function renameInSystemMd(s: Pick<RuntimeServices, 'org' | 'db'>): number {
  let changed = 0;
  for (const agent of s.org.list({ includeArchived: true })) {
    if (homeElsewhere(s, agent.id)) continue;
    const next = withToolNames(agent.instructions);
    if (next === agent.instructions) continue;
    s.org.update(agent.id, { instructions: next }, { by: HUMAN_ID, reason: 'Tool names of the 13.11. rebuild: the tool that does it now.' });
    changed++;
  }
  return changed;
}

/** The HUMAN.md part, once per PC: a HUMAN.md of an agent at home here that holds only the default line goes empty; returns how many. */
export function humanMdPart(s: Pick<RuntimeServices, 'db' | 'org' | 'paths' | 'clock'>): number {
  const kv = new KvRepo(s.db);
  if (kv.get<boolean>(KV, 'human-md-every-agent')) return 0;
  const lines = new Set([humanDefault('de'), humanDefault('en')]);
  let emptied = 0;
  for (const agent of s.org.list({ includeArchived: true })) {
    if (!isCoreFolderName(agent.id) || homeElsewhere(s, agent.id) || !lines.has(readHuman(s.paths.data, agent.id))) continue;
    writeHuman(s.paths.data, agent.id, '');
    emptied++;
  }
  kv.set(KV, 'human-md-every-agent', true, s.clock.now());
  return emptied;
}

/** Runs every part of the bridge; a part that fails is logged and tried again at the next start. */
export function runKontext1311(s: RuntimeServices): void {
  const parts: Array<[string, () => unknown]> = [
    ['tasks', () => tasksPart(s)],
    ['system-md', () => systemMdPart(s)],
    ['tool-names', () => renameLearned(s) + renameInSystemMd(s)],
    ['human-md', () => humanMdPart(s)],
  ];
  for (const [name, part] of parts) {
    try {
      const result = part();
      if (result) s.log.info('kontext-1311 bridge', { part: name, result: typeof result === 'number' ? result : true });
    } catch (error) {
      s.log.warn('kontext-1311 bridge failed', { part: name, error: String((error as Error)?.message ?? error) });
    }
  }
}
