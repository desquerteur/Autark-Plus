// Owns: real compiler embedding and extraction byte-binding evidence using mock signing.
// Never: signs cryptographically, invokes Azure, or executes generated EXEs.
import { prepareNsisTools } from '../../scripts/windows-nsis-tools.mjs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const run = promisify(execFile); const require = createRequire(import.meta.url);
const root = path.resolve('../../real-nsis-r3'); await mkdir(root, { recursive: true });
const env = {};
const prepared = await prepareNsisTools({ config: {}, projectDir: root, reportDir: root, env,
  inspector: async (file, mode) => {
    if (mode === 'Sign') await appendFile(file, 'R3-MOCK-SIGNING-NOT-AUTHENTICODE');
    return { file, status: 'Valid', mock: true, mode };
  } });
const compiler = await require('app-builder-lib/out/toolsets/windows.js').getMakeNsisPath();
const privateCompiler = path.join(prepared.privateTool, path.relative(prepared.source.toolRoot, compiler.path));
Object.assign(process.env, env);
const resolvedCompiler = await require('app-builder-lib/out/toolsets/windows.js').getMakeNsisPath();
const resolvedPlugins = await require('app-builder-lib/out/toolsets/windows.js').getNsisPluginsPath();
assert.equal(resolvedCompiler.path, privateCompiler);
assert.equal(resolvedPlugins, path.join(prepared.privateResources, 'plugins'));
const out = path.join(root, 'fixture.exe'); const input = path.join(root, 'fixture.nsi');
await writeFile(input, `Unicode true\nName "r3-data-only"\nOutFile "${out}"\n!addplugindir /x86-unicode "${resolvedPlugins}/x86-unicode"\nSection\nSystem::Call 'kernel32::GetCurrentProcessId() i.r0'\nnsExec::ExecToStack 'echo never-executed'\nPop $0\nPop $1\nNsis7z::Extract 'never.7z'\nSectionEnd\n`);
const compilation = await run(privateCompiler, ['/V3', input], { env: { ...process.env, NSISDIR: prepared.privateTool }, windowsHide: true });
await writeFile(path.join(root, 'compiler.log'), compilation.stdout + compilation.stderr);
const extracted = path.join(root, 'extracted');
const extraction = await run(process.env.SEVEN_ZIP ?? '7z', ['x', '-y', `-o${extracted}`, out], { windowsHide: true });
await writeFile(path.join(root, 'extraction.log'), extraction.stdout + extraction.stderr);
const bindings = [];
for (const name of ['System.dll', 'nsExec.dll', 'nsis7z.dll']) {
  const copy = name === 'nsis7z.dll' ? path.join(resolvedPlugins, 'x86-unicode', name) : path.join(prepared.privateTool, 'Plugins/x86-unicode', name);
  const embedded = path.join(extracted, '$PLUGINSDIR', name);
  const expected = await readFile(copy); const actual = await readFile(embedded);
  assert.deepEqual(actual, expected);
  assert.ok(actual.includes(Buffer.from('R3-MOCK-SIGNING-NOT-AUTHENTICODE')));
  bindings.push({ name, bytes: actual.length, sha256: createHash('sha256').update(actual).digest('hex') });
}
await writeFile(path.join(root, 'result.json'), JSON.stringify({ mockOnly: true, generatedExeExecuted: false,
  compiledFromPrivateTool: privateCompiler, inventoryCount: prepared.records.length, bindings,
  originalCachesUnchanged: prepared.originalCachesUnchanged }, null, 2));
console.log(JSON.stringify({ mockOnly: true, coveredPluginPE: prepared.records.length, embeddedPluginBindings: bindings.length, originalCachesUnchanged: true }));
