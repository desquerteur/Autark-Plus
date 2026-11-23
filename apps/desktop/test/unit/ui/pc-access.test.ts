// B-085 careful PC access, window side (src/ui/onboarding/ai-notice.ts accessNotice, pc-access.ts): after the first
// run, while the team works carefully and this connection may write settings, one quiet info line with
// [Give full access] below every other line; the app line the Manager then gets speaks as the person, like the start
// text, and asks the Manager to change the PC line itself; setPcAccess sends that line first (one clientId per try
// until it went through) and only then writes the setting. Owner 16.11.2026 (Settings › Security): the same in both
// directions, careful with its own line; the About card and the Security page name both levels with one sentence each.
// Owns: these assertions only. Never: a real runtime, a socket or a window.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_NOTICE_ID, ACCESS_NOTICE_PRIORITY, ACCESS_NOTICE_TEXT, accessNotice, type AccessNoticeInput } from '../../../src/ui/onboarding/ai-notice.ts';
import { ACCESS_LEVELS, CAREFUL_ACCESS_LINE, FULL_ACCESS_LINE, setPcAccess } from '../../../src/ui/onboarding/pc-access.ts';
import { NOTICE_PRIORITY } from '../../../src/ui/shell/notices.ts';
import type { SessionInfo } from '../../../src/shared/api/methods.ts';
import { HUMAN_ID } from '../../../src/shared/ids.ts';
import { rpc } from '../../../src/ui/lib/rpc.ts';
import { session } from '../../../src/ui/lib/session.ts';
import { agents, conversations, settings } from '../../../src/ui/lib/store.ts';

const input = (pcAccess: 'whole' | 'careful' | undefined, extra: Partial<AccessNoticeInput> = {}): AccessNoticeInput => ({
  settings: { onboarding: { completed: true, step: 'done' }, profile: { name: 'Ada', company: '', language: 'en', timezone: 'UTC', ...(pcAccess ? { pcAccess } : {}) } },
  loaded: true, writable: true, ...extra,
});

test('careful after the first run: one quiet info line with Give full access, below every other line', () => {
  let given = 0;
  const notice = accessNotice(input('careful'), () => { given++; });
  assert.ok(notice);
  assert.equal(notice.id, ACCESS_NOTICE_ID);
  assert.equal(notice.tone, 'info');
  assert.equal(notice.text, ACCESS_NOTICE_TEXT);
  assert.equal(ACCESS_NOTICE_TEXT, 'The team checks with you before changes outside its folders.');
  assert.ok(Object.values(NOTICE_PRIORITY).every((priority) => priority > ACCESS_NOTICE_PRIORITY), 'lowest priority');
  assert.deepEqual(notice.actions?.map((action) => action.label), ['Give full access']);
  notice.actions?.[0].run();
  assert.equal(given, 1);
  assert.equal(notice.onDismiss, undefined, 'a status, no Dismiss');
});

test('no line for the whole PC, during the first run, before the snapshots or where settings cannot be written', () => {
  assert.equal(accessNotice(input('whole'), () => undefined), null);
  assert.equal(accessNotice(input(undefined), () => undefined), null, 'absent = whole');
  const during = input('careful');
  during.settings = { ...during.settings!, onboarding: { completed: false, step: 'profile' } };
  assert.equal(accessNotice(during, () => undefined), null);
  assert.equal(accessNotice(input('careful', { loaded: false }), () => undefined), null);
  assert.equal(accessNotice(input('careful', { writable: false }), () => undefined), null);
  assert.equal(accessNotice(input('careful', { settings: null }), () => undefined), null);
});

/** Every rpc call setPcAccess makes, in order; `fail` makes that method throw once. */
function stubRpc(fail?: string) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let failing = fail;
  Object.assign(rpc, {
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === failing) { failing = undefined; throw new Error(`${method} refused`); }
      if (method === 'chats.direct') return { id: 'ch_direct' };
      if (method === 'settings.update') return null;
      return { id: 'ms_1' };
    },
  });
  return calls;
}

const owner = (allowedMethods: string[] = []) => ({ kind: 'owner', capabilities: [], secure: true, allowedMethods }) as unknown as SessionInfo;
const managerChat = { id: 'ch_boss', settings: {}, createdAt: 1, members: [{ memberId: 'ag_boss', kind: 'agent' }, { memberId: HUMAN_ID, kind: 'human' }] };

