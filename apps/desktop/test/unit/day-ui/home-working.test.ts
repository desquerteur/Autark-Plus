// My day › "Chats that matter" names who works in a chat as the chat header's live line does (ui/day/DayOverview.tsx
// workingOf, ui/chat/ChatHeader.tsx): the chat's live bar (liveRuns) – a split part carries `split`, so an agent whose
// work runs only as split parts is named once, through its group. The component's wiring is checked in its source
// (a .tsx file does not load here).
// Owns: these assertions only. Never: the DOM or rpc.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { LiveRun } from '../../../src/shared/model/chat.ts';
import { liveRuns, workingIds } from '../../../src/ui/chat/live-text.ts';

const source = (file: string) => readFileSync(new URL(`../../../src/ui/${file}`, import.meta.url), 'utf8');

test('Home builds its working entries from the chat header\'s one source', () => {
  const home = source('day/DayOverview.tsx');
  assert.match(home, /workingIds\(chat, liveRuns\(chat\)\)/, 'the live bar');
  assert.match(home, /workingOf,\n/, 'importantChats gets that helper');
});

test('an agent working only as split parts is named once, through its group', () => {
  const part = (idx: number): LiveRun => ({ runId: `run_${idx}`, agentId: 'ag_mira', startedAt: idx,
    split: { id: `sp_${idx}`, groupId: 'sg_home', idx, of: 2, parentRunId: 'run_p', title: `Part ${idx}` } });
  const chat = { id: 'c_home', working: ['ag_mira'], live: [part(1), part(2)] };
  assert.deepEqual(workingIds(chat, liveRuns(chat)), ['ag_mira']);
});
