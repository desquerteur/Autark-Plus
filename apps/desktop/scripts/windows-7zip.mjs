// Owns: hash-pinned full 7-Zip data reader; 7zip-bin only bootstraps its extraction.
// Never: installs 7-Zip or executes the downloaded setup program.
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require = createRequire(import.meta.url), run = promisify(execFile);
const pins = {
  '7z.exe': 'dc0493429fe28136fcb177a0e77c9875cbb3b0bff5f2f8eeba4df302e98cef76',
  '7z.dll': '500db9eb17f3c21b729ba41dd02ecfe1823da05028c7e4ba129084cc74cc364e',
};
let pending;
async function resolveTool() {
  if (process.platform !== 'win32') throw new Error('Pinned full 7-Zip reader is Windows x64');
  let dir = process.env.AUTARK_7ZIP_DIR;
  if (!dir) {
    const temp = await mkdtemp(path.join(tmpdir(), 'autark-7zip-2606-'));
    dir = path.join(temp, 'reader'); await mkdir(dir);
    const response = await fetch('https://github.com/ip7z/7zip/releases/download/26.06/7z2606-x64.exe', { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`7-Zip download: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== 1659704 || createHash('sha256').update(bytes).digest('hex') !== '9b697f65ecc2d9b0152f5ee96d72dde522a7827690349d9307935dacf40f42ec') throw new Error('7-Zip distribution hash mismatch');
    const archive = path.join(temp, '7z2606-x64.exe'); await writeFile(archive, bytes);
    if (require('7zip-bin/package.json').version !== '5.2.0') throw new Error('Expected 7zip-bin 5.2.0');
    await run(require('7zip-bin').path7za, ['x', '-y', `-o${dir}`, archive, '7z.exe', '7z.dll'], { windowsHide: true, timeout: 120000 });
  }
  for (const [name, hash] of Object.entries(pins)) {
    if (createHash('sha256').update(await readFile(path.join(dir, name))).digest('hex') !== hash) throw new Error(`7-Zip reader hash mismatch: ${name}`);
  }
  return path.resolve(dir, '7z.exe');
}
export function full7zip() { return pending ??= resolveTool(); }
