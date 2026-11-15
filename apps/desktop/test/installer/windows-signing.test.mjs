// Owns: Windows signing coverage, preservation and final update-byte binding regressions.
// Never: calls Azure, signs installed files, or changes OS policy.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterSign, completeTree, inspectFile, peFiles, sign, verifyCandidate } from '../../scripts/windows-signing.mjs';

const require = createRequire(import.meta.url);
const configPath = require.resolve('../../scripts/windows-signing-config.cjs');
const keys = ['AUTARK_SIGNING_ENDPOINT', 'AUTARK_SIGNING_ACCOUNT', 'AUTARK_SIGNING_PROFILE', 'AUTARK_SIGNING_PUBLISHER'];
const settings = ['https://neu.codesigning.azure.net/', 'test-account', 'test-profile', 'Fixture Publisher'];
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'autark-signing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function pe(file) {
  const data = Buffer.alloc(128);
  data.write('MZ'); data.writeUInt32LE(80, 60); data.write('PE\0\0', 80, 'binary');
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, data);
}

test('signed configuration retains the package identity, includes DLL/node, and rejects missing profile', async () => {
  const saved = keys.map(key => process.env[key]);
  try {
    keys.forEach((key, i) => { process.env[key] = settings[i]; });
    delete require.cache[configPath];
    const config = require(configPath);
    assert.equal(config.appId, 'com.teydralab.workforce');
    assert.equal(config.forceCodeSigning, true);
    assert.equal(config.win.verifyUpdateCodeSignature, true);
    assert.deepEqual(config.win.signExts, ['.dll', '.node']);
    assert.deepEqual(config.win.signtoolOptions.signingHashAlgorithms, ['sha256']);
    assert.match(config.win.signtoolOptions.sign, /windows-signing.mjs/);
    assert.equal(config.afterSign, config.win.signtoolOptions.sign);
    await require('app-builder-lib/out/util/config/config.js').validateConfiguration(config, { add() {} });
    delete process.env.AUTARK_SIGNING_PROFILE; delete require.cache[configPath];
    assert.throws(() => require(configPath), /AUTARK_SIGNING_PROFILE/);
    process.env.AUTARK_SIGNING_PROFILE = settings[2];
    process.env.AUTARK_SIGNING_ENDPOINT = 'https://unrelated.example/'; delete require.cache[configPath];
    assert.throws(() => require(configPath), /regional Azure signing endpoint/);
  } finally {
    keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
    delete require.cache[configPath];
  }
});

test('PE hidden inside ASAR is rejected; unpacked PE is inventoried physically', async t => {
  const root = await fixture(t); const source = await fixture(t);
  await pe(path.join(source, 'nested/module.dat'));
  const asar = require('@electron/asar'); const archive = path.join(root, 'app.asar');
  await asar.createPackage(source, archive);
  await assert.rejects(peFiles(root), /Packed PE must be placed in asarUnpack/);
  asar.uncacheAll();
  await asar.createPackageWithOptions(source, archive, { unpack: '**/*.dat' });
  asar.uncacheAll();
  assert.equal((await peFiles(root)).length, 1);
});

test('header inventory includes nested .node, uppercase DLL and PE with an unexpected suffix', async t => {
  const root = await fixture(t);
  for (const name of ['Autark.exe', 'resources/broker/broker.exe', 'nested/addon.node', 'nested/LIB.DLL', 'hidden.dat']) await pe(path.join(root, name));
  await writeFile(path.join(root, 'not-a-pe.dll'), 'plain text');
  assert.equal((await peFiles(root)).length, 5);
});

test('malformed MZ fails instead of silently omitting a potentially executable file', async t => {
  const root = await fixture(t); const b = Buffer.alloc(90); b.write('MZ'); b.writeUInt32LE(1000, 60);
  await writeFile(path.join(root, 'bad.bin'), b);
  await assert.rejects(peFiles(root), /Invalid PE header/);
});

