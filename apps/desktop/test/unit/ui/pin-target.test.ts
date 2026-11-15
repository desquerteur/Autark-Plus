// B-081: where a pin from the browser's Pin button goes (ui/workspace/pin.ts) – the chat of the tab's chat area, else a
// chat that talks on this device (the open one first), else the open chat; a voice conversation takes it as a line of
// its call, a realtime call as a typed line, otherwise it is appended to the chat's draft on a line of its own.
// Owns: these assertions only. Never: Electron, a runtime or a real window.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PagePick } from '../../../src/shared/model/page-pick.ts';
import { rpc } from '../../../src/ui/lib/rpc.ts';

(rpc as unknown as { call: unknown }).call = async () => ({ ok: true }); // the draft's save
const { pinTarget, pinToChat } = await import('../../../src/ui/workspace/pin.ts');

test('pinTarget: the tab’s chat area first, then a talking chat (the open one first), then the open chat', () => {
  const quiet = { open: 'ch_open', talking: [] as string[], realtime: null };
  assert.deepEqual(pinTarget({ space: 'chat:ch_area' }, quiet), { chatId: 'ch_area', via: 'draft' }, 'a chat area’s tab: that chat');
  assert.deepEqual(pinTarget({ space: 'chat:ch_area' }, { ...quiet, talking: ['ch_area'] }), { chatId: 'ch_area', via: 'call' });
  assert.deepEqual(pinTarget({ space: 'chat:ch_area' }, { ...quiet, realtime: 'ch_area' }), { chatId: 'ch_area', via: 'realtime' });
  assert.deepEqual(pinTarget({ space: 'global' }, quiet), { chatId: 'ch_open', via: 'draft' }, 'global: the open chat');
  assert.deepEqual(pinTarget({ space: 'global' }, { ...quiet, talking: ['ch_x', 'ch_open'] }), { chatId: 'ch_open', via: 'call' }, 'the open chat when it talks');
  assert.deepEqual(pinTarget({ space: 'global' }, { ...quiet, talking: ['ch_x', 'ch_y'] }), { chatId: 'ch_x', via: 'call' }, 'else the listening one');
  assert.deepEqual(pinTarget({ space: 'global' }, { open: null, talking: [], realtime: 'ch_rt' }), { chatId: 'ch_rt', via: 'realtime' });
  assert.deepEqual(pinTarget({ space: 'agent:ag_ada' }, quiet), { chatId: 'ch_open', via: 'draft' }, 'an agent’s area: like global');
  assert.equal(pinTarget({}, { open: null, talking: [] }), null, 'no chat at all');
});

test('pinToChat: no call here – the pin lands in the open chat’s draft, each pin on a line of its own', async () => {
  const { route } = await import('../../../src/ui/lib/router.ts');
  const { draftFor, updateDraft } = await import('../../../src/ui/chat/composer/draft.ts');
  route.value = { view: 'chat', id: 'ch_pin' }; // the open chat
  updateDraft('ch_pin', { text: 'make this smaller ' });
  const pick: PagePick = { tab: 'web-1', url: 'https://shop.example/cart', selector: 'button.pay', tag: 'button', box: { x: 1, y: 2, width: 80, height: 32 }, styles: {} };
  pinToChat('web-1', pick);
  pinToChat('web-1', { ...pick, selector: 'div.total' });
  assert.equal(draftFor('ch_pin').peek().text, [
    'make this smaller',
    'Pinned on shop.example/cart (tab web-1):', 'button · button.pay', '80×32 at 1,2',
    'Pinned on shop.example/cart (tab web-1):', 'button · div.total', '80×32 at 1,2 ',
  ].join('\n'));
});
