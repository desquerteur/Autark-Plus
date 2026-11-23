// Owner's rule (f) for the main AI's memory search: knowledge.find searches the whole memory tree unless the caller names
// folders (`in`: "memory/…"; code names no part of memory). Rule (e) – "without an embedder it says it matched words" – ended
// with the word index (lane find 14.11.2026): every find matches by words now, so its output carries no such note.
// Owns: these assertions only. Never: real models, network or timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent } from '../chat/harness.ts';
import { fixture } from '../context/fixture.ts';
import { findTools } from '../../../src/runtime/tools/builtin/find.ts';
import type { ToolContext, ToolOutput } from '../../../src/runtime/tools/types.ts';
import type { Agent } from '../../../src/shared/model/org.ts';

const tool = (name: string) => findTools.find((item) => item.name === name)!;
const textOf = (out: ToolOutput) => (out.content[0] as { text: string }).text;

function world() {
  const f = fixture();
  const vera = f.org.add(agent('ag_vera', 'Vera', { role: 'Video editor' }));
  const wes = f.org.add(agent('ag_wes', 'Wes', { role: 'Web developer' }));
  const ctxOf = (who: Agent): ToolContext => ({ agent: who, runId: 'run_mem', mode: 'general', services: f.services, signal: new AbortController().signal, status: () => {} });
  return { ...f, vera, wes, ctxOf };
}

test('knowledge.find searches the whole tree, or the memory folders the caller names – no folder chosen by code', async () => {
  const f = world();
  f.knowledge.memoryWrite({ folder: 'agents/ag_vera', title: 'Schnittliste Brenner', text: 'Die Schnittliste für die Kanzlei Brenner liegt beim Projekt.' });
  f.knowledge.memoryWrite({ folder: 'company/kunden', title: 'Versandregel Kanzlei Brenner', text: 'Die Kanzlei Brenner nimmt Unterlagen nur per Einschreiben an.' });
  const all = textOf(await tool('knowledge.find').run({ query: 'Kanzlei Brenner', kinds: ['note'] }, f.ctxOf(f.wes)));
  assert.match(all, /Schnittliste Brenner/, 'another agent\'s folder is part of the tree');
  assert.match(all, /Versandregel Kanzlei Brenner/);
  const named = textOf(await tool('knowledge.find').run({ query: 'Kanzlei Brenner', in: ['memory/company/kunden'] }, f.ctxOf(f.wes)));
  assert.match(named, /Versandregel Kanzlei Brenner/);
  assert.doesNotMatch(named, /Schnittliste/, 'the folder the caller named, no other');
});

test('without an embedder knowledge.find matches the words – an inflection and a compound too – and says nothing about an embedder', async () => {
  const f = world();
  Object.assign(f.services, { vectors: { available: () => false } });
  f.knowledge.memoryWrite({ folder: 'company/kunden', title: 'Zahlungsregel Hartwig Gießerei', text: 'Die Hartwig Gießerei bekommt Angebote nur gegen Vorkasse.' });
  const none = textOf(await tool('knowledge.find').run({ query: 'Segelboot Winterlager', kinds: ['note'] }, f.ctxOf(f.wes)));
  assert.match(none, /^Nothing fits\./);
  const found = textOf(await tool('knowledge.find').run({ query: 'Angebotspreis für die Gießereien von Hartwig', kinds: ['note'] }, f.ctxOf(f.wes)));
  assert.match(found, /^- \[note:company:kunden:[^\]]+\] memory note "Zahlungsregel Hartwig Gießerei"/m);
  assert.doesNotMatch(found, /embedder/);
});
