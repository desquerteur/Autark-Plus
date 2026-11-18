// A person's own line (routing/person-turn.ts, 17.11.2026: the model settles): a turn with a new line of a person runs at
// effort ≥ high on the model the turn runs on anyway – it no longer moves the model; turns without one, helper calls and a
// fixed effort keep the usual effort. The strongest tier's first choice (smarts against list price) is where leading runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { account, agent, mode, setup, standardSetup } from '../models/harness.ts';
import { Priors } from '../../../src/runtime/models/priors.ts';
import { SYSTEM_ID } from '../../../src/shared/ids.ts';
import { firstChoice, personAsks, personEffort, personValue, topTier } from '../../../src/runtime/routing/person-turn.ts';
import type { Message } from '../../../src/shared/model/chat.ts';
import type { Effort } from '../../../src/shared/model/providers.ts';
import type { RouteRequest } from '../../../src/runtime/contracts.ts';

const chat = mode('chat');

/** standardSetup plus a chat whose lines the fake chat service returns after a read cursor. */
async function withChat(lines: Array<{ seq: number; authorKind: Message['authorKind']; kind?: Message['kind'] }>, readSeq = 0) {
  const h = await standardSetup();
  h.addChat('ch_1', ['ag_1']);
  const members = (h.services.chats as unknown as { members(id: string): Array<{ memberId: string; readSeq: number }> }).members('ch_1');
  for (const member of members) if (member.memberId === 'ag_1') member.readSeq = readSeq;
  Object.assign(h.services.chats, {
    messages: (_id: string, options: { afterSeq?: number } = {}) => lines
      .filter((line) => line.seq > (options.afterSeq ?? 0))
      .map((line) => ({ seq: line.seq, authorKind: line.authorKind, kind: line.kind ?? 'text', authorId: line.authorKind === 'human' ? 'human' : 'ag_2', body: 'x' })),
  });
  return h;
}

function request(patch: Partial<RouteRequest> = {}): RouteRequest {
  return { agent: agent('ag_1'), mode: chat, conversationId: 'ch_1', ...patch };
}

