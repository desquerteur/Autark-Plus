// F03 (16.11.2026, main/broker-setup.ts): the broker's setup at an interactive start still runs detached and is never
// waited for, but its end is read – exit 0 installed, 1223 the Windows prompt got no Yes, any other code or a start error
// failed – logged in main.log and reported once (main forwards it to the runtime as 'broker.setup'). The installer itself
// turns a No at the Windows prompt into exit 1223.
// Owns: these assertions only. Never: PowerShell, UAC or a real service.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DECLINED_EXIT, setupBroker, setupResult, type BrokerSetup, type BrokerSetupDeps } from '../../../src/main/broker-setup.ts';

const ROOT = 'C:\\Users\\me\\AppData\\Local\\Programs\\Autark\\resources\\app.asar';
const SCRIPT = 'C:\\Users\\me\\AppData\\Local\\Programs\\Autark\\resources\\app.asar.unpacked\\resources\\broker\\install.ps1';

function rig(patch: Partial<BrokerSetupDeps> = {}) {
  const child = new EventEmitter();
  const lines: string[] = [];
  const reports: BrokerSetup[] = [];
  const deps: BrokerSetupDeps = {
    platform: 'win32', packaged: true, testMode: false, background: false, root: ROOT, exe: 'C:\\Autark\\Autark.exe',
    env: { SystemRoot: 'C:\\Windows' }, exists: (file) => file === SCRIPT, start: () => child,
    log: (line) => lines.push(line), report: (setup) => reports.push(setup), ...patch,
  };
  return { deps, child, lines, reports };
}

test('the exit code tells installed, declined (1223) and failed apart', () => {
  assert.deepEqual(setupResult(0, SCRIPT), { state: 'installed', script: SCRIPT });
  assert.deepEqual(setupResult(DECLINED_EXIT, SCRIPT), { state: 'declined', script: SCRIPT });
  assert.equal(DECLINED_EXIT, 1223);
  assert.deepEqual(setupResult(1, SCRIPT), { state: 'failed', code: 1, script: SCRIPT });
  assert.deepEqual(setupResult(null, SCRIPT), { state: 'failed', script: SCRIPT }, 'ended without a code');
});

for (const [code, state, logged] of [
  [0, 'installed', 'desktop broker setup: installed and running'],
  [1223, 'declined', 'desktop broker setup: the Windows prompt got no Yes'],
  [1, 'failed', 'desktop broker setup failed (exit 1)'],
] as const) {
  test(`a setup that ends with exit ${code} is logged and reported once as ${state}; the start is not waited for`, () => {
    const r = rig();
    assert.equal(setupBroker(r.deps), true);
    assert.equal(r.reports.length, 0, 'nothing yet: the app goes on while Windows asks');
    r.child.emit('exit', code, null);
    r.child.emit('exit', code, null);
    assert.equal(r.reports.length, 1);
    assert.equal(r.reports[0]!.state, state);
    assert.equal(r.reports[0]!.script, SCRIPT);
    assert.ok(r.lines.at(-1)!.startsWith(logged), r.lines.at(-1));
  });
}

test('a start error (no PowerShell) is a failed setup with its message, never a thrown error', () => {
  const r = rig();
  assert.equal(setupBroker(r.deps), true);
  r.child.emit('error', new Error('spawn powershell.exe ENOENT'));
  r.child.emit('exit', null, null);
  assert.deepEqual(r.reports, [{ state: 'failed', script: SCRIPT }]);
  assert.equal(r.lines.at(-1), 'desktop broker setup failed: spawn powershell.exe ENOENT');
});

test('no setup runs, so nothing is reported, in the background, unpackaged, in test mode or off Windows', () => {
  for (const patch of [{ background: true }, { packaged: false }, { testMode: true }, { platform: 'linux' }]) {
    const r = rig(patch);
    assert.equal(setupBroker(r.deps), false);
    assert.deepEqual(r.reports, []);
  }
});

test('the installer answers a No at the Windows prompt with exit 1223 and reads the elevated exit code', () => {
  const script = readFileSync(path.join('resources', 'broker', 'install.ps1'), 'utf8');
  assert.match(script, /\$elevate\.Verb = 'runas'/);
  assert.match(script, /\[Diagnostics\.Process\]::Start\(\$elevate\)/);
  assert.match(script, /NativeErrorCode -eq 1223\) \{ exit 1223 \}/);
  assert.match(script, /\$process\.WaitForExit\(\)\r?\n\s*exit \$process\.ExitCode/);
});
