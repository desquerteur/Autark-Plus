// 13.11.2026 (owner: the model the person picks in the chat is "einfach nur da, wird der KI so erklärt") – the person's
// suggestion in a chat (model, effort, temperature: the composer chip) never routes. Every turn in the chat, the one that
// answers the person's new line too, starts on the agent's start model, else on the rules; the agent's own model.set (or
// its subconscious's) is what moves it. The suggestion stands on the person's line (context/render.ts suggestionTag).
// Owns: these assertions only. Never: real engines, accounts, timers or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSON_LINE, account, agent, mode, setup, type ChatLine } from '../models/harness.ts';
import { Priors } from '../../../src/runtime/models/priors.ts';
import { selectCandidates } from '../../../src/runtime/accounts/candidates.ts';
import type { RouteRequest } from '../../../src/runtime/contracts.ts';
import type { Effort, EngineId } from '../../../src/shared/model/providers.ts';
import type { ConversationSettings } from '../../../src/shared/model/chat.ts';

const SOL = 'codex:gpt-6.1-sol';
const OPUS = 'claude:claude-opus-5-5';
const HAIKU = 'claude:claude-haiku-5-5';
const ALL: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const caps = { vision: true, tools: true, structuredOutput: true };
const PRIORS = Priors.parse({
  version: 'test-chip', categories: {},
  models: [
    { match: 'gpt-6.1-sol*', name: 'GPT-6.1 Sol', tier: 'frontier', relCost: 0.3, caps, efforts: ['low', 'medium', 'high', 'xhigh'], strengths: { chat: 0.4 } },
    { match: 'claude-opus-5-5*', name: 'Claude Opus 5.5', tier: 'frontier', relCost: 0.4, caps, efforts: ALL, strengths: { chat: 0.4 } },
    { match: 'claude-haiku-5-5*', name: 'Claude Haiku 5.5', tier: 'small', relCost: 0.03, caps, efforts: ['low', 'medium', 'high'], strengths: { chat: 0.4 } },
  ],
});
const CHIP: ConversationSettings = { modelHints: { ag_1: HAIKU }, efforts: { ag_1: 'low' }, temperatures: { ag_1: 0.2 } };
const ownOpus = agent('ag_1', { modelPolicy: { pin: OPUS } });

/** A Codex plan (Sol) and a Claude plan (Opus, Haiku); balanced. */
async function chipSetup() {
  const h = setup({ priors: PRIORS });
  h.accounts.upsert(account('acc_codex', 'codex'), false);
  h.accounts.upsert(account('acc_claude', 'claude'), false);
  h.accounts.candidates = (engine: EngineId, model?: string) => selectCandidates(h.accounts.accounts, engine, h.clock.now(), model);
  const listed = (model: string, name: string) => ({ model, name, efforts: PRIORS.forModel(model)?.efforts ?? ALL });
  h.engine('codex').lists.set('codex', [listed('gpt-6.1-sol', 'GPT-6.1 Sol')]);
  h.engine('claude').lists.set('claude', [listed('claude-opus-5-5', 'Claude Opus 5.5'), listed('claude-haiku-5-5', 'Claude Haiku 5.5')]);
  await h.catalog.refresh({ force: true });
  const route = (conversationId: string, patch: Partial<RouteRequest> = {}) => h.router.route({ agent: ownOpus, mode: mode('chat'), conversationId, ...patch });
  return { ...h, route };
}

test('the chip routes nothing: the turn answering the person and my other turns in the chat start on my start model, without its effort or temperature', async () => {
  const h = await chipSetup();
  const agentLine: ChatLine[] = [{ authorKind: 'agent', kind: 'text' }];
  for (const [id, lines] of [['ch_person', PERSON_LINE], ['ch_quiet', []], ['ch_agent', agentLine]] as Array<[string, ChatLine[]]>) {
    h.addChat(id, ['ag_1'], CHIP, lines);
    const turn = await h.route(id);
    assert.deepEqual([turn.modelId, turn.by, turn.temperature], [OPUS, 'pin', undefined], id);
    assert.match(turn.reason, /^my start model/, id);
    assert.notEqual(turn.effort, 'low', id);
    assert.notEqual(turn.effortBy, 'chat', id);
  }
});

test("without a start model of mine the person's line runs on the rules (the strongest model), never on the chip's small model", async () => {
  const h = await chipSetup();
  h.addChat('ch_1', ['ag_1'], CHIP, PERSON_LINE);
  const turn = await h.route('ch_1', { agent: agent('ag_1') });
  assert.notEqual(turn.modelId, HAIKU, turn.reason);
  assert.equal(turn.by, 'rules', turn.reason);
  assert.doesNotMatch(turn.reason, /suggested/);
});

test('what moves the model is my own request (model.set, or my subconscious before the turn)', async () => {
  const h = await chipSetup();
  h.addChat('ch_1', ['ag_1'], CHIP, PERSON_LINE);
  const mine = await h.route('ch_1', { previous: { modelId: HAIKU, effort: 'low', explicit: true } });
  assert.deepEqual([mine.modelId, mine.effort, mine.by], [HAIKU, 'low', 'request']);
  const sub = await h.route('ch_1', { previous: { modelId: SOL, effort: 'high', explicit: true, by: 'subconscious', why: 'hard maths' } });
  assert.deepEqual([sub.modelId, sub.by], [SOL, 'request']);
});
