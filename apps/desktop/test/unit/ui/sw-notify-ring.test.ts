// B-081: the service worker's notice for an agent's call (src/ui/pwa/sw-notify.ts): a push with ring true stays until it
// is touched and vibrates like a call; other pushes keep their notice as before; the clear at the ring's end closes it.
// Owns: these assertions only. Never: a real service worker.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RING_VIBRATE, wireNotifications, type NotifyScope, type PushEvent } from '../../../src/ui/pwa/sw-notify.ts';

function worker() {
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const open: Array<{ tag?: string; data?: unknown; close(): void }> = [];
  let onPush: ((event: PushEvent) => void) | undefined;
  const scope = {
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        const notice = { tag: options.tag as string | undefined, data: options.data, close: () => { open.splice(open.indexOf(notice), 1); } };
        open.push(notice);
      },
      getNotifications: async (filter?: { tag?: string }) => open.filter((notice) => !filter?.tag || notice.tag === filter.tag),
    },
    clients: { matchAll: async () => [], openWindow: async () => undefined },
    location: { origin: 'https://pc.local' },
    addEventListener: (type: string, fn: (event: PushEvent) => void) => { if (type === 'push') onPush = fn; },
  } as unknown as NotifyScope;
  wireNotifications(scope, { home: '/', icon: '/icon.png', alwaysShow: false });
  const push = async (payload: unknown) => {
    let done: Promise<unknown> = Promise.resolve();
    onPush!({ data: { json: () => payload, text: () => '' }, waitUntil: (promise: Promise<unknown>) => { done = promise; } } as unknown as PushEvent);
    await done;
  };
  return { shown, open, push };
}

test('a ring push stays and vibrates like a call; a plain push is unchanged; the clear closes the ring', async () => {
  const sw = worker();
  await sw.push({ title: 'Ava calls', body: 'Logo decision', tag: 'chat:ch_a', url: '/#/chat/ch_a', id: 'call_1', ring: true });
  assert.equal(sw.shown[0].title, 'Ava calls');
  assert.equal(sw.shown[0].options.requireInteraction, true);
  assert.deepEqual(sw.shown[0].options.vibrate, RING_VIBRATE);
  await sw.push({ title: 'Ava', body: 'Done', tag: 'chat:ch_b', id: 'n_2' });
  assert.equal(sw.shown[1].options.requireInteraction, undefined);
  assert.equal(sw.shown[1].options.vibrate, undefined);
  await sw.push({ clear: 'chat:ch_a' });
  assert.deepEqual(sw.open.map((notice) => notice.tag), ['chat:ch_b']);
});
