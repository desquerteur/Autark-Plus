// vector.embed and vector.search as tools: found through tools.find (no core tool), offered in every mode – and only while a
// chosen embedding model can serve (14.11.2026: without one they could only answer that none is there) –, short specs,
// plain result texts; models-uses knows the use.
// Owns: these assertions only. Never: real models.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { setup } from './helpers.ts';
import { BASE_CORE } from '../../../src/runtime/tools/core-sets.ts';
import { builtinTools, registerBuiltinTools } from '../../../src/runtime/tools/builtin/index.ts';
import { moreToolsSection } from '../../../src/runtime/tools/builtin/tools-meta.ts';
import { Registry } from '../../../src/runtime/tools/registry.ts';
import { ModeLibrary } from '../../../src/runtime/modes/service.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { ToolContext, ToolOutput } from '../../../src/runtime/tools/types.ts';
import type { VectorService } from '../../../src/runtime/contracts/vectors.ts';
import { chosenFor, OFFABLE_USES, servesUse, useValue } from '../../../src/shared/model/models-uses.ts';

const tools = builtinTools();
const find = (name: string) => {
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `${name} is registered`);
  return tool;
};
const textOf = (output: ToolOutput) => output.content.map((part) => ('text' in part ? part.text : '')).join('');

function ctx(vectors: Partial<VectorService>): ToolContext {
  return { services: { vectors, paths: { data: 'C:/data', workspace: process.cwd() } } } as unknown as ToolContext;
}

test('both tools are on demand, in every mode, with a short spec, and need a chosen embedding model', () => {
  for (const name of ['vector.embed', 'vector.search']) {
    const tool = find(name);
    assert.ok(!(name in BASE_CORE));
    assert.equal(tool.modes, undefined);
    assert.equal(tool.requires, 'embeddings');
    const size = tool.description.length + JSON.stringify(tool.inputSchema).length;
    assert.ok(size < 700, `${name} spec is ${size} characters`);
  }
});

test('without a chosen embedding model neither is offered, listed under More tools or run; with one both are', async () => {
  const h = setup();
  const services = h.services as RuntimeServices;
  services.modes = new ModeLibrary({ resources: path.resolve('resources'), clock: h.clock }) as unknown as RuntimeServices['modes'];
  let chosen = false;
  let searched = 0;
  services.vectors = { available: () => chosen, search: async (input: { in: string[] }) => { searched++; return { hits: [], searched: { places: input.in, embeddedFiles: 0 } }; } } as unknown as RuntimeServices['vectors'];
  const registry = new Registry({ services: () => services });
  services.tools = registry;
  registerBuiltinTools(registry);
  const mode = services.modes.get('general');
  const offered = () => registry.specsFor(h.tom, mode).map((spec) => spec.name);
  const more = () => moreToolsSection(registry.specsFor(h.tom, mode), new Set(['tools.call']));
  const base: Omit<ToolContext, 'services'> = { agent: h.tom, runId: 'run_1', mode: 'general', signal: new AbortController().signal, status: () => {} };

  assert.ok(!offered().some((name) => name.startsWith('vector.')), 'a tool that cannot work is not offered');
  assert.doesNotMatch(more(), /vector\./, 'nor named under More tools');
  assert.match(more(), /knowledge\.find|memory\.browse/, 'the rest of the list stays');
  const refused = await registry.call('vector.search', { query: 'invoice', in: ['memory'] }, base, 'c1');
  assert.equal(refused.isError, true);
  // KI-Runde 17.11.2026: the refusal says why, so a model that knows nothing else can act on it.
  assert.match(textOf(refused), /^vector\.search needs an embedding model, and none that can serve is chosen in Settings\./);
  assert.equal(searched, 0, 'a call by an old name runs nothing');

  chosen = true;
  assert.ok(offered().includes('vector.search') && offered().includes('vector.embed'));
  assert.match(more(), /vector\.embed – .* · vector\.search – /);
  const ran = await registry.call('vector.search', { query: 'invoice', in: ['memory'] }, base, 'c2');
  assert.equal(ran.isError, undefined, textOf(ran));
  assert.equal(searched, 1, 'the same call runs once the model is chosen');
});

test('vector.search passes memory places through, resolves files and prints hits and the note', async () => {
  let given: { query: string; in: string[]; k?: number } | undefined;
  const output = await find('vector.search').run({ query: ' invoice ', in: ['memory/company', 'C:/work/notes'], limit: 3 }, ctx({
    search: async (input) => {
      given = input;
      return { hits: [{ path: 'memory/company/a.md', chunk: 0, lines: [2, 9], snippet: 'the  invoice', score: 0.612 }], searched: { places: input.in, embeddedFiles: 4 }, note: 'Nothing embedded under C:/work/notes – embed it first with vector.embed.' };
    },
  }));
  assert.equal(given?.query, 'invoice');
  assert.equal(given?.in[0], 'memory/company');
  assert.equal(given?.k, 3);
  const body = textOf(output);
  assert.match(body, /Nothing embedded under/);
  assert.match(body, /^1 hits\.$/m);
  assert.doesNotMatch(body, /embedded files/, 'no count of what is embedded in any context');
  assert.match(body, /0\.61 memory\/company\/a\.md:2-9\n {2}the invoice/);
  assert.match(body, /memory\/ is /);
});

test('vector.embed reports counts, what was left out and when to call again', async () => {
  const output = await find('vector.embed').run({ paths: ['memory'] }, ctx({
    available: () => true,
    embed: async (paths) => {
      assert.deepEqual(paths, ['memory']);
      return { embedded: 2, reembedded: 1, unchanged: 3, skipped: [{ path: 'x/node_modules', reason: 'dependencies, caches or app data' }], remaining: 5 };
    },
  }));
  const body = textOf(output);
  assert.match(body, /Embedded 2, re-embedded 1, already embedded 3/);
  assert.match(body, /x\/node_modules: dependencies/);
  assert.match(body, /5 files not finished: call vector\.embed again/);
});

test('the use: auto by default, can be off, knows embedding models by name', () => {
  assert.equal(useValue({}, 'embeddings'), 'auto');
  assert.equal(useValue({ embeddings: 'off' }, 'embeddings'), 'off');
  assert.equal(chosenFor({ embeddings: 'ollama:bge-m3' }, 'embeddings'), 'ollama:bge-m3');
  assert.ok(OFFABLE_USES.has('embeddings'));
  const model = (name: string) => ({ model: name, functions: [], strengths: {} });
  assert.ok(servesUse(model('nomic-embed-text'), 'embeddings'));
  assert.ok(servesUse(model('bge-m3:latest'), 'embeddings'));
  assert.ok(servesUse(model('BAAI/bge-m3'), 'embeddings'));
  assert.ok(!servesUse(model('jina-reranker-embed'), 'embeddings'));
  assert.ok(!servesUse(model('gpt-6'), 'embeddings'));
});
