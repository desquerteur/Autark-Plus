// Owns: data-only NSIS extraction and exact signed application byte binding.
// Never: executes installer code or deletes a caller-owned directory.
import { mkdtemp, mkdir, readdir, lstat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { full7zip } from './windows-7zip.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const run = promisify(execFile);

export function safeEntry(name) {
  if (!name || path.win32.isAbsolute(name) || name.includes(':') || /[\x00-\x1f]/.test(name) || name.split(/[\\/]/).some(p => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) || name.split(/[\\/]/).some(p => p === '..' || /[. ]$/.test(p))) throw new Error(`Unsafe archive path: ${name}`);
}
export async function extractData(archive, dest) {
  const tool = await full7zip();
  const options = { windowsHide: true, timeout: 120000, maxBuffer: 32 * 1024 * 1024 };
  // Force the outer format: 7za otherwise silently opens a nested 7z stream in an NSIS EXE.
  const format = archive.toLowerCase().endsWith('.7z') ? '-t7z' : '-tNSIS';
  const { stdout } = await run(tool, ['l', format, '-slt', '-ba', archive], options);
  let count = 0;
  for (const block of stdout.split(/\r?\n\r?\n/)) {
    const name = block.match(/^Path = (.+)$/m)?.[1];
    if (!name) continue;
    safeEntry(name); count++;
    if (/^(Symbolic Link|Hard Link) = /m.test(block) || /^Attributes = .*\bl\b/m.test(block) || /^(?:Reparse|Symbolic Link|Hard Link) = /m.test(block)) throw new Error('Archive links rejected');
  }
  if (!count) throw new Error('Empty archive listing');
  await run(tool, ['x', format, '-y', `-o${dest}`, archive], options);
}
export async function inventory(root) {
  const result = {};
  async function visit(dir, prefix = '') {
    for (const name of (await readdir(dir)).sort()) {
      safeEntry(name);
      const file = path.join(dir, name), rel = prefix + name, stat = await lstat(file);
      if (stat.isSymbolicLink()) throw new Error('Extracted link/reparse point rejected');
      if (stat.isDirectory()) await visit(file, rel + '/');
      else if (stat.isFile()) result[rel] = createHash('sha256').update(await readFile(file)).digest('hex');
      else throw new Error('Nonregular archive member');
    }
  }
  await visit(root); return result;
}
export async function bindInstaller(root, installer, inspector, completeTree, extractor = extractData) {
  const temp = await mkdtemp(path.join(tmpdir(), 'autark-nsis-data-'));
  try {
    const outer = path.join(temp, 'outer'), app = path.join(temp, 'app');
    await mkdir(outer); await mkdir(app);
    await extractor(path.resolve(installer), outer);
    const members = await inventory(outer);
    const archives = Object.keys(members).filter(n => /(^|\/)app-64\.7z$/i.test(n));
    const uninstallers = Object.keys(members).filter(n => /(^|\/)(?:.*__uninstaller|uninstall[^/]*)\.exe$/i.test(n));
    if (archives.length !== 1 || uninstallers.length !== 1) throw new Error('Expected one app-64.7z and one embedded uninstaller');
    await extractor(path.join(outer, archives[0]), app);
    const expected = await inventory(root), actual = await inventory(app);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Installer application bytes differ from signed win-unpacked');
    const signatures = await completeTree(app, 'Verify', inspector);
    // Inventory all PE helpers, including the embedded uninstaller, not just its filename.
    signatures.push(...await completeTree(outer, 'Verify', async (file, mode) => inspector(file, mode, uninstallers.some(n => path.join(outer, n) === file))));
    return { applicationFiles: actual, embeddedUninstaller: uninstallers[0], signatures, bytesMatch: true };
  } finally {
    const resolved = path.resolve(temp);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('autark-nsis-data-') || (await lstat(resolved)).isSymbolicLink()) throw new Error('Unsafe temporary cleanup target');
    await rm(resolved, { recursive: true, force: true });
  }
}