test('candidate directory links are not followed out of the staged tree', async t => {
  const root = await fixture(t); const target = await fixture(t);
  await symlink(target, path.join(root, 'escape'), 'junction');
  await assert.rejects(peFiles(root), /Unexpected link/);
});

test('no-PE or incomplete signature inventory cannot pass', async t => {
  const root = await fixture(t);
  await assert.rejects(completeTree(root, 'Verify', async () => ({})), /no PE/);
  await pe(path.join(root, 'Autark.exe'));
  await assert.rejects(completeTree(root, 'Verify', async () => ({ status: 'NotSigned' })), /Unsigned or untrusted/);
});

test('full inventory sends every file through the same signer and marks our main executable', async t => {
  const root = await fixture(t); const calls = [];
  for (const name of ['Autark.exe', 'vendor.dll', 'nested/native.node', 'nested/code.bin']) await pe(path.join(root, name));
  const rows = await completeTree(root, 'Sign', async (file, mode, own) => {
    calls.push({ file: path.basename(file), mode, own }); return { status: 'Valid', file };
  });
  assert.equal(rows.length, 4);
  assert.equal(calls.find(x => x.file === 'Autark.exe').own, true);
  assert.equal(calls.find(x => x.file === 'vendor.dll').own, false);
  assert.ok(calls.every(x => x.mode === 'Sign'));
});

test('hook rejects extra algorithms and ignores non-Windows afterSign', async () => {
  await assert.rejects(sign({ hash: 'sha1', path: 'no-file.exe' }), /SHA256 only/);
  await afterSign({ electronPlatformName: 'linux' });
  const resolver = require('app-builder-lib/out/util/resolve.js');
  assert.equal(typeof await resolver.resolveFunction('module', './scripts/windows-signing.mjs', 'sign', process.cwd()), 'function');
  assert.equal(typeof await resolver.resolveFunction('module', './scripts/windows-signing.mjs', 'afterSign', process.cwd()), 'function');
});

test('final signed installer bytes bind every SHA512 and size in latest.yml', async t => {
  const root = await fixture(t); const app = path.join(root, 'win-unpacked');
  await pe(path.join(app, 'Autark.exe')); const installer = path.join(root, 'autark-windows-x64.exe'); await pe(installer);
  const bytes = await readFile(installer); const hash = createHash('sha512').update(bytes).digest('base64');
  await writeFile(path.join(root, 'latest.yml'), `version: 0.0.1\nfiles:\n - url: autark-windows-x64.exe\n   sha512: ${hash}\n   size: ${bytes.length}\nsha512: ${hash}\n`);
  const seen = []; const inspect = async (file, mode, own) => { seen.push({ file, mode, own }); return { status: 'Valid', file, timestamped: false }; };
  const mockExtractor = async (source, dest) => {
    if (source.endsWith('.7z')) await pe(path.join(dest, 'Autark.exe'));
    else { await writeFile(path.join(dest, 'app-64.7z'), 'mock archive'); await pe(path.join(dest, 'Uninstall Autark.exe')); await pe(path.join(dest, 'nsExec.dll')); }
  };
  const result = await verifyCandidate(app, installer, inspect, mockExtractor);
  assert.equal(result.updateMetadataMatches, true); assert.equal(result.installedOrSacTested, false);
  assert.ok(seen.every(x => x.mode === 'Verify'));
  assert.equal(result.content.bytesMatch, true);
  assert.ok(result.warnings.length > 0);
  assert.ok(seen.some(x => x.file.endsWith('nsExec.dll') && !x.own));
  assert.ok(seen.some(x => x.file.endsWith('Uninstall Autark.exe') && x.own));
  await writeFile(path.join(root, 'latest.yml'), `sha512: ${hash}\nsize: 1\n`);
  await assert.rejects(verifyCandidate(app, installer, inspect), /metadata does not match/);
});