test("a person's new line: effort high on the model the turn runs on; without one the usual effort", async () => {
  const h = await withChat([{ seq: 1, authorKind: 'human' }]);
  const asked = await h.router.route(request());
  assert.equal(asked.effort, 'high');
  assert.match(asked.reason, /a person's line · effort at least high$/);

  const read = await withChat([{ seq: 1, authorKind: 'human' }, { seq: 2, authorKind: 'agent' }], 1);
  const background = await read.router.route(request());
  assert.equal(background.effort, 'medium', 'nothing new from a person: the usual chat effort');
  assert.doesNotMatch(background.reason, /person/);

  const status = await withChat([{ seq: 1, authorKind: 'human', kind: 'status' }, { seq: 2, authorKind: 'human', kind: 'task' }]);
  assert.doesNotMatch((await status.router.route(request())).reason, /person/, 'a status line or a task card is no request');
  const answer = await withChat([{ seq: 1, authorKind: 'human', kind: 'answer' }]);
  assert.match((await answer.router.route(request())).reason, /a person's line/, 'an answer to the agent is');
});

test('helper calls, splits and turns without a chat keep the usual route', async () => {
  const h = await withChat([{ seq: 1, authorKind: 'human' }]);
  assert.equal(personAsks(h.services, { agent: agent(SYSTEM_ID), conversationId: 'ch_1' }), false);
  assert.equal(personAsks(h.services, { agent: agent('ag_1'), conversationId: 'ch_1', split: { splitId: 'sp_1' } }), false);
  assert.equal(personAsks(h.services, { agent: agent('ag_1') }), false);
  assert.equal(personAsks(h.services, { agent: agent('ag_9'), conversationId: 'ch_1' }), false, 'not a member of the chat');
  assert.equal(personAsks(h.services, { agent: agent('ag_1'), conversationId: 'ch_1' }), true);
});

test('the line raises the effort on a Work model and in the cheaper cost mode too; a fixed effort stays', async () => {
  const pinned = await withChat([{ seq: 1, authorKind: 'human' }]);
  pinned.settings.update({ routing: { work: 'claude:claude-haiku-5-5' } });
  const byUse = await pinned.router.route(request());
  assert.deepEqual([byUse.modelId, byUse.by, byUse.effort], ['claude:claude-haiku-5-5', 'pin', 'high']);

  const fixed = await withChat([{ seq: 1, authorKind: 'human' }]);
  const low = await fixed.router.route(request({ agent: agent('ag_1', { modelPolicy: { effort: 'low' } }) }));
  assert.equal(low.effort, 'low', 'the fixed effort of the agent stays');
  assert.doesNotMatch(low.reason, /person/);
  // 13.11.2026: an effort the person suggests in the chat is information on their line – the rule's effort stands
  fixed.addChat('ch_2', ['ag_1'], { efforts: { ag_1: 'low' } });
  Object.assign(fixed.services.chats, { messages: () => [{ seq: 1, authorKind: 'human', kind: 'text' }] });
  assert.equal((await fixed.router.route(request({ conversationId: 'ch_2' }))).effort, 'high');

  const economy = await withChat([{ seq: 1, authorKind: 'human' }]);
  economy.settings.update({ routing: { costMode: 'economy' } });
  const cheap = await economy.router.route(request());
  assert.equal(economy.catalog.get(cheap.modelId)!.tier, 'small', 'the cheaper cost mode keeps its cheaper model');
  assert.equal(cheap.effort, 'high', 'thinking well on a cheap model is still cheap');
});

test('17.11.2026: the line no longer moves the model – in a live session the turn stays where it is, at effort high or above', async () => {
  const h = await withChat([{ seq: 1, authorKind: 'human' }]);
  // On the code before 17.11.2026 a small previous model gave way to the strongest one on a person's line, on a live cache.
  const small = await h.router.route(request({ previous: { modelId: 'claude:claude-haiku-5-5', effort: 'low', category: 'chat' }, boundary: false }));
  assert.deepEqual([small.modelId, small.effort], ['claude:claude-haiku-5-5', 'high'], small.reason);
  const kept = await h.router.route(request({ previous: { modelId: 'claude:claude-opus-5-5', effort: 'medium', category: 'chat' }, boundary: false }));
  assert.deepEqual([kept.modelId, kept.effort], ['claude:claude-opus-5-5', 'high']);
  const higher = await h.router.route(request({ previous: { modelId: 'claude:claude-opus-5-5', effort: 'max', category: 'chat' }, boundary: false }));
  assert.equal(higher.effort, 'max', 'a higher effort is never lowered');
  assert.doesNotMatch(higher.reason, /person/, 'nothing raised: nothing said');
});

test('helpers: top tier and effort floor', () => {
  const pool = [{ model: { tier: 'small' } }, { model: { tier: 'frontier' } }, { model: { tier: 'strong' } }, { model: { tier: 'frontier' } }] as Array<{ model: { tier: 'small' | 'strong' | 'frontier' } }>;
  assert.equal(topTier(pool as never[]).length, 2);
  assert.equal(personEffort('low'), 'high');
  assert.equal(personEffort('xhigh'), 'xhigh');
});

// B-078 (D16, live 06.11.2026: Fable and Astra ran at about 2.5x the cost of Opus): with the shipped priors the strongest tier's
// first choice on a Claude plan is Opus 5.5 – where an agent that leads runs; an agent that executes runs on Sonnet 5.5.
const SHIPPED = Priors.load(path.resolve(import.meta.dirname, '../../../resources/model-priors.json'));

async function claudePlan(work?: string) {
  const h = setup({ priors: SHIPPED });
  if (work) h.settings.update({ routing: { work } });
  h.accounts.upsert(account('acc_claude', 'claude'), false);
  h.accounts.upsert(account('acc_codex', 'codex'), false);
  h.engine('claude').lists.set('claude', ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((model) => ({ model, name: model, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] as Effort[] })));
  h.engine('codex').lists.set('codex', ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'].map((model) => ({ model, name: model, efforts: ['low', 'medium', 'high', 'xhigh'] as Effort[] })));
  await h.catalog.refresh({ force: true });
  h.addChat('ch_1', ['ag_1']);
  Object.assign(h.services.chats, { messages: () => [{ seq: 1, authorKind: 'human', kind: 'text', authorId: 'human', body: 'x' }] });
  return h;
}

const lead = agent('ag_1', { template: 'manager' });

test('with the shipped priors on a Claude plan: leading starts on Opus 5.5 – not on Fable 5.1 or GPT-6 Astra –, executing on Sonnet 5.5', async () => {
  const h = await claudePlan('auto');
  const chatLine = await h.router.route(request({ agent: lead }));
  assert.equal(chatLine.modelId, 'claude:claude-opus-5-5', chatLine.reason);
  assert.match(chatLine.reason, /^leading runs on the frontier tier's first choice/);
  const writing = await h.router.route(request({ agent: lead, text: 'Schreib mir bitte einen LinkedIn-Post über unser neues Produkt, locker und menschlich.' }));
  assert.equal(writing.category === 'writing' || writing.category === 'social-media', true, writing.category);
  assert.equal(writing.modelId, 'claude:claude-opus-5-5', writing.reason);
  const essay = await h.router.route(request({ agent: lead, mode: mode('writing') }));
  assert.equal(essay.modelId, 'claude:claude-opus-5-5', essay.reason);
  const doer = await h.router.route(request());
  assert.equal(doer.modelId, 'claude:claude-sonnet-5-5', doer.reason);
  assert.match(doer.reason, /^executing runs on the strong tier's best value/);
});

test('an agent that leads and sits on Fable 5.1 or GPT-6.1 Sol stays there for the owner\'s next line – the model fits its kind', async () => {
  const h = await claudePlan('claude');
  // On the code before 17.11.2026 the owner's line moved such a chat to Opus 5.5 ("does this as well for less", "is stronger at").
  const fable = await h.router.route(request({ agent: lead, mode: mode('writing'), previous: { modelId: 'claude:claude-fable-5-1', effort: 'high', category: 'writing' } }));
  assert.equal(fable.modelId, 'claude:claude-fable-5-1', fable.reason);
  const sol = await h.router.route(request({ agent: lead, text: 'Bau mir bitte eine Landingpage mit Tailwind, frontend und user interface.', previous: { modelId: 'codex:gpt-6.1-sol', effort: 'medium', category: 'frontend-ui' } }));
  assert.equal(sol.category, 'frontend-ui', sol.reason);
  assert.deepEqual([sol.modelId, sol.effort], ['codex:gpt-6.1-sol', 'high'], sol.reason);
});

test('personValue and firstChoice: 2 points smarter at 2.5x the price loses, 20 points smarter at 1.5x wins', () => {
  const opus = { model: { id: 'opus', tier: 'frontier', smarts: 94, relCost: 0.4, strengths: {} } } as never;
  const pricey = { model: { id: 'pricey', tier: 'frontier', smarts: 96, relCost: 1, strengths: {} } } as never;
  const smart = { model: { id: 'smart', tier: 'frontier', smarts: 114, relCost: 0.6, strengths: {} } } as never;
  assert.ok(personValue(opus) > personValue(pricey));
  assert.ok(personValue(smart) > personValue(opus));
  assert.equal(firstChoice([pricey, opus]), opus);
  assert.equal(firstChoice([pricey, opus, smart]), smart);
  assert.equal(firstChoice([]), undefined);
});
