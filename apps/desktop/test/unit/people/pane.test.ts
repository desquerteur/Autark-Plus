// 18.11.2026: tabs shared with a person (src/runtime/people/rpc-pane.ts). A tab is shared by being in a chat's area
// (chat:<id> of side-tabs.json): tabs.get gives a person only the websites of the areas of their chats, side.pull /
// side.nav work only on such a tab (another one is 'not found'), and tabs.changed reaches them filtered the same way;
// nothing else of the 'system' topic does.
// Owns: these assertions only. Never: Electron, a real pane or a linked PC.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PaneTabs } from '../../../src/shared/api/methods-tabs.ts';
import type { HostOps } from '../../../src/shared/api/host-bridge.ts';
import { writeSideTabs, sideTabsFile } from '../../../src/runtime/root/side-tabs.ts';
import { announcePane } from '../../../src/runtime/devices/sync/tabs.ts';
import { peopleRig, settle } from './rig.ts';

const code = (error: unknown) => (error as { code?: string }).code;

test('a person sees and works in the tabs of their chats\' areas, nothing else', async (t) => {
  const r = peopleRig();
  t.after(() => r.cleanup());
  const navs: Array<HostOps['sideNav']['args']> = [];
  r.services.host = { ...r.services.host, sideView: {
    cast: async () => ({ ok: true as const, page: { url: 'https://shared.example/', title: 'Shared', back: false, forward: false, loading: false } }),
    input: async () => ({ ok: true as const }),
    nav: async (args: HostOps['sideNav']['args']) => { navs.push(args); return { ok: true as const }; },
  } } as never;
  const anna = await r.join('Anna Berg');
  const mine = r.chats.create({ agentIds: ['ag_research'], people: [anna.person.id], createdBy: 'human', title: 'Mine' });
  const other = r.chats.create({ agentIds: ['ag_research'], createdBy: 'human', title: 'Not mine' });
  writeSideTabs(sideTabsFile(r.services.paths.data), {
    global: { tabs: [{ id: 'web-0000', url: 'https://owner.example/' }] },
    [`chat:${mine.id}`]: { shown: 'web-1111', tabs: [{ id: 'web-1111', url: 'https://shared.example/' }, { id: 'notes:x', panel: 'notes', conversationId: mine.id }] },
    [`chat:${other.id}`]: { tabs: [{ id: 'web-2222', url: 'https://other.example/' }] },
  });

  const pane = await anna.client.call<PaneTabs>('tabs.get');
  assert.deepEqual(Object.keys(pane.spaces), [`chat:${mine.id}`], 'only her chat\'s area');
  assert.deepEqual(pane.spaces[`chat:${mine.id}`].tabs.map((tab) => [tab.panel, tab.tab, tab.url]), [['remote', 'web-1111', 'https://shared.example/']], 'its websites only');

  await anna.client.call('side.nav', { tab: 'web-1111', action: 'reload' });
  assert.deepEqual(navs, [{ tab: 'web-1111', action: 'reload' }]);
  const pulled = await anna.client.call<{ state: { url: string } }>('side.pull', { tab: 'web-1111' });
  assert.equal(pulled.state.url, 'https://shared.example/');
  for (const tab of ['web-0000', 'web-2222']) {
    await assert.rejects(anna.client.call('side.nav', { tab, action: 'reload' }), (error: unknown) => code(error) === 'not_found' || /not shared/.test(String(error)), tab);
  }
  await assert.rejects(anna.client.call('side.pull', { tab: 'web-1111', device: 'dev_elsewhere' }), /not shared/);
  await assert.rejects(anna.client.call('tabs.set', { spaces: {} }));
  assert.equal(navs.length, 1, 'nothing ran for the others');

  await anna.client.call('events.subscribe', { topics: ['system'] });
  announcePane(r.services);
  r.services.settings.update({ profile: { name: 'Mara' } });
  await settle();
  const heard = anna.client.events('tabs.changed').map((event) => event.data as PaneTabs);
  assert.equal(heard.length, 1);
  assert.deepEqual(Object.keys(heard[0].spaces), [`chat:${mine.id}`]);
  assert.equal(anna.client.events('settings.updated').length, 0, 'nothing else of the system topic');
});
