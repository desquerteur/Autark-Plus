// Orphans after a CLI's end (BEFUND-RUNTIME-JAN §5, 17.11.2026): the tree kill reached a CLI's children only while the
// CLI itself lived; one that ended by itself left its shells, grep and rg running (12 orphans found on 17.11.). A heavy
// lease now ends what its process left behind once it exits; a light one does not. On Windows the real path runs once
// with a real child (a fake CLI that starts `ping -n 600` and exits) – it failed before the fix: the ping lived on.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { orphansOf, Supervisor, type ChildLike } from '../../../src/runtime/system/supervisor.ts';

test('orphansOf: the root\'s children created while it ran – not older processes, not a reused pid\'s later children', () => {
  const root = { pid: 100, since: 10_000, until: 20_000 };
  const list = [
    { pid: 100, parent: 4, created: 10_000 },
    { pid: 201, parent: 100, created: 12_000 }, // bash left behind
    { pid: 202, parent: 201, created: 12_500 }, // its grep: goes with 201's tree
    { pid: 203, parent: 100, created: 5_000 }, // older than the root: another process's child
    { pid: 204, parent: 100, created: 40_000 }, // a later process that reused pid 100
  ];
  assert.deepEqual(orphansOf(list, root), [201]);
});

function fakeChild(pid: number): ChildLike & EventEmitter {
  const child = new EventEmitter() as ChildLike & EventEmitter;
  Object.assign(child, { pid, stdin: null, stdout: null, stderr: null, exitCode: null, kill: () => true });
  return child;
}

test('a heavy lease is reaped when it exits, a light one is not', async () => {
  const reaped: number[] = [];
  const children: Array<ChildLike & EventEmitter> = [];
  const supervisor = new Supervisor({
    spawn: () => { const child = fakeChild(300 + children.length); children.push(child); return child; },
    os: { freemem: () => 8e9, cpuCount: () => 4, setPriority: () => {}, platform: 'win32' },
    killTree: async () => {},
    reapOrphans: async (root) => { reaped.push(root.pid); return 0; },
  });
  supervisor.spawn({ command: 'claude', args: [], owner: 'claude:run_1', kind: 'heavy' });
  supervisor.spawn({ command: 'git', args: [], owner: 'git', kind: 'light' });
  for (const child of children) { (child as { exitCode: number | null }).exitCode = 0; child.emit('exit', 0, null); }
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reaped, [300]);
});

test('Windows, real processes: a CLI that exits by itself leaves no child behind', { skip: process.platform !== 'win32' }, async () => {
  const supervisor = new Supervisor({ log: { warn: () => {} } });
  // detached: outside Node's own job object (a Node parent's children die with it anyway) – like the shells of a CLI
  // that is no Node process. Measured 17.11.: without the reaper this ping still ran 15 s later; with it, gone after ~1 s.
  const script = "const c = require('child_process').spawn('ping', ['-n', '600', '127.0.0.1'], { stdio: 'ignore', detached: true }); console.log(c.pid); setTimeout(() => process.exit(0), 300);";
  const lease = supervisor.spawn({ command: process.execPath, args: ['-e', script], owner: 'claude:test', kind: 'heavy', stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  lease.child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
  await lease.exited;
  const ping = Number(out.trim());
  assert.ok(ping > 0, `the fake CLI printed its child's pid: "${out}"`);
  const alive = () => { try { process.kill(ping, 0); return true; } catch { return false; } };
  try {
    for (let waited = 0; alive() && waited < 30_000; waited += 250) await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(alive(), false, 'the orphaned ping was ended');
  } finally {
    if (alive()) process.kill(ping);
  }
});
