// B-081: a website – this PC's or another PC's ('remote' panel) – leaves main's spaces (main/workspace-tabs.ts) only by
// a close or by the file itself. The window's layout only orders it; an id closed here never comes back from a stale
// file or a stale layout (the last 100 closes); quitting, a window that goes and a PC that goes offline close nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PersonalTabs, readSpaces, type TabFiles } from '../../../src/main/workspace-tabs.ts';
import type { SideEntry, SideSpaces } from '../../../src/shared/api/workspace-browser.ts';

function memoryFiles(initial?: string): TabFiles & { text?: string; writes: number } {
  const files = {
    text: initial, writes: 0,
    read: () => files.text,
    write: (_file: string, text: string) => { files.text = text; files.writes++; },
  };
  return files;
}

const file = (spaces: SideSpaces) => JSON.stringify({ version: 2, spaces });
const remote = (tab: string, url = `https://${tab}.example/`): SideEntry => ({ id: `remote:dev_b:${tab}`, panel: 'remote', device: 'dev_b', tab, url });
const idsIn = (spaces: SideSpaces | undefined) => Object.fromEntries(Object.entries(spaces ?? {}).map(([key, space]) => [key, space.tabs.map((tab) => tab.id)]));

const START: SideSpaces = {
  global: { shown: 'web-b', tabs: [{ id: 'web-a', url: 'https://a.example/' }, remote('web-x'), { id: 'web-b', url: 'https://b.example/' }, remote('web-y'), { id: 'day', panel: 'day' }] },
  'chat:c': { tabs: [remote('web-z')] },
};

test('a closed id never comes back: a stale reload and a stale window layout leave it out, the next save writes the file without it', () => {
  const files = memoryFiles(file(START));
  const tabs = new PersonalTabs({ file: 'side-tabs.json', files });
  tabs.closed('remote:dev_b:web-x'); // the strip's × on another PC's website, in the middle
  tabs.closed('web-a');
  tabs.closed('remote:dev_b:web-z');
  assert.deepEqual(idsIn(tabs.layout()), { global: ['web-b', 'remote:dev_b:web-y', 'day'] }, 'gone at once; a space left empty goes');

  // A runtime write from a copy noted before the close arrived (or the phone, or an editor) still lists all three.
  files.text = file(START);
  assert.deepEqual(tabs.reload(), { closed: [], navigate: [] });
  assert.deepEqual(idsIn(tabs.layout()), { global: ['web-b', 'remote:dev_b:web-y', 'day'] });
  assert.equal(tabs.restoredUrl('web-a'), undefined, 'no entry waits to load');
  assert.deepEqual(tabs.ids(), ['web-b']);

  // The window's layout built before it heard of the close lists them again: it orders, it never adds.
  tabs.setLayout({ global: { shown: 'web-b', tabs: [{ id: 'day', panel: 'day' }, remote('web-x'), { id: 'web-a' }, remote('web-y'), { id: 'web-b' }] }, 'chat:c': { tabs: [remote('web-z')] } });
  assert.deepEqual(idsIn(tabs.layout()), { global: ['day', 'remote:dev_b:web-y', 'web-b'] });

  tabs.save(new Map([['web-b', 'https://b.example/']]));
  assert.deepEqual(idsIn(readSpaces(files.text)), { global: ['day', 'remote:dev_b:web-y', 'web-b'] }, 'the file is written without them');
  files.text = file(START); // and once more from outside
  tabs.reload();
  assert.ok(!JSON.stringify(tabs.layout()).includes('web-x'));
});

test('setLayout orders remote panels as it orders websites: one the window leaves out stays at its end, one main lacks is not added, a panel follows the window', () => {
  const files = memoryFiles(file(START));
  const tabs = new PersonalTabs({ file: 'side-tabs.json', files });
  // A layout the window built before main's newest one arrived: it lacks web-y and lists an unknown remote panel.
  tabs.setLayout({ global: { tabs: [{ id: 'web-b' }, remote('web-x', 'https://stale.example/'), remote('web-new'), { id: 'work', panel: 'work' }] } });
  assert.deepEqual(idsIn(tabs.layout()), {
    global: ['web-b', 'remote:dev_b:web-x', 'work', 'web-a', 'remote:dev_b:web-y'],
    'chat:c': ['remote:dev_b:web-z'],
  }, 'nothing leaves without a close; day left the window, so it left the file');
  assert.equal(tabs.layout().global!.tabs[1]!.url, 'https://web-x.example/', "main's own entry, not the window's stale copy");
});

test('quit, a window that goes and a PC that goes offline close nothing: every website and remote panel stays in the file', () => {
  const files = memoryFiles(file(START));
  const tabs = new PersonalTabs({ file: 'side-tabs.json', files });
  tabs.shown('web-b');
  const live = new Map([['web-b', 'https://b.example/']]);
  tabs.save(live);
  const saved = files.text;

  tabs.park(live); // the window went: live tabs wait as entries
  assert.deepEqual(idsIn(tabs.layout()), idsIn(START));
  tabs.save(new Map()); // the quit: dispose saves what it holds, then every page closes
  assert.equal(files.text, saved, 'nothing changed, nothing written');
  const restarted = new PersonalTabs({ file: 'side-tabs.json', files });
  assert.deepEqual(idsIn(restarted.layout()), idsIn(START), 'after a restart every tab is there');
  assert.deepEqual(restarted.ids(), ['web-a', 'web-b']);

  // dev_b goes offline: nothing writes the file, its remote panels stay; a reload of the same text closes nothing.
  assert.deepEqual(restarted.reload(), { closed: [], navigate: [] });
  restarted.setLayout(restarted.layout());
  restarted.save(new Map());
  assert.deepEqual(idsIn(readSpaces(files.text)), idsIn(START));
});

test('main remembers the last 100 closes, oldest dropped first', () => {
  const files = memoryFiles(file(START));
  const tabs = new PersonalTabs({ file: 'side-tabs.json', files });
  tabs.closed('remote:dev_b:web-x');
  for (let i = 0; i < 99; i++) tabs.closed(`web-old${i}`);
  tabs.closed('remote:dev_b:web-y'); // the 101st close
  files.text = file(START);
  tabs.reload();
  assert.deepEqual(idsIn(tabs.layout()).global, ['web-a', 'remote:dev_b:web-x', 'web-b', 'day'], 'web-x fell out of the last 100, web-y did not');
});
