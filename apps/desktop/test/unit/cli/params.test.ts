// B-080 (live 05.–07.11.2026: 48 "params are not valid JSON"): `wf call` reads its params as JSON first, then in the
// shapes Windows shells deliver – cmd's outer single quotes, Windows PowerShell 5.1's dropped inner double quotes
// (wf-cli/commands.ts parseParams); anything else names the stdin form.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParams } from '../../../src/runtime/wf-cli/commands.ts';

test('valid JSON stays as it is', () => {
  assert.deepEqual(parseParams('{"match":"tasks","x":"a b"}', 'rpc.methods'), { match: 'tasks', x: 'a b' });
  assert.deepEqual(parseParams('[1, "two", null]', 'x.y'), [1, 'two', null]);
  assert.equal(parseParams('"it\'s"', 'x.y'), "it's");
});

test('cmd: one pair of outer single quotes is dropped', () => {
  assert.deepEqual(parseParams('\'{"id":"task_1"}\'', 'tasks.get'), { id: 'task_1' });
});

test('Windows PowerShell 5.1: bare keys and words are quoted, true, false, null and numbers stay', () => {
  assert.deepEqual(parseParams('{match:tasks}', 'rpc.methods'), { match: 'tasks' });
  assert.deepEqual(parseParams('{mine:true,search:Offsite-Backup-Pull,status:[done],limit:5}', 'tasks.list'), { mine: true, search: 'Offsite-Backup-Pull', status: ['done'], limit: 5 });
  assert.deepEqual(parseParams('{match:tasks,x:a b}', 'rpc.methods'), { match: 'tasks', x: 'a b' });
  assert.deepEqual(parseParams("'{id:task_1,n:-2.5,off:false,none:null}'", 'tasks.get'), { id: 'task_1', n: -2.5, off: false, none: null });
});

test('what is no JSON in any shape names what arrived and the stdin form', () => {
  assert.throws(() => parseParams('{url:https://x}', 'web.fetch'), (error: Error & { code?: string }) => {
    assert.equal(error.message, "The params arrived as {url:https://x} – no JSON. In Windows PowerShell they go on stdin: '<json>' | wf call web.fetch -");
    return true;
  });
  assert.throws(() => parseParams(`{a:${'b'.repeat(200)}`, 'x.y'), (error: Error) => {
    assert.ok(error.message.startsWith(`The params arrived as {a:${'b'.repeat(77)} – no JSON.`), error.message);
    return true;
  });
});

test('B-080 review: a spaced "," or ":" may be prose inside a value – no repair, the stdin form instead of a cut message', () => {
  // PowerShell 5.1's shape of '{"conversationId":"c1","body":"Done, next: tests"}' – once read as {…,"body":"Done","next":"tests"}
  assert.throws(() => parseParams('{conversationId:c1,body:Done, next: tests}', 'chat.send'), (error: Error) => {
    assert.equal(error.message, "The params arrived as {conversationId:c1,body:Done, next: tests} – no JSON. In Windows PowerShell they go on stdin: '<json>' | wf call chat.send -");
    return true;
  });
  assert.throws(() => parseParams('{mine: true, limit: 5}', 'tasks.list'), /wf call tasks\.list -$/, 'spaced JSON without quotes: the stdin form too');
  assert.deepEqual(parseParams('{"mine": true, "limit": 5}', 'tasks.list'), { mine: true, limit: 5 }, 'real JSON keeps its spaces');
  assert.deepEqual(parseParams('{x:a b}', 'x.y'), { x: 'a b' }, 'a space inside a value, none beside a separator: repaired');
});
