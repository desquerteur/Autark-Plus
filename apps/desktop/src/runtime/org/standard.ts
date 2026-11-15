// The standard SYSTEM.md (owner 14.11.2026, .local/offen-einfach-20261114/OWNER-2026-11-14.md: "als Kommentar in dieser
// Datei … der Standard-Systemprompt … einmal das für den Project Manager und einmal das für den Unteragent … Kommt dann
// einfach nur ein Prompt rein: Hey, hier ist gerade ein Update gemacht worden"). An agent's SYSTEM.md is its whole own
// standing text; one HTML comment at its end holds the standard of its kind – resources/prompts/standard-manager.md for
// mode manager, standard-agent.md for everyone else (or the person's own version in <data>/prompts) – rendered for this
// team. The app keeps that comment current and nothing else of the file; comments never reach a model (prompt-stable.ts).
// When the comment held another kind or an older standard, the agent gets one wake to look at the new one; a comment
// that is missing (a hire, an edit that dropped it) or only renders other names comes back quietly. Only the agent's
// home PC writes it, so two PCs on different versions never take turns.
// Owns: the comment's form, which standard an agent has, keeping it current and that wake. Never: changes the agent's
// own text above the comment.

import { createHash } from 'node:crypto';
import type { RuntimeServices } from '../contracts.ts';
import type { Agent } from '../../shared/model/org.ts';
import { HUMAN_ID } from '../../shared/ids.ts';
import { renderTemplate } from '../context/templates.ts';
import { homeElsewhere } from '../devices/sync/home.ts';
import { systemMdValues } from './hire.ts';

export type StandardKind = 'manager' | 'agent';
export interface Standard { kind: StandardKind; rev: string; text: string }
type Deps = Pick<RuntimeServices, 'db' | 'org' | 'wakes' | 'settings' | 'log'> & Partial<Pick<RuntimeServices, 'prompts' | 'agentCore'>>;

export const standardKind = (mode: string | undefined): StandardKind => (mode === 'manager' ? 'manager' : 'agent');
export const standardName = (kind: StandardKind) => `standard-${kind}` as const;

const MARK = '<!-- Autark standard:';
/** Every standard comment, wherever it stands (an agent may have copied one into its text). */
const BLOCKS = /\n*<!-- Autark standard: (manager|agent) · ([0-9a-f]{8})\n[\s\S]*?-->[ \t]*/g;
const INTRO = 'The team\'s standard SYSTEM.md for this kind of agent, as the app ships it now. My text above is my own; the app keeps only this comment current, and no comment reaches the model. How I make it my own: skill system-prompt.';

/** The standard of `kind` in force, rendered with `values`; rev names the unrendered text. */
export function standardOf(prompts: Pick<NonNullable<RuntimeServices['prompts']>, 'text'>, kind: StandardKind, values: Readonly<Record<string, string>>): Standard {
  const raw = prompts.text(standardName(kind));
  return { kind, rev: createHash('sha256').update(raw).digest('hex').slice(0, 8), text: renderTemplate(raw, values) };
}

/** `text` without its standard comments, and the kind and rev of the last one. */
export function splitStandard(text: string): { own: string; kind?: StandardKind; rev?: string } {
  let kind: StandardKind | undefined;
  let rev: string | undefined;
  const own = text.replace(BLOCKS, (_all, k: StandardKind, r: string) => { kind = k; rev = r; return ''; }).trimEnd();
  return { own, ...(kind ? { kind, rev } : {}) };
}

/** `own` with `standard` as the comment at its end (a "-->" inside could not end the comment early). */
export function withStandard(own: string, standard: Standard): string {
  const body = standard.text.replaceAll('-->', '-- >');
  return `${splitStandard(own).own}\n\n${MARK} ${standard.kind} · ${standard.rev}\n${INTRO}\n\n${body}\n-->`;
}

/** The one wake after the standard changed, in my voice. */
export function standardNote(kind: StandardKind, before: StandardKind | undefined, folder: string | undefined): string {
  const where = folder ? ` (${folder}\\SYSTEM.md)` : '';
  const lead = before && before !== kind
    ? `My standard SYSTEM.md is now the ${kind} one, because ${kind === 'manager' ? 'I lead an area with people under me' : 'I lead no one now'}.`
    : 'The team\'s standard SYSTEM.md changed with this version of the app.';
  return `${lead} The new standard stands as the comment at the end of my SYSTEM.md${where}; my own text above it is unchanged. I read both and take over what makes my work better – where I am sure it fits me – and leave the rest as it is (skill system-prompt). One line in my 1:1 with my manager or the person says what I took.`;
}

/** Brings the standard comment of `agent` up to date; returns what happened. */
export function syncStandard(s: Deps, agent: Agent): 'same' | 'quiet' | 'woken' {
  if (agent.archivedAt !== undefined || !s.prompts || homeElsewhere(s, agent.id)) return 'same';
  const standard = standardOf(s.prompts, standardKind(agent.mode), systemMdValues(s.settings.get()));
  if (!standard.text) return 'same'; // a broken install: no standard to keep
  const { kind, rev } = splitStandard(agent.instructions);
  const next = withStandard(agent.instructions, standard);
  if (next === agent.instructions) return 'same';
  s.org.update(agent.id, { instructions: next }, { by: HUMAN_ID, reason: 'The standard comment in SYSTEM.md is current again.' });
  if (!kind || (kind === standard.kind && rev === standard.rev)) return 'quiet';
  let folder: string | undefined;
  try { folder = s.agentCore?.folder(agent.id); } catch { folder = undefined; }
  s.wakes.wake({
    agentId: agent.id, reason: 'review', coalesceKey: `standard:${agent.id}`,
    origin: { source: 'standard', label: 'New standard SYSTEM.md' }, note: standardNote(standard.kind, kind, folder),
  });
  return 'woken';
}

/** At runtime start every agent's comment, then each agent as the org announces it (a hire, an edit, a new mode). */
export function startStandards(s: Deps & Pick<RuntimeServices, 'bus'>): () => void {
  const busy = new Set<string>(); // the update below announces the agent again
  const sync = (agent: Agent) => {
    if (busy.has(agent.id)) return;
    busy.add(agent.id);
    try { syncStandard(s, agent); } catch (error) {
      s.log.warn('standard comment not kept', { agentId: agent.id, error: String((error as Error)?.message ?? error) });
    } finally { busy.delete(agent.id); }
  };
  for (const agent of s.org.list()) sync(agent);
  return s.bus.on('agent.upserted', sync);
}
