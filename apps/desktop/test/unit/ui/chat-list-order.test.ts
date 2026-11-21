// B-050 K1, Nachtrag Runde 4 in the window: every agent has the owner's default 1:1 from the hire on, so the chat
// list (src/ui/chat/list-order.ts, ChatList.tsx) keeps an empty one below every chat with a line – newest first, then
// by name; pinned stays first, a new chat that is not a default 1:1 keeps its place by creation, and a default 1:1
// moves up with its first line – and Team's "Most used" (src/ui/team/model.ts interactionScores) counts no empty chat.
// The New task picker (byActivity) keeps the same rule – after the start-up backfill an empty default 1:1 sat above
// older real chats there. F24 (owner 16.11.2026): the person's 1:1s with sub-agents nest under their top manager's 1:1
// (list-order.ts orgParent, one level), a chat's own parent wins, groups stay where they were placed. In the list a parent
// starts closed (owner 16.11.2026) and its caret opens it; under a closed parent the unread, the open and the lately
// opened sub-chats show.
// Owns: these assertions. Never: renders (the row's look: ChatRow.tsx, checked in the window).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationSummary, Member } from '../../../src/shared/model/chat.ts';
import { byActivity, emptyDirect, orderChats } from '../../../src/ui/chat/list-order.ts';
import { interactionScores } from '../../../src/ui/team/model.ts';

const NOW = Date.UTC(2026, 9, 29, 9);
const HOUR = 3_600_000;

type Row = Pick<ConversationSummary, 'id' | 'title' | 'pinned' | 'settings' | 'lastMessageAt' | 'createdAt' | 'members'>;

function member(memberId: string): Member {
  return { conversationId: 'c', memberId, kind: memberId === 'human' ? 'human' : 'agent', role: 'member', readSeq: 0, joinedAt: 0 } as Member;
}

function row(id: string, over: Partial<Row> = {}): Row {
  return { id, title: id, pinned: false, settings: {}, createdAt: NOW - 10 * HOUR, members: [member('human'), member(`ag_${id}`)], ...over };
}

const direct = (id: string, createdAt: number, lastMessageAt?: number): Row =>
  row(id, { settings: { direct: true, directPair: ['ag_' + id, 'human'] }, createdAt, ...(lastMessageAt === undefined ? {} : { lastMessageAt }) });

test('emptyDirect: a default 1:1 nobody wrote in yet', () => {
  assert.equal(emptyDirect(direct('mira', NOW)), true);
  assert.equal(emptyDirect(direct('mira', NOW, NOW)), false, 'a line was written');
  assert.equal(emptyDirect(row('launch')), false, 'not a default 1:1');
});

test('orderChats: empty default 1:1s wait below every chat with a line, newest first, then by name', () => {
  const list = [
    direct('ada', NOW - 1), // the start-up backfill made these at one moment …
    direct('zoe', NOW - 1),
    direct('ben', NOW - 1),
    direct('lea', NOW), // … and a hire later
    direct('mira', NOW - 50 * HOUR, NOW - 30 * HOUR), // a default 1:1 with an old line
    row('launch', { lastMessageAt: NOW - 2 * HOUR }),
    row('fresh', { createdAt: NOW - HOUR }), // a new chat the person started: no default 1:1, by its creation
    row('pinned', { pinned: true, lastMessageAt: NOW - 90 * HOUR }),
  ];
  const names = (chat: Row) => chat.title;
  assert.deepEqual(orderChats(list, names).map((chat) => chat.id), ['pinned', 'fresh', 'launch', 'mira', 'lea', 'ada', 'ben', 'zoe']);
  assert.deepEqual(list[0].id, 'ada', 'the input stays as it was');

  // Its first line moves the chat up, like any chat.
  const written = list.map((chat) => (chat.id === 'zoe' ? { ...chat, lastMessageAt: NOW } : chat));
  assert.deepEqual(orderChats(written, names).map((chat) => chat.id).slice(0, 2), ['pinned', 'zoe']);
});

test('byActivity: an empty default 1:1 waits below every chat with a line there too', () => {
  const full = (chat: Row) => ({ ...chat, members: chat.members.map((m) => ({ ...m })) }) as unknown as ConversationSummary;
  // The backfill made the default 1:1s now; the real chats are older.
  const beaDm = full(direct('bea', NOW));
  const cyDm = full(direct('cy', NOW - 1));
  const sources = full(row('sources', { members: [member('human'), member('ag_cy')], lastMessageAt: NOW - 30 * HOUR }));
  const old = full(row('old', { members: [member('human'), member('ag_bea')], createdAt: NOW - 90 * HOUR }));

  assert.deepEqual([beaDm, cyDm, sources, old].sort(byActivity).map((chat) => chat.id), ['sources', 'old', 'bea', 'cy'], 'the New task picker');
});

