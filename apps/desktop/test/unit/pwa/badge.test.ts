// Owns: app-icon totals against both bundled phone workers and their notification tray, including replacements and reads.
// Never: claims a physical launcher or Apple's push service was exercised.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { noticeCount, syncAppBadge } from '../../../src/ui/pwa/badge.ts';
import { closeReadNotices } from '../../../src/ui/pwa/install.ts';
import type { ConversationSummary } from '../../../src/shared/model/chat.ts';

type Handler = (event: Record<string, unknown>) => void;
interface Notice {
  title?: string;
  body?: string;
  tag?: string;
  data?: { id?: string; count?: number; url?: string };
  close(): void;
}

function worker(hosted: boolean, supported = true, denied = false) {
  const source = hosted ? 'src/ui/hosted/sw.ts' : 'src/ui/pwa/sw.ts';
  const code = buildSync({ entryPoints: [source], bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent' }).outputFiles[0].text;
  const handlers = new Map<string, Handler>();
  const tray: Notice[] = [];
  const badges: number[] = [];
  const warnings: unknown[] = [];
  const opened: string[] = [];
  const navigator = supported ? {
    setAppBadge: async (count: number) => { if (denied) throw new Error('Denied'); badges.push(count); },
    clearAppBadge: async () => { badges.push(0); },
  } : {};
  const registration = {
    scope: 'https://phone.example/app/',
    getNotifications: async (filter?: { tag?: string }) => tray.filter((notice) => !filter?.tag || notice.tag === filter.tag),
    showNotification: async (title: string, options: Notice) => {
      const notice = { ...options, title, close: () => { const index = tray.indexOf(notice); if (index >= 0) tray.splice(index, 1); } };
      tray.push(notice);
    },
    pushManager: { getSubscription: async () => ({ endpoint: 'https://web.push.apple.com/test' }) },
  };
  const scope = {
    registration, navigator, location: new URL('https://phone.example/app/sw.js'),
    clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } },
    addEventListener: (type: string, fn: Handler) => { handlers.set(type, fn); },
  };
  // The hosted worker takes the browser's `caches` at load (F29, ui/hosted/ui-hashes.ts); these tests never fetch through it.
  const caches = { open: async () => ({ match: async () => undefined, put: async () => undefined }) };
  vm.runInNewContext(code, { self: scope, URL, Promise, caches, console: { warn: (...args: unknown[]) => warnings.push(args) } });
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    const pending: Promise<unknown>[] = [];
    handlers.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  };
  const send = (payload: unknown) => dispatch('push', { data: { json: () => payload } });
  const dismiss = async (notice: Notice) => { notice.close(); await dispatch('notificationclose', { notification: notice }); };
  return { tray, badges, warnings, opened, registration, navigator, dispatch, send, dismiss };
}

test('older notifications count once, bundled chats retain their count, and cleared iOS compatibility notices count zero', () => {
  assert.equal(noticeCount([{}, { data: { count: 4 } }, { data: { count: 0 } }]), 5);
  for (const count of [-1, NaN, Infinity, '4', 1.5]) assert.equal(noticeCount([{ data: { count } }]), 1);
});

