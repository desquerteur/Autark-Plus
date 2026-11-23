// Owns: signing hooks, content-based PE coverage and final signed Windows candidate evidence.
// Never: signs installed files, publishes a release, or changes OS trust policy.
import { bindInstaller } from './windows-installer-content.mjs';
import { appendFile, lstat, mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./windows-signing.ps1', import.meta.url));
const reportDir = path.resolve('test-results');
const require = createRequire(import.meta.url);
let signTool;

async function noPackedPE(archive) {
  const { getRawHeader } = await import('@electron/asar');
  const { header, headerSize } = getRawHeader(archive);
  const handle = await open(archive, 'r');
  async function visit(entries, prefix = '', unpacked = false) {
    for (const [name, entry] of Object.entries(entries)) {
      const relative = `${prefix}${name}`;
      if (entry.files) await visit(entry.files, `${relative}/`, unpacked || entry.unpacked);
      else if (entry.link) throw new Error(`Archive link needs explicit review: ${relative}`);
      else if (!unpacked && !entry.unpacked && entry.size >= 2) {
        const head = Buffer.alloc(2);
        await handle.read(head, 0, 2, 8 + headerSize + Number(entry.offset));
        if (head.readUInt16LE() === 0x5a4d) throw new Error(`Packed PE must be placed in asarUnpack before signing: ${relative}`);
      }
    }
  }
  try { await visit(header.files); } finally { await handle.close(); }
}

export async function peFiles(root) {
  const files = [];
  async function visit(file) {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error(`Unexpected link in Windows candidate: ${file}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(file)).sort()) await visit(path.join(file, name));
      return;
    }
    if (!stat.isFile() || stat.size < 64) return;
    if (file.endsWith('.asar')) await noPackedPE(file);
    const handle = await open(file, 'r');
    try {
      const head = Buffer.alloc(64);
      await handle.read(head, 0, 64, 0);
      if (head.readUInt16LE(0) !== 0x5a4d) return;
      const offset = head.readUInt32LE(60);
      if (offset < 64 || offset > stat.size - 4) throw new Error(`Invalid PE header: ${file}`);
      const magic = Buffer.alloc(4);
      await handle.read(magic, 0, 4, offset);
      if (magic.readUInt32LE() !== 0x4550) throw new Error(`Invalid PE signature: ${file}`);
      files.push(file);
    } finally { await handle.close(); }
  }
  await visit(path.resolve(root));
  return files;
}

export async function inspectFile(file, mode, own = false) {
  if (process.platform !== 'win32') throw new Error('Authenticode requires the Windows signing runner.');
  const args = ['-NoProfile', '-NonInteractive', '-File', script, '-FilePath', path.resolve(file), '-Mode', mode];
  if (own) args.push('-OwnPublisher');
  // Use the pinned builder toolset's checksum-verified SignTool, not a random executable on PATH.
  signTool ??= require('app-builder-lib/out/toolsets/windows.js').getSignToolPath('1.1.0', true);
  const tool = await signTool;
  const { stdout } = await run('pwsh.exe', args, { windowsHide: true, timeout: 600000, maxBuffer: 1024 * 1024,
    env: { ...process.env, AUTARK_SIGNTOOL_PATH: tool.path } });
  const record = JSON.parse(stdout.trim());
  await mkdir(reportDir, { recursive: true });
  await appendFile(path.join(reportDir, 'windows-signing-calls.jsonl'), `${JSON.stringify(record)}\n`);
  return record;
}

function ownExecutable(file) {
  const name = path.basename(file).toLowerCase();
  return name === 'autark.exe' || name.startsWith('autark-windows-') || name.includes('__uninstaller');
}

export async function sign(configuration) {
  if (configuration.hash !== 'sha256') throw new Error('The signed Windows build uses SHA256 only.');
  await inspectFile(configuration.path, 'Sign', ownExecutable(configuration.path));
}

export async function completeTree(root, mode, inspector = inspectFile) {
  const files = await peFiles(root);
  if (!files.length) throw new Error('Windows candidate contains no PE files.');
  const records = [];
  for (const file of files) {
    const record = await inspector(file, mode, ownExecutable(file));
    if (record.status !== 'Valid') throw new Error(`Unsigned or untrusted PE remains: ${file}`);
    records.push(record);
  }
  return records;
}

export async function afterSign(context) {
  if (context.electronPlatformName !== 'win32') return;
  // Builder's normal recursion covers .exe/.dll/.node. Header inventory closes any suffix/directory gap.
  const records = await completeTree(context.appOutDir, 'Sign');
  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(reportDir, 'windows-inner-signatures.json'), JSON.stringify(records, null, 2));
}

export async function verifyCandidate(root, installer, inspector = inspectFile, extractor) {
  const records = await completeTree(root, 'Verify', inspector);
  const outer = await inspector(path.resolve(installer), 'Verify', true);
  if (outer.status !== 'Valid') throw new Error('Installer signature is not valid.');
  const bytes = await readFile(installer);
  const yml = await readFile(path.join(path.dirname(installer), 'latest.yml'), 'utf8');
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  const digests = [...yml.matchAll(/\bsha512:\s*['"]?([A-Za-z0-9+/=]+)/g)].map(match => match[1]);
  const sizes = [...yml.matchAll(/\bsize:\s*(\d+)/g)].map(match => Number(match[1]));
  if (!digests.length || digests.some(hash => hash !== sha512) || !sizes.length || sizes.some(size => size !== bytes.length)) {
    throw new Error('Update metadata does not match the final signed installer bytes.');
  }
  const content = await bindInstaller(root, installer, inspector, completeTree, extractor);
  const warnings = [...records, outer, ...content.signatures].filter(r => r.timestamped === false).map(r => `Valid vendor signature without timestamp: ${r.file ?? r.path}`);
  const result = { content, warnings, inner: records, installer: outer, sha256: createHash('sha256').update(bytes).digest('hex'),
    sha512, bytes: bytes.length, updateMetadataMatches: true, installedOrSacTested: false };
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] !== 'verify' || !process.argv[3] || !process.argv[4]) throw new Error('Usage: windows-signing.mjs verify <unpacked-dir> <installer>');
  const result = await verifyCandidate(process.argv[3], process.argv[4]);
  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(reportDir, 'windows-signed-candidate.json'), JSON.stringify(result, null, 2));
}
