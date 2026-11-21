// F22 (owner 16.11.2026): the person's suggestion per agent in a chat carries a server stamp (settings.suggestedAt), and their
// line reads it – picked since their previous line "· picked … for this message", changed after it "· picked … after this
// message", a value that stayed (or an older chat without a stamp) "· earlier suggested …" (chat/suggestion-fresh.ts,
// context/render.ts suggestionTag). Deterministic: what reaches the agent's context, not how a model weighs it.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../context/fixture.ts';
import { agent } from './harness.ts';
import { OWNER, TestClient, rpcFixture } from '../rpc/s1-helpers.ts';
import { renderMessages, type RenderContext } from '../../../src/runtime/context/render.ts';
import { stampSuggestions, suggestionNow } from '../../../src/runtime/chat/suggestion-fresh.ts';
import type { ConversationSettings, Message } from '../../../src/shared/model/chat.ts';

function setup() {
  const f = fixture();
  const chat = f.chats.create({ title: 'Launch', agentIds: [f.vid.id, f.manager.id], createdBy: 'human' });
  const ctx: RenderContext = { services: f.services, agentId: f.vid.id, humanName: 'Alex', zone: 'UTC', now: f.clock.now() + 86_400_000 };
  const stamps = () => f.chats.get(chat.id)!.settings.suggestedAt;
  const choose = (settings: Partial<ConversationSettings>) => { f.clock.advance(60_000); f.chats.update(chat.id, { settings }, 'human'); };
  const say = (body: string, extra: { model?: string; effort?: string; authorId?: string } = {}): Message => {
    f.clock.advance(60_000);
    const { authorId = 'human', ...choice } = extra;
    return f.chats.send({ conversationId: chat.id, authorId, body, ...choice } as Parameters<typeof f.chats.send>[0]);
  };
  const tag = (message: Message) => {
    const label = renderMessages(ctx, [f.chats.message(message.id)!], { images: false, suggestions: true }).lines[0];
    return /#\d+(?: · ([^\]]*))?\]/.exec(label)?.[1] ?? '';
  };
  return { f, chat, stamps, choose, say, tag };
}

test('the stamp: set when one of the agent\'s four values changes, kept when nothing of theirs changes, gone with their last value', () => {
  const { f, stamps, choose } = setup();
  const vid = f.vid.id;
  const boss = f.manager.id;
  choose({ modelHints: { [vid]: 'codex:luna' } });
  const first = f.clock.now();
  assert.deepEqual(stamps(), { [vid]: first });
  choose({ modelHints: { [vid]: 'codex:luna' }, notifications: 'all' });
  assert.deepEqual(stamps(), { [vid]: first }, 'the same pick again and another setting: no new stamp');
  choose({ modelHints: { [vid]: 'codex:luna', [boss]: 'codex:gpt-6.1-sol' } });
  assert.deepEqual(stamps(), { [vid]: first, [boss]: f.clock.now() }, 'only the agent whose value changed');
  for (const settings of [{ efforts: { [vid]: 'high' } }, { temperatures: { [vid]: 0.4 } }, { models: { [vid]: 'codex:luna' } }] as Array<Partial<ConversationSettings>>) {
    choose(settings);
    assert.equal(stamps()?.[vid], f.clock.now(), JSON.stringify(settings));
  }
  choose({ suggestedAt: { [vid]: 1, [boss]: 2 } });
  assert.notEqual(stamps()?.[vid], 1, 'a stamp sent along is ignored');
  assert.notEqual(stamps()?.[boss], 2);
  choose({ models: {}, modelHints: { [boss]: 'codex:gpt-6.1-sol' }, efforts: {}, temperatures: {} });
  assert.deepEqual(Object.keys(stamps() ?? {}), [boss], 'Auto: the agent\'s stamp goes with its last value');
  choose({ modelHints: {} });
  assert.equal(stamps(), undefined, 'no empty map stays');
});

