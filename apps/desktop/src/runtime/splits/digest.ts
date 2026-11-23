// What a part did, for its origin (owner 13.11.2026: "dass das Unterbewusstsein sich so ein paar Dinge raussucht … dass es
// wirklich wieder verschmelzen kann"): the part's own context ledger (its thread `split:<id>`, the runs it worked in) as its
// marks left it – a condensed step comes as its condensed text (since v1, 14.11.2026, the rebuild's lean marks, window.ts
// leanText; older ones the subconscious's), any other step as its title, a hidden step stays out. Nothing new is asked of a
// model. Newest steps win when it is long.
// The "Split results" block carries it under the part's last words (gather.ts pendingResults, results.ts DID_LEAD).
// Owns: that choice of lines and their bound. Never: writes the ledger, or reads another agent's.

import type { ContextLedger, RunJournal } from '../contracts.ts';
import type { LedgerKind } from '../../shared/model/context-ledger.ts';
import { splitThread, type Split } from '../../shared/model/splits.ts';
import { runsBySplit } from './views.ts';

/** Characters a part's digest gets at most (its last words come on top). */
export const DIGEST_CHARS = 1_800;
const LINE_CHARS = 240;
/** Its work – the lines it read (its brief, chat lines) its origin knows or finds in the chats. */
const KINDS: LedgerKind[] = ['tool', 'reasoning', 'assistant', 'file', 'skill'];

const oneLine = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > LINE_CHARS ? `${flat.slice(0, LINE_CHARS - 1)}…` : flat;
};

/** The part's digest as lines "- …", newest within DIGEST_CHARS; '' when its ledger holds nothing of its runs. */
export function partDigest(ledger: Pick<ContextLedger, 'items'>, runs: RunJournal, split: Pick<Split, 'id' | 'agentId'>): string {
  const own = new Set((runsBySplit(runs, [split.id]).get(split.id) ?? []).map((run) => run.id));
  const lines = ledger.items(split.agentId, splitThread(split.id), { kinds: KINDS })
    .filter((item) => item.state !== 'hidden' && (!item.runId || own.has(item.runId)))
    .map((item) => oneLine(item.state === 'condensed' && item.condensed ? item.condensed : item.title))
    .filter(Boolean)
    .map((line) => `- ${line}`);
  const kept: string[] = [];
  let size = 0;
  for (const line of lines.reverse()) {
    if (size + line.length + 1 > DIGEST_CHARS) { kept.push(`- … ${lines.length - kept.length} earlier steps (agents.split_results {steps})`); break; }
    kept.push(line);
    size += line.length + 1;
  }
  return kept.reverse().join('\n');
}