test('real vendor signature is preserved byte-for-byte without Azure or signing credentials', { skip: process.platform !== 'win32' }, async () => {
  const file = path.resolve('node_modules/electron/dist/d3dcompiler_47.dll');
  const hash = createHash('sha256').update(await readFile(file)).digest('hex');
  const record = await inspectFile(file, 'Sign', false);
  assert.equal(record.status, 'Valid'); assert.equal(record.signedHere, false); assert.equal(record.preserved, true);
  assert.equal(record.beforeSha256, hash); assert.equal(record.sha256, hash);
});

test('a real unsigned staged node module fails Verify without invoking Azure', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture(t); const node = path.join(root, 'addon.node');
  // Copy bytes, never modify the installed module itself.
  const source = require.resolve('sherpa-onnx-win-x64/sherpa-onnx.node');
  await writeFile(node, await readFile(source));
  await assert.rejects(inspectFile(node, 'Verify', false), /Authenticode is NotSigned/);
});

test('an invalid existing signature is rejected rather than replaced', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture(t); const target = path.join(root, 'broken.exe');
  const bytes = await readFile(path.resolve('node_modules/electron/dist/d3dcompiler_47.dll'));
  bytes[4096] ^= 1; await writeFile(target, bytes);
  await assert.rejects(inspectFile(target, 'Sign', false), /no untrusted signature is overwritten/);
});

// Explicit mocks test binding failures, not Authenticode or a real NSIS layout.
test('mock extraction rejects missing archive, missing uninstaller and altered application bytes', async t => {
  const { bindInstaller, safeEntry } = await import('../../scripts/windows-installer-content.mjs');
  for (const name of ['../escape', 'C:\\escape', '/absolute', 'a:stream', 'dir/../x']) assert.throws(() => safeEntry(name), /Unsafe/);
  const root = await fixture(t); await pe(path.join(root, 'Autark.exe'));
  const inspect = async () => ({ status: 'Valid', timestamped: false });
  for (const missing of ['archive', 'uninstaller', 'bytes']) {
    const mock = async (source, dest) => {
      if (source.endsWith('.7z')) { await pe(path.join(dest, 'Autark.exe')); await writeFile(path.join(dest, 'extra.txt'), 'different'); }
      else {
        if (missing !== 'archive') await writeFile(path.join(dest, 'app-64.7z'), 'mock');
        if (missing !== 'uninstaller') await pe(path.join(dest, 'Uninstall Autark.exe'));
      }
    };
    await assert.rejects(bindInstaller(root, 'fixture.exe', inspect, completeTree, mock), missing === 'bytes' ? /bytes differ/ : /Expected one/);
  }
});

test('full 7-Zip pin rejects a substituted reader directory before archive execution', async t => {
  const dir = await fixture(t), saved = process.env.AUTARK_7ZIP_DIR;
  await writeFile(path.join(dir, '7z.exe'), 'substituted');
  process.env.AUTARK_7ZIP_DIR = dir;
  try {
    const { full7zip } = await import('../../scripts/windows-7zip.mjs?pin-test');
    await assert.rejects(full7zip(), /hash mismatch/);
  } finally { if (saved === undefined) delete process.env.AUTARK_7ZIP_DIR; else process.env.AUTARK_7ZIP_DIR = saved; }
});
test('packaged smoke closes its own mocked application when identity is wrong', async t => {
  const { packagedSmoke } = await import('../../scripts/packaged-smoke.mjs');
  const dir = await fixture(t), exe = path.join(dir, 'Autark.exe'); await pe(exe);
  let options, closed = false;
  const electron = { launch: async opts => { options = opts; return {
    firstWindow: async () => ({ waitForLoadState: async () => {} }),
    evaluate: async () => ({ packaged: false, ready: true, exe, profile: opts.env.WORKFORCE_TEST_DATA }),
    close: async () => { closed = true; },
  }; } };
  await assert.rejects(packagedSmoke(exe, electron), /identity/);
  assert.equal(options.executablePath, exe); assert.equal(options.env.WORKFORCE_FAKE_ENGINE, '1');
  assert.ok(options.env.WORKFORCE_TEST_DATA.includes('autark-packaged-smoke-')); assert.equal(closed, true);
});
