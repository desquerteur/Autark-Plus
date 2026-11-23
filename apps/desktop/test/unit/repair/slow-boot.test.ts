// 18.11.2026 (live, a maintainer's PC): after Windows' 02:00 update restarts the PC was cold at 08:17, the host killed three starts that
// missed its 30 s ready wait, the fourth start became the repair screen ("crash_loop") and the company stood still for 1.5 h until
// someone pressed Retry. Now: the first ready wait is 90 s and a start that missed it gets two and then three times as long
// (a ready start resets that), and a crash loop on the repair screen starts normally by itself after two minutes, at most twice
// an hour.
// Owns: these assertions only. Never: a real process or a real clock (fake timers, a scripted host).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppInfo } from '../../../src/shared/api/host-bridge.ts';
import { HOST_BRIDGE_PROTOCOL } from '../../../src/shared/api/host-bridge.ts';
import { BOOT_TIMEOUT_MS, RuntimeHost } from '../../../src/main/runtime-host.ts';
import type { RuntimeChild } from '../../../src/main/runtime-host.ts';
import { BootJournal } from '../../../src/runtime/repair/journal.ts';
import { AUTO_RETRY_MS, RepairService } from '../../../src/runtime/repair/service.ts';
import type { Host } from '../../../src/runtime/host.ts';
import type { StartProblem } from '../../../src/shared/model/repair.ts';

const TOKEN = 'b'.repeat(64);
const APP: AppInfo = { version: '0.3.10', packaged: false, resourcesDir: '/app', dataDir: '/data', executable: '/electron' };

class FakeChild implements RuntimeChild {
  readonly stdout = null;
  readonly stderr = null;
  killed = false;
  private onMessage: ((message: unknown) => void) | null = null;
  private onExit: ((code: number) => void) | null = null;
  postMessage() {}
  on(event: 'message' | 'exit', listener: ((message: unknown) => void) | ((code: number) => void)) {
    if (event === 'message') this.onMessage = listener as (message: unknown) => void;
    else this.onExit = listener as (code: number) => void;
    return this;
  }
  kill() { this.killed = true; setImmediate(() => this.onExit?.(0)); return true; }
  ready() { this.onMessage?.({ type: 'ready', token: TOKEN, protocol: HOST_BRIDGE_PROTOCOL }); }
}

function harness() {
  const children: FakeChild[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextTimer = 1;
  const lines: string[] = [];
  const host = new RuntimeHost<string>({
    fork: () => { const child = new FakeChild(); children.push(child); return child; },
    createChannel: () => ({ port1: 'a', port2: 'b' }),
    modulePath: '/app/app/runtime.mjs', env: {}, token: TOKEN, app: APP, handle: async () => ({ ok: true }),
    onStatus: () => undefined, logLine: (line) => lines.push(line),
    setTimer: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { timers.delete(id as number); },
  });
  /** The boot timer of the newest child (the one that waits for `ready`). */
  const boot = () => [...timers.values()].filter((t) => t.ms >= BOOT_TIMEOUT_MS).at(-1);
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  return { host, children, timers, lines, boot, flush };
}

test('the ready wait is 90 s, then 2x and 3x after starts in a row that missed it, and a ready start resets it', async () => {
  const h = harness();
  h.host.start();
  assert.equal(h.boot()?.ms, BOOT_TIMEOUT_MS);
  assert.equal(BOOT_TIMEOUT_MS, 90_000);
  for (const times of [2, 3, 3]) {
    const missed = h.boot()!;
    missed.fn();
    await h.flush();
    // the restart timer (backoff) fires the next start
    const restart = [...h.timers.values()].find((t) => t.ms < BOOT_TIMEOUT_MS);
    assert.ok(restart, 'a restart is planned');
    h.timers.clear();
    restart!.fn();
    assert.equal(h.boot()?.ms, BOOT_TIMEOUT_MS * times, `the next wait is ${times}x`);
  }
  assert.equal(h.lines.filter((l) => /did not become ready/.test(l)).length, 3);
  h.children.at(-1)!.ready();
  const last = h.children.length;
  h.children.at(-1)!.kill();
  await h.flush();
  const restart = [...h.timers.values()].find((t) => t.ms < BOOT_TIMEOUT_MS);
  h.timers.clear();
  restart!.fn();
  assert.equal(h.children.length, last + 1);
  assert.equal(h.boot()?.ms, BOOT_TIMEOUT_MS, 'after a ready start the wait is the first one again');
});

function repairSetup(t: { after(fn: () => void): void }, autoRetryMs?: number) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wf-slow-boot-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  let clock = 1_000_000;
  const journal = new BootJournal({ dataDir: dir, now: () => clock });
  const problem: StartProblem = { code: 'crash_loop', version: '0.3.10', attempts: 3, at: clock };
  journal.begin('0.3.10');
  let restarts = 0;
  const host = { kind: 'electron', app: { version: '0.3.10', packaged: true, resourcesDir: dir, dataDir: dir, executable: 'x' }, restart: async () => { restarts++; }, openPath: async () => undefined } as unknown as Host;
  const logs: string[] = [];
  const log = { debug() {}, info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error() {} };
  const make = (p: StartProblem | null = problem) => new RepairService({ dataDir: dir, version: '0.3.10', host, journal, problem: p ?? undefined, log, now: () => clock, autoRetryMs });
  return { dir, make, restarts: () => restarts, logs, advance: (ms: number) => { clock += ms; } };
}

test('a crash loop on the repair screen retries by itself after the wait, twice an hour at most', async (t) => {
  const s = repairSetup(t, 20);
  s.make();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(s.restarts(), 1, 'the first automatic retry');
  assert.ok(s.logs.includes('repair: automatic retry after a crash loop'));
  s.advance(60_000);
  s.make();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(s.restarts(), 2, 'the second one, a minute later');
  s.advance(60_000);
  s.make();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(s.restarts(), 2, 'a third inside the hour stays on the repair screen');
  assert.ok(s.logs.some((l) => /crash loop stays/.test(l)));
  s.advance(3_600_000);
  s.make();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(s.restarts(), 3, 'an hour later it may try again');
  assert.ok(existsSync(path.join(s.dir, 'boot-auto-retry.json')));
  assert.equal((JSON.parse(readFileSync(path.join(s.dir, 'boot-auto-retry.json'), 'utf8')) as number[]).length, 1);
});

test('an upgrade problem or a normal runtime never retries by itself; the default wait is two minutes', async (t) => {
  const s = repairSetup(t, 20);
  s.make({ code: 'migration_failed', version: '0.3.10', detail: 'x', at: 1 });
  s.make(null);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(s.restarts(), 0);
  assert.equal(AUTO_RETRY_MS, 120_000);
});