for (const hosted of [false, true]) {
  const app = hosted ? 'hosted iPhone app' : 'PC-served PWA';

  test(`${app}: several messages, chats and other notices add up; replacements and duplicate deliveries count once`, async () => {
    const sw = worker(hosted);
    const message = { title: 'First', body: 'Older text', tag: 'chat:one', id: 'first', url: '/#/chat/one' };
    await sw.send(message);
    await sw.send(message);
    assert.equal(sw.badges.at(-1), 1, 'same event from another PC');
    await sw.send({ ...message, id: 'second', title: 'Second', body: 'Newest text' });
    await sw.send(message); // delayed copy from another PC after the second message
    assert.equal(sw.badges.at(-1), 2);
    assert.equal(sw.tray[0].title, 'Second');
    assert.equal(sw.tray[0].body, 'Newest text');
    await sw.send({ tag: 'chat:two', id: 'third' });
    await sw.send({ tag: 'todo:task', id: 'task-created' });
    await sw.send({ tag: 'todo:task', id: 'task-updated' });
    await sw.send({ tag: 'workforce:important', id: 'notice' });
    assert.equal(sw.tray.length, 4, 'two chats, a task and another notice');
    assert.equal(sw.badges.at(-1), 5, 'two messages + one message + task + other notice');
    assert.equal(sw.tray.find((notice) => notice.tag === 'chat:one')?.data?.count, 2);
  });

  test(`${app}: overlapping pushes retain both messages`, async () => {
    const sw = worker(hosted);
    await Promise.all([sw.send({ tag: 'chat:one', id: 'one' }), sw.send({ tag: 'chat:one', id: 'two' })]);
    assert.equal(sw.tray.length, 1);
    assert.equal(sw.badges.at(-1), 2);
  });

  test(`${app}: dismissing and tapping remove their counts; the final dismissal clears the icon`, async () => {
    const sw = worker(hosted);
    await sw.send({ tag: 'chat:one', id: 'one' });
    await sw.send({ tag: 'chat:one', id: 'two' });
    await sw.send({ tag: 'todo:task' });
    await sw.dismiss(sw.tray.find((notice) => notice.tag === 'todo:task')!);
    assert.equal(sw.badges.at(-1), 2);
    await sw.dispatch('notificationclick', { notification: sw.tray[0] });
    assert.equal(sw.badges.at(-1), 0);
    assert.equal(sw.opened.length, 1, 'the tap still opens the app');
  });

  test(`${app}: a chat read elsewhere removes its messages without counting the iOS compatibility notification`, async () => {
    const sw = worker(hosted);
    await sw.send({ tag: 'chat:one', id: 'one' });
    await sw.send({ tag: 'chat:one', id: 'two' });
    await sw.send({ tag: 'todo:task' });
    await sw.send({ clear: 'chat:one', tag: 'chat:one', id: 'two' });
    assert.equal(sw.badges.at(-1), 1);
    await sw.dismiss(sw.tray.find((notice) => notice.tag === 'todo:task')!);
    assert.equal(sw.badges.at(-1), 0);
  });

  test(`${app}: browsers without the badge API and a refused badge keep delivering notifications`, async () => {
    const unsupported = worker(hosted, false);
    await unsupported.send({ tag: 'chat:one' });
    assert.equal(unsupported.tray.length, 1);
    const denied = worker(hosted, true, true);
    await denied.send({ tag: 'chat:one' });
    assert.equal(denied.tray.length, 1);
    assert.equal(denied.warnings.length, 1);
  });
}

test('page-side closing of read chat notices queues the worker badge refresh using the same tray', async () => {
  const sw = worker(true);
  await sw.send({ tag: 'chat:read', id: 'one' });
  await sw.send({ tag: 'chat:read', id: 'two' });
  await sw.send({ tag: 'chat:unread' });
  await sw.send({ tag: 'call:one', ring: true });
  const pending: Promise<unknown>[] = [];
  const reg = { ...sw.registration, active: { postMessage: (data: unknown) => pending.push(sw.dispatch('message', { data })) } };
  const chats = [{ id: 'read', unread: 0 }, { id: 'unread', unread: 1 }] as ConversationSummary[];
  assert.equal(await closeReadNotices(reg as unknown as ServiceWorkerRegistration, chats), 2);
  await Promise.all(pending);
  assert.equal(sw.badges.at(-1), 1);
});

test('a fresh worker reconstructs the icon from existing notifications without another push', async () => {
  const badges: number[] = [];
  const reg = { getNotifications: async () => [{ data: { count: 3 } }, {}] };
  await syncAppBadge(reg as unknown as ServiceWorkerRegistration, { setAppBadge: async (n: number) => badges.push(n) });
  assert.deepEqual(badges, [4]);
});
