// The subconscious on the real router (subconscious/service.ts, decision/engine-runner.ts): every step of a run runs on the
// cheap decision model at low effort – the good model is the main AI's own; a Work model chosen in Settings leaves it there.
// Owns: these assertions only. Never: real engines or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { RESOURCES } from '../context/fixture.ts';
import { standardSetup } from '../models/harness.ts';
import { PromptTemplates } from '../../../src/runtime/context/templates.ts';
import { SubconsciousImpl } from '../../../src/runtime/subconscious/service.ts';
import type { RouteDecision } from '../../../src/shared/model/providers.ts';
import type { Router, RuntimeServices } from '../../../src/runtime/contracts.ts';

type Setup = Awaited<ReturnType<typeof standardSetup>>;

/** One asked run of two steps: the model each step was routed to. */
async function routesOf(h: Setup): Promise<RouteDecision[]> {
  const routes: RouteDecision[] = [];
  const router: Router = { route: async (request) => { const route = await h.router.route(request); routes.push(route); return route; } };
  const replies = [{ tool: 'nothing', args: '{}' }, { tool: 'done', args: '{"answer":"Fertig."}' }];
  const engine = { run: async () => ({ text: '', structured: replies.shift(), stop: 'done' as const }) };
  const services = {
    ...h.services, router, engines: { get: () => engine }, paths: { temp: tmpdir() },
    accounts: h.services.accounts, catalog: h.services.catalog, prompts: new PromptTemplates(() => path.join(RESOURCES, 'prompts')),
    secrets: { redact: (text: string) => text }, log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as RuntimeServices;
  const agent = { id: 'ag_x', name: 'X', role: '', mode: 'general', instructions: '', skills: [], avatar: { kind: 'initials', value: 'X' }, status: 'idle', createdBy: 'human', createdAt: 0, updatedAt: 0, modelPolicy: {} };
  const answer = await new SubconsciousImpl({ services: () => services }).ask({ agent: agent as never, ask: 'Denk nach.', context: 'none' });
  assert.ok(answer.startsWith('Fertig.'), answer);
  assert.equal(routes.length, 2);
  return routes;
}

test('every step of the subconscious runs on the cheap decision model at low effort', async () => {
  const h = await standardSetup();
  for (const route of await routesOf(h)) {
    assert.equal(route.modelId, 'codex:gpt-6-luna');
    assert.equal(route.effort, 'low');
  }
});

test('a Work model chosen in Settings is the main AI\'s; the subconscious stays on the decision model', async () => {
  const h = await standardSetup();
  h.settings.update({ routing: { work: 'claude:claude-haiku-5-5' } });
  for (const route of await routesOf(h)) assert.equal(route.modelId, 'codex:gpt-6-luna');
});
