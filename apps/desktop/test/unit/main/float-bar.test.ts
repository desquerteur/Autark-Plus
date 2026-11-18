// Owner 18.11.2026: the floating to-do button (src/main/float-bar.ts, float-bar-window.ts readAction) with a fake window
// and a fake RPC: the dot, panel and tab stay inside the work area; opening takes a screenshot; Send uploads every shot
// and posts one quick task with them; a failed post keeps the words, the shots and the clientId (a retry never makes a
// second task); Call opens the picked agent's 1:1 with its call asked for, a task without an agent opens the task;
// dictation adds the heard words; the page's JSON is checked before it becomes an action.
// Owns: these assertions only. Never: Electron or real windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOT, FloatBar, PANEL_H, PANEL_W, TAB_W, inside, panelAt, tabAt, type FloatDeps, type FloatLook, type FloatPlace, type Rect } from '../../../src/main/float-bar.ts';
import { readAction } from '../../../src/main/float-bar-window.ts';
import type { NavigateRequest } from '../../../src/shared/api/desktop.ts';

const AREA: Rect = { x: 0, y: 0, width: 1920, height: 1040 };

function rig(options: { fail?: number; assignee?: { kind: string; id?: string }; kept?: FloatPlace; heard?: string } = {}) {
  let bounds: Rect = { x: 0, y: 0, width: DOT, height: DOT };
  const looks: FloatLook[] = [];
  const calls: Array<{ method: string; params: any }> = [];
  const opened: NavigateRequest[] = [];
  let saved: FloatPlace | null = null;
  let failures = options.fail ?? 0;
  let shots = 0;
  const deps: FloatDeps = {
    rpc: {
      call: (async (method: string, params: any) => {
        calls.push({ method, params });
        if (method === 'files.upload') return { id: `f${calls.length}`, name: params.name, mime: params.mime, size: 1, createdAt: 0 };
        if (method === 'voice.transcribe') return { text: options.heard ?? 'fix the header' };
        if (method === 'tasks.quickCreate') {
          if (failures-- > 0) throw new Error('runtime away');
          const who = options.assignee ?? { kind: 'agent', id: 'ag_konrad' };
          return { task: { id: 'task_1', assigneeKind: who.kind, ...(who.id ? { assigneeId: who.id } : {}) } };
        }
        if (method === 'chats.direct') return { id: 'ch_konrad' };
        throw new Error(`unexpected ${method}`);
      }) as FloatDeps['rpc']['call'],
    },
    shot: async () => ({ data: new Uint8Array([++shots]), mime: 'image/jpeg', thumb: `data:image/jpeg;base64,${shots}` }),
    load: () => options.kept ?? null,
    save: (place) => { saved = place; },
    open: (request) => { opened.push(request); },
    primaryArea: () => AREA,
    log: () => {},
  };
  const bar = new FloatBar(deps, {
    bounds: () => bounds,
    setBounds: (rect) => { bounds = rect; },
    workArea: () => AREA,
    show: (look) => { looks.push(look); },
  });
  return { bar, calls, opened, looks, bounds: () => bounds, saved: () => saved };
}

test('placement: the panel opens towards the middle, the tab sits on the nearest edge, all inside the work area', () => {
  const nearRight: Rect = { x: 1900, y: 1020, width: DOT, height: DOT };
  const panel = panelAt(nearRight, AREA);
  assert.deepEqual(panel, { x: AREA.width - PANEL_W, y: AREA.height - PANEL_H, width: PANEL_W, height: PANEL_H });
  const tab = tabAt({ x: 1800, y: 500, width: DOT, height: DOT }, AREA);
  assert.equal(tab.x, AREA.width - TAB_W);
  assert.equal(tabAt({ x: 40, y: 500, width: DOT, height: DOT }, AREA).x, 0);
  assert.deepEqual(inside({ x: -50, y: 5000, width: 10, height: 10 }, AREA), { x: 0, y: 1030, width: 10, height: 10 });
});

test('a first start shows the dot inside the primary work area; a kept tab comes back as a tab', () => {
  const fresh = rig();
  assert.deepEqual(fresh.looks, ['dot']);
  assert.ok(fresh.bounds().x + DOT <= AREA.width && fresh.bounds().width === DOT);
  const kept = rig({ kept: { x: 1800, y: 300, look: 'tab' } });
  assert.deepEqual(kept.looks, ['tab']);
  assert.equal(kept.bounds().width, TAB_W);
});

test('open takes a screenshot; Send uploads it and posts one quick task; the bar goes back to the dot', async () => {
  const { bar, calls, opened } = rig();
  const view = await bar.act({ act: 'open' });
  assert.equal(view.look, 'panel');
  assert.equal(view.shots.length, 1);
  await bar.act({ act: 'shot' });
  const done = await bar.act({ act: 'send', text: 'The header looks broken here' });
  assert.equal(done.look, 'dot');
  assert.equal(done.done, true);
  assert.deepEqual(done.shots, []);
  const post = calls.find((call) => call.method === 'tasks.quickCreate')!;
  assert.equal(post.params.text, 'The header looks broken here');
  assert.deepEqual(post.params.attachments.map((file: any) => file.name), ['screen-1.jpg', 'screen-2.jpg']);
  assert.equal(post.params.target, undefined); // Autark picks the owner
  assert.deepEqual(opened, []); // Send alone opens nothing
});

