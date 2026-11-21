// Owns: precompiler plugin coverage and source cache isolation regressions.
// Never: invokes Azure or executes generated EXEs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile, readFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareNsisTools, treeHashes } from '../../scripts/windows-nsis-tools.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'nsis-precompiler-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tool = path.join(root, 'cache/tool'); const plugins = path.join(root, 'cache/plugins');
  for (const file of [path.join(tool, 'Plugins/x86-unicode/nsExec.dll'), path.join(plugins, 'x86-unicode/nsis7z.dll'), path.join(plugins, 'x86-unicode/WinShell.dat')]) {
    await mkdir(path.dirname(file), { recursive: true });
    const bytes = Buffer.alloc(128); bytes.write('MZ'); bytes.writeUInt32LE(80, 60); bytes.write('PE\0\0', 80, 'binary'); await writeFile(file, bytes);
  }
  return { root, env: {}, config: { directories: { buildResources: 'assets' } }, projectDir: root, reportDir: path.join(root, 'reports'),
    tools: { getMakeNsisPath: async () => ({ path: path.join(tool, 'Bin/makensis.exe'), env: { NSISDIR: tool } }), getNsisPluginsPath: async () => plugins } };
}

test('all default and resource plugin PE signed and reverified before compiler paths are exposed; caches untouched', async t => {
  const options = await fixture(t); const calls = [];
  const result = await prepareNsisTools({ ...options, inspector: async (file, mode, own) => {
    assert.equal(options.env.ELECTRON_BUILDER_NSIS_DIR, undefined);
    assert.equal(options.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR, undefined);
    assert.equal(own, false); calls.push([file, mode]);
    if (mode === 'Sign' && file.endsWith('nsis7z.dll')) await appendFile(file, 'MOCK-SIGNED-COPY');
    return { file, status: 'Valid', preserved: !file.endsWith('nsis7z.dll') };
  } });
  assert.equal(calls.length, 6); assert.equal(result.records.length, 3);
  assert.equal(result.originalCachesUnchanged, true);
  assert.equal(options.env.ELECTRON_BUILDER_NSIS_DIR, result.privateTool);
  assert.equal(options.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR, result.privateResources);
  assert.notDeepEqual(result.signedCopies.plugins, result.source.hashes.plugins);
  assert.deepEqual(await treeHashes(result.source.toolRoot), result.source.hashes.tool);
  assert.equal((await readFile(path.join(result.privateTool, 'Plugins/x86-unicode/nsExec.dll'))).length, 128);
});

test('failed signature leaves compiler paths unbound', async t => {
  const options = await fixture(t);
  await assert.rejects(prepareNsisTools({ ...options, inspector: async () => ({ status: 'NotSigned' }) }), /Unsigned or untrusted/);
  assert.deepEqual(options.env, {});
});

test('custom scripts, tool overrides and user plugins require explicit review rather than silently escaping coverage', async t => {
  const options = await fixture(t);
  for (const key of ['include', 'script', 'customNsisBinary', 'customNsisResources']) {
    await assert.rejects(prepareNsisTools({ ...options, config: { nsis: { [key]: 'custom' } } }), /explicit plugin coverage/);
  }
  await assert.rejects(prepareNsisTools({ ...options, env: { ELECTRON_BUILDER_NSIS_DIR: 'custom' } }), /override/);
  await mkdir(path.join(options.root, 'assets/x86-unicode'), { recursive: true });
  await assert.rejects(prepareNsisTools(options), /explicit coverage/);
});

test('source mutation during signing is detected before compiler binding', async t => {
  const options = await fixture(t);
  await assert.rejects(prepareNsisTools({ ...options, inspector: async () => {
    await writeFile(path.join(options.root, 'cache/tool/changed.txt'), 'changed'); return { status: 'Valid' };
  } }), /cache changed/);
  assert.deepEqual(options.env, {});
});

test('post-sign Verify failure cannot expose prepared tool paths', async t => {
  const options = await fixture(t);
  await assert.rejects(prepareNsisTools({ ...options, inspector: async (file, mode) => ({ status: mode === 'Sign' ? 'Valid' : 'NotSigned' }) }), /Unsigned or untrusted/);
  assert.deepEqual(options.env, {});
});

test('implicit installer include is gated even without an nsis include option', async t => {
  const options = await fixture(t);
  await mkdir(path.join(options.root, 'assets'), { recursive: true });
  await writeFile(path.join(options.root, 'assets/installer.nsh'), '!addplugindir custom');
  await assert.rejects(prepareNsisTools(options), /explicit coverage/);
});

test('packaging awaits plugin preparation before importing builder; outer PE endgate is retained', async () => {
  const cli = await readFile(new URL('../../scripts/package-desktop.mjs', import.meta.url), 'utf8');
  assert.ok(cli.indexOf('await prepareNsisTools') < cli.indexOf("await import('electron-builder/cli.js')"));
  const signing = await readFile(new URL('../../scripts/windows-signing.mjs', import.meta.url), 'utf8');
  assert.match(signing, /await bindInstaller/);
});

const realProject = new URL('../../../../../../../apps/desktop/', import.meta.url);
test('RealProjectPreflightFixture: actual package config and actual installer include, mocked tools and inspector, no Azure', async t => {
  const options = await fixture(t);
  const { fileURLToPath } = await import('node:url');
  const projectDir = fileURLToPath(realProject);
  const config = JSON.parse(await readFile(new URL('package.json', realProject), 'utf8')).build;
  const result = await prepareNsisTools({ ...options, projectDir, config, inspector: async () => ({ status: 'Valid', mock: true }) });
  assert.equal(result.reviewedInclude.path, path.join(projectDir, 'assets/installer.nsh'));
  assert.equal(config.nsis.include, result.reviewedInclude.path);
});
test('reviewed include accepts exact bytes; mutation, wrong path, nested sources and unknown plugin root fail', async t => {
  const bytes = await readFile(new URL('assets/installer.nsh', realProject));
  for (const suffix of ['', '\n;changed', '\n!include evil.nsh', '\n!addplugindir evil', '\nFile evil.dll']) {
    const options = await fixture(t);
    await mkdir(path.join(options.root, 'assets'), { recursive: true });
    await writeFile(path.join(options.root, 'assets/installer.nsh'), Buffer.concat([bytes, Buffer.from(suffix)]));
    if (suffix) await assert.rejects(prepareNsisTools(options), /explicit coverage/);
    else {
      await assert.rejects(prepareNsisTools({ ...options, config: { ...options.config, nsis: { include: 'elsewhere.nsh' } } }), /explicit plugin coverage/);
      await mkdir(path.join(options.root, 'assets/x86-ansi'));
      await assert.rejects(prepareNsisTools(options), /explicit coverage/);
    }
  }
});
