// B-080 (live 05.–08.11.2026: 81 of 91 PowerShell commands failed in cmd.exe): shell.exec runs in
// PowerShell itself on Windows (tools/builtin/files.ts defaultShell, windowsShell) – variables, umlauts, a here-string
// with \" piped into python, an umlaut piped into a native program, cmd syntax through cmd /c, and a failing cmdlet's
// error as plain text. B-080 wave 3: PowerShell 7 where the engines' pwsh is found (else Windows PowerShell 5.1 with the
// preamble), the command as UTF-16 base64 in a script block after the preamble (windowsScript) – a parse error comes back
// UTF-8, and the exit codes stay as -Command gives them.
// Owns: these assertions only. Never: runs anything but powershell.exe/pwsh.exe, cmd.exe, python and this node on this PC.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../../../src/runtime/tools/builtin/command.ts';
import { defaultShell, WINDOWS_PREAMBLE, windowsScript, windowsShell } from '../../../src/runtime/tools/builtin/files.ts';
import type { ToolContext } from '../../../src/runtime/tools/types.ts';

const WINDOWS = { skip: process.platform !== 'win32' ? 'Windows PowerShell' : undefined, timeout: 60_000 };

function ctx(): ToolContext {
  return {
    agent: { id: 'ag_a', name: 'Ada' }, runId: 'r1', mode: 'coding', signal: new AbortController().signal, status() {},
    services: { secrets: { redact: (text: string) => text }, subconscious: {}, runs: { item: () => undefined } },
  } as unknown as ToolContext;
}

async function run(command: string): Promise<{ error: boolean; text: string }> {
  const out = await runCommand(defaultShell, ctx(), { command, cwd: process.cwd(), timeoutSeconds: 60 });
  return { error: out.isError === true, text: out.content.map((part) => ('text' in part ? part.text : '')).join('') };
}

