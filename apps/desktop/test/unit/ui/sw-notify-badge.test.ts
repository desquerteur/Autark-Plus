// 16.11.2026 (owner F15: the Autark mark on every notice): the PC worker's notices carry the white-on-transparent
// badge (src/ui/pwa/sw-notify.ts `badge`), a worker without one keeps its icon as the badge, and the badge file the
// worker names exists as a 96 px PNG that the build copies next to icon.png.
// Owns: these assertions only. Never: a real service worker or a real notification.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wireNotifications, type NotifyOptions, type NotifyScope, type PushEvent } from '../../../src/ui/pwa/sw-notify.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function worker(options: NotifyOptions) {
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  let onPush: ((event: PushEvent) => void) | undefined;
  const scope = {
    registration: {
      showNotification: async (title: string, shownOptions: Record<string, unknown>) => { shown.push({ title, options: shownOptions }); },
      getNotifications: async () => [],
    },
    clients: { matchAll: async () => [], openWindow: async () => undefined },
    location: { origin: 'https://pc.local' },
    addEventListener: (type: string, fn: (event: PushEvent) => void) => { if (type === 'push') onPush = fn; },
  } as unknown as NotifyScope;
  wireNotifications(scope, options);
  const push = async (payload: unknown) => {
    let done: Promise<unknown> = Promise.resolve();
    onPush!({ data: { json: () => payload, text: () => '' }, waitUntil: (promise: Promise<unknown>) => { done = promise; } } as unknown as PushEvent);
    await done;
  };
  return { shown, push };
}

test('a notice carries the worker\'s badge and keeps its icon; without a badge the icon is the badge', async () => {
  const pc = worker({ home: '/', icon: '/icon.png', badge: '/badge.png', alwaysShow: false });
  await pc.push({ title: 'Ava', body: 'Done', tag: 'chat:ch_a', id: 'n_1' });
  assert.equal(pc.shown[0].options.badge, '/badge.png');
  assert.equal(pc.shown[0].options.icon, '/icon.png');
  const hosted = worker({ home: '/app/', icon: '/app/app-icon.png', alwaysShow: true });
  await hosted.push({ title: 'Ava', body: 'Done', tag: 'chat:ch_a', id: 'n_1' });
  assert.equal(hosted.shown[0].options.badge, '/app/app-icon.png');
});

test('the PC worker names /badge.png, the build copies it, and it is a 96 px PNG', async () => {
  const sw = await readFile(path.join(root, 'src/ui/pwa/sw.ts'), 'utf8');
  assert.match(sw, /badge: '\/badge\.png'/);
  const build = await readFile(path.join(root, 'scripts/build.mjs'), 'utf8');
  assert.match(build, /cp\('assets\/badge\.png', 'app\/ui\/badge\.png'\)/);
  const png = await readFile(path.join(root, 'assets/badge.png'));
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(png.readUInt32BE(16), 96, 'width');
  assert.equal(png.readUInt32BE(20), 96, 'height');
  assert.equal(png[25], 6, 'RGBA: the shape is in the alpha channel');
});