function world(chats: unknown[] = [managerChat]) {
  settings.value = null;
  session.value = owner();
  agents.value = [{ id: 'ag_boss', name: 'Manager', mode: 'manager', template: 'manager', createdAt: 1 }] as never;
  conversations.value = chats as never;
}

test('setPcAccess whole:one line to the Manager\'s first chat as the person, with a clientId, then the setting', async () => {
  world();
  const calls = stubRpc();
  await setPcAccess('whole');
  assert.deepEqual(calls.map((call) => call.method), ['messages.send', 'settings.update']);
  assert.equal(calls[0].params.conversationId, 'ch_boss');
  assert.equal(calls[0].params.body, FULL_ACCESS_LINE);
  assert.deepEqual(calls[0].params.mentions, ['ag_boss']);
  assert.match(String(calls[0].params.clientId), /^req_/);
  assert.deepEqual(calls[1].params, { profile: { pcAccess: 'whole' } });
});

test('setPcAccess whole:no first chat – the default 1:1 from chats.direct', async () => {
  world([]);
  const calls = stubRpc();
  await setPcAccess('whole');
  assert.deepEqual(calls.map((call) => call.method), ['chats.direct', 'messages.send', 'settings.update']);
  assert.deepEqual(calls[0].params, { memberId: 'ag_boss' });
  assert.equal(calls[1].params.conversationId, 'ch_direct');
});

test('setPcAccess whole:a refused send leaves the setting careful; the retry and a double click carry the same clientId', async () => {
  world();
  const calls = stubRpc('messages.send');
  await assert.rejects(setPcAccess('whole'), /messages\.send refused/);
  assert.deepEqual(calls.map((call) => call.method), ['messages.send'], 'no settings write');
  await Promise.all([setPcAccess('whole'), setPcAccess('whole')]);
  const sends = calls.filter((call) => call.method === 'messages.send');
  assert.equal(new Set(sends.map((call) => call.params.clientId)).size, 1, 'one clientId: the chat service keeps one message');
  const next = stubRpc();
  await setPcAccess('whole');
  assert.notEqual(next[0].params.clientId, sends[0].params.clientId, 'a new one after a try went through');
});

test('setPcAccess whole:no Manager or no messages.send – only the setting', async () => {
  world();
  agents.value = [];
  let calls = stubRpc();
  await setPcAccess('whole');
  assert.deepEqual(calls.map((call) => call.method), ['settings.update']);
  world();
  session.value = { ...owner(['settings.update']), kind: 'device' } as unknown as SessionInfo;
  calls = stubRpc();
  await setPcAccess('whole');
  assert.deepEqual(calls.map((call) => call.method), ['settings.update']);
});

test('the line to the Manager: the app\'s automatic message in the person\'s voice; the Manager changes the PC line itself', () => {
  assert.match(FULL_ACCESS_LINE, /^Automatic message from the app, not typed by me: I gave the team full access to this PC from now on\./);
  assert.match(FULL_ACCESS_LINE, /"What I have here" in your own SYSTEM\.md to the whole PC and let the team know, so each changes theirs\./, 'each agent writes its own SYSTEM.md');
  assert.equal(FULL_ACCESS_LINE.split('\n').length, 1);
});

test('owner 16.11.2026: careful the same way – its own line to the Manager, then the setting; its own clientId', async () => {
  world();
  const calls = stubRpc();
  await setPcAccess('careful');
  assert.deepEqual(calls.map((call) => call.method), ['messages.send', 'settings.update']);
  assert.equal(calls[0].params.body, CAREFUL_ACCESS_LINE);
  assert.deepEqual(calls[1].params, { profile: { pcAccess: 'careful' } });
  const back = stubRpc();
  await setPcAccess('whole');
  assert.notEqual(back[0].params.clientId, calls[0].params.clientId, 'another direction is another message');
  assert.match(CAREFUL_ACCESS_LINE, /^Automatic message from the app, not typed by me: from now on the team works freely in its own folders on this PC and checks with me before changes elsewhere\./);
  assert.match(CAREFUL_ACCESS_LINE, /"What I have here" in your own SYSTEM\.md to that and let the team know, so each changes theirs\.$/);
  assert.deepEqual(ACCESS_LEVELS.map((level) => [level.id, level.title]), [['whole', 'Full access'], ['careful', 'Careful']]);
  for (const level of ACCESS_LEVELS) assert.match(level.text, /^The team [^.]+\.$/, 'one sentence per level');
});