/** The command text a windowsScript carries (its UTF-16 base64 decoded). */
function carried(script: string): string {
  const encoded = /FromBase64String\('([A-Za-z0-9+/=]*)'\)/.exec(script)?.[1];
  assert.ok(encoded !== undefined, script);
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

test('windowsShell without pwsh: powershell.exe of this Windows, the preamble first, then the command as UTF-16 base64 in a script block', () => {
  const command = "'Grüße' | python -c \"import sys; print(sys.stdin.read())\"; $p='a \"b\"'";
  const { file, args } = windowsShell(command, { PATH: 'C:\\nothing-here', LOCALAPPDATA: 'C:\\nowhere-local', ProgramFiles: 'C:\\nowhere-programs' });
  assert.equal(file, path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  assert.deepEqual(args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']);
  assert.equal(args.length, 6, 'no -EncodedCommand');
  assert.equal(args[5], `${WINDOWS_PREAMBLE}\n${windowsScript(command)}`);
  assert.equal(WINDOWS_PREAMBLE, "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding");
  const script = windowsScript(command);
  assert.equal(carried(script), command, 'the command travels whole, as UTF-16 base64');
  assert.ok(!script.includes('Grüße') && !script.includes('"b"'), 'no command text (no quoting) on the command line');
  assert.match(script, /^\. \(\[ScriptBlock\]::Create\(\[ScriptBlock\]::Create\(\[Text\.Encoding\]::Unicode\.GetString\(\[Convert\]::FromBase64String\('[^']*'\)\)\)\.ToString\(\) \+ "`n`nif \(-not `\$\?\) \{ exit 1 \}"\)\)$/);
});

test('windowsShell with the engines\' PowerShell 7: that pwsh.exe, with the same preamble and script block', { skip: process.platform !== 'win32' ? 'Windows paths' : undefined }, (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wf-shell-pwsh-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const user = path.join(root, 'local', 'Microsoft', 'powershell');
  mkdirSync(user, { recursive: true });
  writeFileSync(path.join(user, 'pwsh.exe'), '');
  const env = { PATH: 'C:\\nothing-here', LOCALAPPDATA: path.join(root, 'local') };
  const { file, args } = windowsShell('Get-Location', env);
  assert.equal(file, path.join(user, 'pwsh.exe'), 'the per-user install');
  assert.deepEqual(args, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `${WINDOWS_PREAMBLE}\n${windowsScript('Get-Location')}`]);
  const system = path.join(root, 'programs', 'PowerShell', '7');
  mkdirSync(system, { recursive: true });
  writeFileSync(path.join(system, 'pwsh.exe'), '');
  assert.equal(windowsShell('Get-Location', { ...env, ProgramFiles: path.join(root, 'programs') }).file, path.join(system, 'pwsh.exe'), '%ProgramFiles%\\PowerShell\\7 first');
});

test('a PowerShell variable and an umlaut come back as written', WINDOWS, async () => {
  const result = await run('$p=\'a b\'; Write-Output "$p ä"');
  assert.equal(result.error, false, result.text);
  assert.equal(result.text.trim(), 'exit 0\na b ä');
});

// B-080 review (probe: 'Grüße' | python - arrived as "Gr??e" – 5.1's $OutputEncoding is ASCII): piped text keeps its letters.
test('text piped into a native program arrives as written', WINDOWS, async () => {
  const result = await run(`'Grüße' | & '${process.execPath.replace(/'/g, "''")}' -e 'process.stdin.pipe(process.stdout)'`);
  assert.equal(result.error, false, result.text);
  assert.equal(result.text.trim(), 'exit 0\nGrüße');
});

const hasPython = () => spawnSync('python', ['-c', 'print(1)'], { encoding: 'utf8', windowsHide: true }).stdout?.trim() === '1';

test('a here-string with \\" piped into python - arrives as written', WINDOWS, async (t) => {
  if (!hasPython()) { t.skip('no python on PATH'); return; }
  const result = await run("@'\nprint(\"say \\\"hi\\\" now\")\n'@ | python -");
  assert.equal(result.error, false, result.text);
  assert.equal(result.text.trim(), 'exit 0\nsay "hi" now');
});

test('B-080 wave 3: \'Grüße\' piped into python -c arrives as Grüße', WINDOWS, async (t) => {
  if (!hasPython()) { t.skip('no python on PATH'); return; }
  const result = await run("'Grüße' | python -c \"import sys;print(sys.stdin.read())\"");
  assert.equal(result.error, false, result.text);
  assert.equal(result.text.trim(), 'exit 0\nGrüße');
});

// B-080 wave 3 (live 09.11.2026: "Ein leeres Pipeelement ist nicht zul�ssig" – a command that did not parse stopped the
// preamble too, and PowerShell wrote its ParserError in the OEM code page).
test('B-080 wave 3: a command that does not parse is an error in UTF-8 that names the line', WINDOWS, async () => {
  const result = await run('Get-Item |');
  assert.equal(result.error, true, result.text);
  assert.match(result.text, /^exit 1\n/);
  assert.ok(result.text.includes('+ Get-Item |'), result.text);
  // PowerShell names it by its id (ParseException, EmptyPipeElement) or, in PowerShell 7's concise view, in words only.
  assert.match(result.text, /ParseException|EmptyPipeElement|empty pipe element|leeres Pipeelement/i);
  assert.ok(!result.text.includes('\uFFFD'), `no replacement character: ${result.text}`);
});

test('B-080 wave 3: exit codes stay as -Command gives them – exit N, a failing native last command, Write-Error', WINDOWS, async () => {
  assert.match((await run('exit 3')).text, /^exit 3\n/);
  const native = await run('cmd /c exit 5');
  assert.equal(native.error, true, native.text);
  assert.match(native.text, /^exit 1\n/);
  const written = await run('Write-Error boom');
  assert.equal(written.error, true, written.text);
  assert.match(written.text, /^exit 1\n[\s\S]*boom/);
  assert.match((await run("cmd /c exit 5; 'after'")).text, /^exit 0\nafter/, 'a later statement that succeeds decides, as before');
  assert.match((await run('# only a comment')).text, /^exit 0\n/);
});

test('cmd syntax runs through cmd /c', WINDOWS, async () => {
  const result = await run('cmd /c "echo 1 && echo 2"');
  assert.equal(result.error, false, result.text);
  assert.match(result.text, /^exit 0\n1 ?\r?\n2/);
});

test('a failing cmdlet is an error with its plain-text message, no CLIXML', WINDOWS, async () => {
  const result = await run("Get-ChildItem -LiteralPath 'C:\\nope-xyz' -ErrorAction Stop");
  assert.equal(result.error, true, result.text);
  assert.match(result.text, /^exit 1\n/);
  assert.match(result.text, /nope-xyz/);
  assert.doesNotMatch(result.text, /#< CLIXML/);
});
