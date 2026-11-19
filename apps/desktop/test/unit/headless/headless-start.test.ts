// AF-025 – one real headless start from source (node src/runtime/cli.ts --headless, fake engine, a fresh temp data
// folder, bound to this computer so the test needs no network): the runtime comes up without any window, prints the
// banner with a one-time pairing link and code but no owner token, `pair` gets a new code from it, the code pairs a
// browser over HTTP, and a second start on the same folder ends with exit code 3.
// Owns: these assertions only. Never: touches the person's data folders (temp dir only) or the network beyond 127.0.0.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cli = path.join(root, 'src', 'runtime', 'cli.ts');

function waitFor(child: ChildProcess, read: () => string, pattern: RegExp, ms: number): Promise<RegExpMatchArray> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${pattern} within ${ms} ms:\n${read()}`)), ms);
    const check = () => { const match = read().match(pattern); if (match) { clearTimeout(timer); resolve(match); } };
    child.stdout?.on('data', check);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`runtime exited (${code}):\n${read()}`)); });
  });
}

test('headless start: no window, pairing link + code on the console, pair, one runtime per folder', { timeout: 120_000 }, async () => {
  const data = mkdtempSync(path.join(os.tmpdir(), 'autark-headless-'));
  const env = { ...process.env, WORKFORCE_TEST_DATA: data, AUTARK_PAIR_COMMAND: 'autark-headless pair' };
  const args = [cli, '--headless', '--data', data, '--fake', '--port', '0', '--bind', 'localhost', '--resources', path.join(root, 'resources'), '--ui', path.join(data, 'no-ui')];
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout!.on('data', (chunk) => { out += chunk; });
  child.stderr!.on('data', (chunk) => { err += chunk; });
  try {
    const [, port] = await waitFor(child, () => out + err, /Web: +http:\/\/localhost:(\d+)/, 90_000);
    await waitFor(child, () => out, /-{64}\n[\s\S]*-{64}\n/, 30_000).catch(() => undefined);
    assert.match(out, /running headless \(no window\)/);
    assert.match(out, new RegExp(`Link: {2}http://localhost:${port}/#pair=[A-Za-z0-9_-]{20,}`));
    assert.match(out, /Code: {2}\d{3} \d{3}/);
    assert.match(out, /New pairing code at any time: {2}autark-headless pair/);
    const note = JSON.parse(readFileSync(path.join(data, 'runtime.json'), 'utf8')) as { port: number; token: string };
    assert.equal(String(note.port), port);
    assert.ok(!out.includes(note.token) && !err.includes(note.token), 'the owner token never reaches the console');
    assert.doesNotMatch(out, /^\{"port"/m, 'no token line in headless mode');

    const pair = spawnSync(process.execPath, [cli, 'pair', '--data', data], { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(pair.status, 0, pair.stderr);
    const code = /Code: {2}(\d{3}) (\d{3})/.exec(pair.stdout);
    assert.ok(code, pair.stdout);
    assert.ok(!pair.stdout.includes(note.token));

    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1, method: 'pwa.exchange', params: { secret: `${code[1]}${code[2]}`, name: 'Test browser' } }),
    });
    const exchanged = await response.json() as { result?: { token: string; deviceId: string }; error?: unknown };
    assert.ok(exchanged.result?.token && exchanged.result.deviceId, JSON.stringify(exchanged.error));

    const second = spawnSync(process.execPath, [cli, '--headless', '--data', data, '--fake', '--port', '0'], { cwd: root, env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(second.status, 3, second.stderr);
    assert.match(second.stderr, /already runs on/);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => { if (child.exitCode !== null) resolve(undefined); else child.once('exit', resolve); setTimeout(resolve, 8000).unref(); });
    rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