test('interactionScores: an empty default 1:1 is no interaction ("Most used" stays what the person used)', () => {
  const scores = interactionScores([
    { members: [member('human'), member('ag_new')], createdAt: NOW },
    { members: [member('human'), member('ag_used')], createdAt: NOW - 40 * 24 * HOUR, lastMessageAt: NOW - 20 * 24 * HOUR },
  ], NOW);
  assert.equal(scores.get('ag_new'), undefined, 'hired today, never written to');
  assert.ok((scores.get('ag_used') ?? 0) > 0);
});

test('F24: the person\'s 1:1s with sub-agents sit under their top manager\'s 1:1; the chat\'s own parent wins; one level', async () => {
  const { directAgent, nestChats, orgParent } = await import('../../../src/ui/chat/list-order.ts');
  // Konrad (reports to the person) ← Nora ← Ida; Lukas on top too; Tom reports to a person (per_anna)
  const org = new Map([
    ['ag_konrad', { id: 'ag_konrad' }], ['ag_nora', { id: 'ag_nora', managerId: 'ag_konrad' }], ['ag_ida', { id: 'ag_ida', managerId: 'ag_nora' }],
    ['ag_lukas', { id: 'ag_lukas', managerId: 'human' }], ['ag_tom', { id: 'ag_tom', managerId: 'per_anna' }], ['ag_loop', { id: 'ag_loop', managerId: 'ag_loop' }],
  ]);
  const one = (name: string, lastMessageAt?: number) => direct(name, NOW - 5 * HOUR, lastMessageAt);
  const group = row('launch', { lastMessageAt: NOW - HOUR, members: [member('human'), member('ag_nora'), member('ag_ida')] });
  const placed = row('nora-topic', { settings: { parentId: 'nora' }, lastMessageAt: NOW - 2 * HOUR }); // put under Nora's 1:1 by the AI
  const list = orderChats([one('konrad', NOW - 3 * HOUR), one('nora', NOW - 30 * 60_000), one('ida'), one('lukas', NOW - 4 * HOUR), one('tom', NOW - 6 * HOUR), one('loop'), group, placed]);
  assert.equal(directAgent(one('nora'), org), 'ag_nora');
  assert.equal(directAgent(group, org), undefined, 'a group is no 1:1');
  const directs = new Map([['ag_konrad', 'konrad'], ['ag_nora', 'nora']]);
  assert.equal(orgParent(one('ida'), org, directs), 'konrad', 'the top-most agent manager with a 1:1 here');
  assert.equal(orgParent(one('ida'), org, new Map([['ag_nora', 'nora']])), 'nora', 'without the top one\'s 1:1: the next one up');
  assert.equal(orgParent(one('tom'), org, directs), undefined, 'a person ends the chain');
  assert.equal(orgParent(one('loop'), org, directs), undefined, 'its own manager: no loop');
  assert.equal(orgParent({ ...one('ida'), settings: { ...one('ida').settings, parentId: 'launch' } }, org, directs), 'launch', 'the chat\'s own parent wins');

  const nodes = nestChats(list, org);
  assert.deepEqual(nodes.map((node) => [node.chat.id, node.children.map((child) => child.id)]), [
    ['launch', []], // a group stays on its level, whoever is in it
    ['konrad', ['nora', 'nora-topic', 'ida']], // the activity order; the empty default 1:1 last; Nora's own sub-chat goes where her 1:1 went
    ['lukas', []], ['tom', []], ['loop', []],
  ]);
  assert.deepEqual(nestChats(list).map((node) => [node.chat.id, node.children.map((child) => child.id)]), [
    ['nora', ['nora-topic']], ['launch', []], ['konrad', []], ['lukas', []], ['tom', []], ['ida', []], ['loop', []],
  ], 'without the org: only the chat\'s own parent nests (B-078)');
});

test('F24 in the list: the org goes in, a parent starts closed until its caret opens it; unread, open and lately opened sub-chats show', async () => {
  const { readFileSync } = await import('node:fs');
  const list = readFileSync(new URL('../../../src/ui/chat/ChatList.tsx', import.meta.url), 'utf8');
  assert.match(list, /<Rows nodes=\{nestChats\(main, agentMap\.value\)\}/);
  assert.match(list, /const open = children\.length > 0 && \(Boolean\(mark\) \|\| treeChoice\.value\[chat\.id\] === true\);/);
  assert.match(list, /children\.filter\(\(child\) => child\.unread > 0 \|\| child\.id === activeId \|\| keptChildren\.has\(child\.id\) \|\| lately\(child\.id\)\)/);
  assert.match(list, /const RECENT_MS = 3 \* 24 \* 60 \* 60 \* 1000;/);
});
