// AF-025 – scripts/install-headless.sh (repo root) where a bash exists: the script parses (bash -n), wrong options stop
// it before anything happens, and the files it writes – the autark-headless command, the systemd units (server: own
// user, restart but not on exit 2/3; desktop: user unit) and autark.env (kept across runs, --bind/--port replace their
// part) – come out as expected, into a temp folder. Downloading, systemd and real installs need a Linux machine.
// Owns: these assertions only. Never: runs main, installs anything, or touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'scripts', 'install-headless.sh');
// Windows: Git's bash (System32\bash.exe would be WSL); elsewhere the PATH's.
const bash = process.platform === 'win32'
  ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find((file) => existsSync(file))
  : 'bash';
const skip = !bash || spawnSync(bash, ['-c', 'true']).status !== 0 ? 'no bash on this machine' : false;
const posix = (file: string) => file.replace(/\\/g, '/');

/** Runs `body` in bash after loading the script's functions (everything but the final `main "$@"`). */
function run(body: string): { status: number | null; stdout: string; stderr: string } {
  const text = readFileSync(script, 'utf8');
  assert.ok(text.trimEnd().endsWith('main "$@"'), 'the script ends with its single entry call');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'autark-install-'));
  const lib = path.join(dir, 'lib.sh');
  writeFileSync(lib, text.trimEnd().replace(/main "\$@"$/, ''));
  try {
    const result = spawnSync(bash!, ['-c', `set -euo pipefail; source '${posix(lib)}'; T='${posix(dir)}'; ${body}`], { encoding: 'utf8', timeout: 30_000 });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('install-headless.sh parses and refuses wrong options', { skip }, () => {
  assert.equal(spawnSync(bash!, ['-n', posix(script)], { encoding: 'utf8' }).status, 0);
  for (const args of ['--bind everyone', '--port 12ab', '--repo nothing', '--version latest', '--frobnicate']) {
    const result = run(`parse_args ${args}`);
    assert.equal(result.status, 1, args);
    assert.match(result.stderr, /Error:/, args);
  }
  const ok = run('parse_args --server --version 0.3.6 --bind tailscale --port 47900; echo "$MODE $VERSION $BIND $PORT $REPO"');
  assert.equal(ok.stdout.trim(), 'server v0.3.6 tailscale 47900 desquerteur/OpenAutark');
});

test('server files: the command, a hardened system unit for the autark user, and autark.env', { skip }, () => {
  const layout = 'MODE=server; PREFIX="$T/opt/autark"; DATA="$T/var/lib/autark"; BIN="$T/bin/autark-headless"; UNIT="$T/etc/autark.service"; CONF_DIR="$T/etc/autark"; CONF="$CONF_DIR/autark.env"; BIND_DEFAULT=lan; BIND=; PORT=';
  const result = run(`${layout}; write_conf; write_wrapper; write_unit; bash -n "$BIN" && sh -n "$BIN" && echo SYNTAX_OK; cat "$UNIT"; echo ===; cat "$CONF"; echo ===; cat "$BIN"; echo ===; "$BIN" help; echo "help=$?"`);
  assert.equal(result.status, 0, result.stderr);
  const [, unit, conf, wrapper, help] = /^SYNTAX_OK\n([\s\S]*?)===\n([\s\S]*?)===\n([\s\S]*?)===\n([\s\S]*)$/.exec(result.stdout) ?? [];
  assert.ok(unit, result.stdout);
  assert.match(unit, /^User=autark$/m);
  assert.match(unit, /^ExecStart=".*\/bin\/autark-headless" run$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^RestartPreventExitStatus=2 3$/m);
  assert.match(unit, /^ProtectSystem=full$/m);
  assert.match(unit, /^WantedBy=multi-user\.target$/m);
  assert.match(conf!, /^AUTARK_ARGS="--bind lan --port 47811"$/m);
  assert.match(wrapper!, /--headless --data "\$DATA"/);
  assert.match(wrapper!, /runuser -u "\$SVC_USER"/);
  assert.match(help!, /autark-headless pair/);
  assert.match(help!, /help=0/);
});

test('desktop files: a user unit; autark.env keeps the person\'s choices and --bind/--port replace only their part', { skip }, () => {
  const layout = 'MODE=desktop; PREFIX="$T/opt"; DATA="$T/data"; BIN="$T/bin/autark-headless"; UNIT="$T/systemd/user/autark.service"; CONF_DIR="$T/conf"; CONF="$CONF_DIR/autark.env"; BIND_DEFAULT=localhost';
  const result = run(`${layout}; BIND=; PORT=; write_conf; write_unit; cat "$CONF"; echo ===; echo 'AUTARK_ARGS="--bind localhost --port 47811 --log"' > "$CONF"; BIND=lan; PORT=48000; write_conf; cat "$CONF"; echo ===; BIND=; PORT=; write_conf; cat "$CONF"; echo ===; cat "$UNIT"`);
  assert.equal(result.status, 0, result.stderr);
  const [first, updated, kept, unit] = result.stdout.split('===\n');
  assert.match(first!, /AUTARK_ARGS="--bind localhost --port 47811"/);
  assert.match(updated!, /^AUTARK_ARGS="--log --bind lan --port 48000"$/m);
  assert.equal(kept, updated, 'a run without --bind/--port changes nothing');
  assert.doesNotMatch(unit!, /^User=/m);
  assert.match(unit!, /^WantedBy=default\.target$/m);
  assert.match(unit!, /^RestartPreventExitStatus=2 3$/m);
});
