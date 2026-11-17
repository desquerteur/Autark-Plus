// Seeds the public library with open-licensed skills, as OpenAutark (owner 14.11.2026: "die guten Skills, die es
// öffentlich gibt, … einfach hochlädst"). One call per skill folder (a folder with SKILL.md): name and description from
// its front matter, the rest of SKILL.md as body, its other small text files beside it, and the license text it came
// with (Apache-2.0 and MIT ask for that copy) – license, source and author on the entry.
// usage: node seed.mjs <repo checkout> <https source url> <SPDX license> <author> [--skip a,b] [--dry]
// The OpenAutark key is read from LIBRARY_ADMIN_KEY_FILE; the server from LIBRARY_URL (default library.openautark.com).

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const [repo, source, license, author, ...rest] = process.argv.slice(2);
const skip = new Set((rest[rest.indexOf('--skip') + 1] ?? '').split(',').filter(Boolean));
const dry = rest.includes('--dry');
const url = process.env.LIBRARY_URL ?? 'https://library.openautark.com';
const key = dry ? '' : readFileSync(process.env.LIBRARY_ADMIN_KEY_FILE, 'utf8').trim();
const MAX_FILE = 60_000;
const MAX_FILES = 200_000;

function skillFolders(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (existsSync(path.join(full, 'SKILL.md'))) out.push(full);
      else skillFolders(full, out);
    }
  }
  return out;
}

function frontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (pair) data[pair[1]] = pair[2].replace(/^(["'])(.*)\1$/, '$2').trim();
  }
  return { data, body: text.slice(match[0].length) };
}

const isText = (buffer) => !buffer.includes(0);

/** The folder's other text files (relative paths), smallest first until the limit; the license text first of all. */
function filesOf(folder, licenseText) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) { walk(full); continue; }
      const relative = path.relative(folder, full).replace(/\\/g, '/');
      if (/^skill\.md$/i.test(relative) || /^licen[cs]e/i.test(entry.name) || statSync(full).size > MAX_FILE) continue;
      const buffer = readFileSync(full);
      if (isText(buffer) && /^[\w.-]+(\/[\w.-]+)*$/.test(relative)) found.push([relative, buffer.toString('utf8')]);
    }
  };
  walk(folder);
  const files = { 'LICENSE.txt': licenseText };
  let size = licenseText.length;
  for (const [relative, text] of found.sort((a, b) => a[1].length - b[1].length)) {
    if (Object.keys(files).length >= 30 || size + text.length > MAX_FILES) break;
    files[relative] = text;
    size += text.length;
  }
  return files;
}

const rootLicense = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map((name) => path.join(repo, name)).find(existsSync);
let shared = 0;
for (const folder of skillFolders(repo)) {
  const name = path.basename(folder);
  if (skip.has(name)) continue;
  const own = ['LICENSE.txt', 'LICENSE', 'LICENSE.md'].map((file) => path.join(folder, file)).find(existsSync) ?? rootLicense;
  if (!own) { console.log(`skip ${name}: no license text`); continue; }
  const { data, body } = frontMatter(readFileSync(path.join(folder, 'SKILL.md'), 'utf8'));
  const description = (data.description ?? '').slice(0, 1024);
  if (description.length < 10 || body.trim().length < 20 || body.length > 60_000) { console.log(`skip ${name}: description or body out of bounds`); continue; }
  const relative = path.relative(repo, folder).replace(/\\/g, '/');
  const entry = { kind: 'skill', name: data.name || name, description, body: body.trim(), files: filesOf(folder, readFileSync(own, 'utf8')), license, source: `${source}/tree/HEAD/${relative}`, author };
  if (dry) { console.log(`would share ${entry.name} (${Object.keys(entry.files).length} files)`); continue; }
  const response = await fetch(`${url}/share`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(entry) });
  const answer = await response.json();
  console.log(response.ok ? `shared ${answer.id}` : `refused ${entry.name}: ${answer.error}`);
  if (response.ok) shared++;
}
console.log(`${shared} shared from ${source}`);