test('a failed post keeps everything and its clientId; the retry posts the same id', async () => {
  const { bar, calls } = rig({ fail: 1 });
  await bar.act({ act: 'open' });
  const failed = await bar.act({ act: 'send', text: 'do it' });
  assert.equal(failed.look, 'panel');
  assert.match(failed.note ?? '', /Not sent/);
  assert.equal(failed.shots.length, 1);
  await bar.act({ act: 'send', text: 'do it' });
  const ids = calls.filter((call) => call.method === 'tasks.quickCreate').map((call) => call.params.clientId);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

test('Call opens the picked agent\'s 1:1 with its call; without an agent it opens the task', async () => {
  const agent = rig();
  await agent.bar.act({ act: 'send', text: 'call me about the site', call: true });
  assert.deepEqual(agent.calls.find((call) => call.method === 'chats.direct')?.params, { memberId: 'ag_konrad' });
  assert.deepEqual(agent.opened, [{ conversationId: 'ch_konrad', call: true }]);
  const human = rig({ assignee: { kind: 'human' } });
  await human.bar.act({ act: 'send', text: 'remind me', call: true });
  assert.deepEqual(human.opened, [{ taskId: 'task_1' }]);
});

test('nothing to post asks for words; dictation adds the heard words', async () => {
  const { bar, calls } = rig();
  const empty = await bar.act({ act: 'send', text: '  ' });
  assert.match(empty.note ?? '', /what should be done/);
  assert.equal(calls.length, 0);
  await bar.act({ act: 'text', text: 'Please' });
  const heard = await bar.act({ act: 'hear', wav: Buffer.alloc(2000).toString('base64') });
  assert.equal(heard.text, 'Please fix the header');
});

test('fold and unfold keep the place; the place is saved', async () => {
  const { bar, bounds, saved } = rig();
  await bar.act({ act: 'fold' });
  assert.equal(bounds().width, TAB_W);
  assert.equal(saved()?.look, 'tab');
  const back = await bar.act({ act: 'unfold' });
  assert.equal(back.look, 'dot');
  assert.equal(bounds().width, DOT);
  assert.equal(saved()?.look, 'dot');
});

const WAV = Buffer.alloc(4000).toString('base64');

test('a hold sends at the release: the hold shot and the heard words, without opening anything', async () => {
  const { bar, calls, looks } = rig();
  await bar.act({ act: 'hold' });
  const done = await bar.act({ act: 'quick', wav: WAV });
  assert.equal(done.look, 'dot');
  assert.equal(done.done, true);
  assert.ok(!looks.includes('panel'));
  const post = calls.find((call) => call.method === 'tasks.quickCreate')!;
  assert.equal(post.params.text, 'fix the header');
  assert.deepEqual(post.params.attachments.map((file: any) => file.name), ['screen-1.jpg']);
});

test('a hold keeps an open draft apart; nothing heard opens the panel with the hold shot', async () => {
  const kept = rig();
  await kept.bar.act({ act: 'open' });
  await kept.bar.act({ act: 'text', text: 'my draft' });
  await kept.bar.act({ act: 'close' });
  await kept.bar.act({ act: 'hold' });
  await kept.bar.act({ act: 'quick', wav: WAV });
  const after = kept.bar.view();
  assert.equal(after.text, 'my draft'); // the panel's draft stays for later
  assert.equal(after.shots.length, 1);
  const silent = rig({ heard: '' });
  await silent.bar.act({ act: 'hold' });
  const opened = await silent.bar.act({ act: 'quick', wav: WAV });
  assert.equal(opened.look, 'panel');
  assert.equal(opened.shots.length, 1);
  assert.match(opened.note ?? '', /Nothing heard/);
  assert.equal(silent.calls.some((call) => call.method === 'tasks.quickCreate'), false);
});

test('a drag keeps the look\'s own size even when the window reports a grown one', async () => {
  const { bar, bounds } = rig();
  await bar.act({ act: 'move', x: 500, y: 300 });
  assert.deepEqual(bounds(), { x: 500, y: 300, width: DOT, height: DOT });
  await bar.act({ act: 'moved' });
  const reopened = await bar.act({ act: 'open' });
  assert.equal(reopened.look, 'panel');
  assert.equal(bounds().width, PANEL_W);
});

test('the page\'s JSON becomes an action only when it has the right shape', () => {
  assert.deepEqual(readAction({ act: 'send', text: 'x', call: true }), { act: 'send', text: 'x', call: true });
  assert.deepEqual(readAction({ act: 'move', x: 1, y: 2 }), { act: 'move', x: 1, y: 2 });
  assert.equal(readAction({ act: 'move', x: 'a', y: 2 }), null);
  assert.equal(readAction({ act: 'rm -rf' }), null);
  assert.equal(readAction(null), null);
  assert.equal(readAction({ act: 'send' }), null);
});