test('a message\'s model or effort stamps with the message\'s time; the same choice sent again keeps the stamp', () => {
  const { f, stamps, say } = setup();
  const first = say('@Vic cut the intro', { model: 'codex:luna', effort: 'low' });
  assert.equal(stamps()?.[f.vid.id], first.createdAt);
  say('@Vic and the outro', { model: 'codex:luna', effort: 'low' });
  assert.equal(stamps()?.[f.vid.id], first.createdAt, 'nothing changed: the earlier stamp stands');
  const third = say('@Vic now harder', { effort: 'high' });
  assert.equal(stamps()?.[f.vid.id], third.createdAt);
});

test('the person\'s line: picked for it, picked after it, or a value that stayed – also in a chat without a stamp', () => {
  const { f, chat, choose, say, tag } = setup();
  const before = say('Hi');
  assert.equal(tag(before), '', 'nothing suggested');
  choose({ modelHints: { [f.vid.id]: 'codex:luna' }, efforts: { [f.vid.id]: 'high' } });
  assert.equal(tag(before), 'picked Luna · effort high after this message', 'changed since this line');
  const picked = say('Cut it today');
  assert.equal(tag(picked), 'picked Luna · effort high for this message');
  say('On it', { authorId: f.vid.id });
  const next = say('And the outro');
  assert.equal(tag(next), 'earlier suggested Luna · effort high', 'their line before already had it: it stayed');
  assert.equal(tag(picked), 'picked Luna · effort high for this message', 'the line it was picked for still reads so');
  const sent = say('@Vic the trailer too', { model: 'codex:gpt-6.1-sol' });
  assert.equal(tag(sent), 'picked GPT-6.1 Sol · effort high for this message', 'a model sent with the line');
  const agentsOnly = say('Done', { authorId: f.vid.id });
  assert.equal(tag(agentsOnly), '', 'an agent\'s line has no tag');
  choose({ efforts: {} });
  const afterAgent = say('Thanks');
  assert.equal(tag(afterAgent), 'picked GPT-6.1 Sol for this message', 'an agent\'s line between pick and line changes nothing');
  f.db.run(`UPDATE conversations SET settings = json_remove(settings, '$.suggestedAt') WHERE id = ?`, [chat.id]);
  assert.equal(tag(say('Older chat')), 'earlier suggested GPT-6.1 Sol', 'no stamp: the weaker reading');
});

test('the subconscious reads the same: for the person\'s newest line, after it, or stayed', () => {
  const { f, chat, choose, say } = setup();
  const now = () => suggestionNow(f.services, chat.id, f.vid.id);
  assert.equal(now(), 'earlier', 'nothing suggested');
  say('Hi');
  choose({ modelHints: { [f.vid.id]: 'codex:luna' } });
  assert.equal(now(), 'after');
  say('Cut it');
  assert.equal(now(), 'now');
  say('Next');
  assert.equal(now(), 'earlier');
  assert.equal(suggestionNow(f.services, chat.id, f.manager.id), 'earlier', 'another agent: nothing for it');
});

test('stampSuggestions: auto is no value, a value that comes back is stamped anew', () => {
  const none: ConversationSettings = { models: { ag_1: 'auto' }, efforts: { ag_1: 'auto' } };
  assert.equal(stampSuggestions({}, none, 5).suggestedAt, undefined);
  const one = stampSuggestions(none, { ...none, temperatures: { ag_1: 0.2 } }, 6);
  assert.deepEqual(one.suggestedAt, { ag_1: 6 });
  assert.equal(stampSuggestions(one, { ...one, temperatures: {} }, 7).suggestedAt, undefined);
});

test('chats.update refuses a stamp from a client', async (t) => {
  const f = rpcFixture();
  t.after(f.cleanup);
  f.org.add(agent('ag_ava', 'Ava'));
  const owner = new TestClient(f.server, OWNER);
  const chat = f.chats.create({ agentIds: ['ag_ava'], createdBy: 'human' });
  assert.equal((await owner.request('chats.update', { id: chat.id, settings: { suggestedAt: { ag_ava: 1 } } })).error?.code, 'bad_request');
  await owner.call('chats.update', { id: chat.id, settings: { modelHints: { ag_ava: 'codex:luna' } } });
  assert.equal(typeof f.chats.get(chat.id)!.settings.suggestedAt?.ag_ava, 'number', 'the server stamps the pick');
});
