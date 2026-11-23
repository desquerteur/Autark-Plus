// B-085 T6: a pasted Claude Desktop/Code/Cursor config goes into mcp.json as it is – every shape (mcpServers, servers, a bare
// map, one server, a fragment without outer braces), "type" dropped, an entry without command or url named – and only values
// that hold a secret move into Secrets, a "Bearer " in front kept; the own-server form's rows become env or headers.
// Owns: these assertions. Never: a real window, runtime, vault or file watcher.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readConnectors } from '../../../src/runtime/apps/connectors.ts';
import { holdsSecret, movedSecrets, namedValues, nameFromAddress, pastedServers, pasteLine, secretSpots, withEntries } from '../../../src/ui/settings/apps-files.ts';

function read(mcp: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'apps-paste-'));
  try {
    mkdirSync(path.join(dir, 'connectors'));
    writeFileSync(path.join(dir, 'connectors', 'mcp.json'), mcp);
    return readConnectors(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const CLAUDE_DESKTOP = JSON.stringify({
  globalShortcut: 'Ctrl+Space',
  mcpServers: {
    github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc', NODE_ENV: 'production' } },
    linear: { type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer lin_123', 'X-Team': 'core' } },
  },
});

test('paste: every shape gives the same servers, "type" goes, serverUrl becomes url', () => {
  const { servers, error } = pastedServers(CLAUDE_DESKTOP);
  assert.equal(error, '');
  assert.deepEqual(servers.map((server) => server.name), ['github', 'linear']);
  assert.equal('type' in servers[1].entry, false);
  assert.deepEqual(pastedServers(JSON.stringify({ servers: { a: { type: 'stdio', command: 'uvx', args: ['a'] } } })).servers, [{ name: 'a', entry: { command: 'uvx', args: ['a'] } }]);
  assert.deepEqual(pastedServers('{"b": {"serverUrl": "https://b.example/mcp"}}').servers, [{ name: 'b', entry: { url: 'https://b.example/mcp' } }]);
  assert.deepEqual(pastedServers('{"url": "https://mcp.notion.com/mcp"}').servers, [{ name: 'notion', entry: { url: 'https://mcp.notion.com/mcp' } }]);
  assert.deepEqual(pastedServers('﻿"files": {"command": "npx", "args": ["x"]},').servers.map((server) => server.name), ['files'], 'a fragment without its braces');
  assert.deepEqual(pastedServers('{"lan": {"url": "http://192.168.1.20:8080/mcp"}}').servers[0].entry, { url: 'http://192.168.1.20:8080/mcp' }, 'an http address on the network goes in');
});

test('paste: what cannot go in says why, and nothing goes in', () => {
  assert.match(pastedServers('').error, /Paste an mcpServers block/);
  assert.match(pastedServers('{ broken').error, /^Not valid JSON/);
  assert.match(pastedServers('[1, 2]').error, /not an object/);
  assert.match(pastedServers('{"mcpServers": {}}').error, /No server/);
  const bad = pastedServers('{"mcpServers": {"ok": {"command": "npx"}, "half": {"args": ["x"]}}}');
  assert.deepEqual(bad, { servers: [], error: '"half" needs a "command" or a "url"' });
  assert.match(pastedServers('{"mcpServers": {"x": {"command": "  "}}}').error, /"x" needs/);
});

test('paste: the merged file is what the runtime reads, a taken name gets a free one', () => {
  const start = JSON.stringify({ mcpServers: { github: { url: 'https://old.example/mcp' } } });
  const text = withEntries('mcp.json', start, pastedServers(CLAUDE_DESKTOP).servers);
  const { connectors, problems } = read(text);
  assert.deepEqual(problems, []);
  assert.deepEqual(connectors.map((entry) => entry.name), ['github', 'github 2', 'linear']);
  assert.equal(connectors[2].transport, 'http');
  assert.throws(() => withEntries('mcp.json', '{ broken', []), /not valid JSON/, 'a broken file is found before any key is stored');
});

test('secrets: only secret-looking values move, a Bearer stays in front, handles and ${VAR} stay', () => {
  const [github, linear] = pastedServers(CLAUDE_DESKTOP).servers;
  assert.deepEqual(secretSpots(github.entry), [{ field: 'env', key: 'GITHUB_PERSONAL_ACCESS_TOKEN', prefix: '', value: 'ghp_abc' }]);
  assert.deepEqual(secretSpots(linear.entry), [{ field: 'headers', key: 'Authorization', prefix: 'Bearer ', value: 'lin_123' }]);
  assert.deepEqual(secretSpots({ headers: { 'X-Api-Key': 'k1', Accept: 'json' }, env: { API_KEY: 'secret://s1', TOKEN: '${TOKEN}', DB_URL: 'postgres://u:pw@h/db', PORT: '3000' } }), [
    { field: 'env', key: 'DB_URL', prefix: '', value: 'postgres://u:pw@h/db' },
    { field: 'headers', key: 'X-Api-Key', prefix: '', value: 'k1' },
  ]);
  assert.deepEqual(secretSpots({ headers: { Authorization: 'Bearer ' } }), [], 'nothing behind the scheme');
});

test('secrets: moved into the catalog by handle, the rest of the entry as it was', async () => {
  const saved: Array<[string, string, string]> = [];
  const store = async (label: string, kind: string, value: string) => { saved.push([label, kind, value]); return `sec_${saved.length}`; };
  const [github, linear] = pastedServers(CLAUDE_DESKTOP).servers;
  assert.deepEqual(await movedSecrets('github', github.entry, store), {
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'secret://sec_1', NODE_ENV: 'production' },
  });
  assert.deepEqual((await movedSecrets('linear', linear.entry, store)).headers, { Authorization: 'Bearer secret://sec_2', 'X-Team': 'core' });
  assert.deepEqual(saved, [['github GITHUB_PERSONAL_ACCESS_TOKEN', 'token', 'ghp_abc'], ['linear token', 'token', 'lin_123']]);
  assert.equal(JSON.stringify(github.entry).includes('secret://'), false, 'the pasted entry itself is not changed');
});

test('check line and the own-server rows', () => {
  assert.equal(pasteLine(pastedServers(CLAUDE_DESKTOP).servers), 'Adds github, linear · 2 keys go into Secrets');
  assert.equal(pasteLine(pastedServers('{"a": {"command": "x", "env": {"HOME": "${HOME}"}}}').servers), 'Adds a · fill in each ${…} first');
  const rows = (pairs: Array<[string, string]>) => pairs.map(([name, value]) => ({ name, value }));
  assert.deepEqual(namedValues('command', rows([['API_KEY', 'k'], ['', '']])), { values: { API_KEY: 'k' }, blocked: '' });
  assert.match(namedValues('command', rows([['', 'k']])).blocked, /name/);
  assert.match(namedValues('command', rows([['A B', 'k']])).blocked, /variable name/);
  assert.match(namedValues('url', rows([['X Team', 'k']])).blocked, /header name/);
  assert.deepEqual(namedValues('url', rows([['X-Team', '']])).values, { 'X-Team': '' });
});

test('review fixes: an empty url gives way to serverUrl, names for LAN and command servers, which row values are masked', () => {
  assert.deepEqual(pastedServers('{"b": {"url": "", "serverUrl": "https://b.example/mcp"}}').servers, [{ name: 'b', entry: { url: 'https://b.example/mcp' } }]);
  assert.deepEqual(pastedServers('{"b": {"url": " ", "command": "npx"}}').servers[0].entry, { url: ' ', command: 'npx' }, 'no serverUrl: the entry as it is');
  assert.equal(nameFromAddress('http://192.168.1.20:8080/mcp'), '192.168.1.20');
  assert.equal(nameFromAddress('npx', ['-y', '@modelcontextprotocol/server-filesystem', 'C:/Docs']), 'server-filesystem');
  assert.equal(nameFromAddress('uvx', ['mcp-server-time', '--local-timezone', 'Europe/Berlin']), 'mcp-server-time');
  assert.equal(nameFromAddress('npx', ['-y', 'mcp-remote', 'https://mcp.linear.app/sse']), 'linear');
  assert.equal(nameFromAddress('docker', ['run', '-i', '--rm', 'ghcr.io/github/github-mcp-server:latest']), 'github-mcp-server');
  assert.equal(nameFromAddress('npx', ['-y', '@scope/pkg@1.2.0']), 'pkg');
  assert.equal(nameFromAddress('node', ['C:/x/server.js']), 'node', 'nothing that names a server: the program');
  assert.deepEqual(pastedServers('{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"]}').servers.map((server) => server.name), ['server-github']);
  assert.equal(holdsSecret('NODE_ENV', 'production', false), false);
  assert.equal(holdsSecret('GITHUB_TOKEN', '', false), true);
  assert.equal(holdsSecret('authorization', 'Bearer x', true), true);
  assert.equal(holdsSecret('X-Team', 'core', true), false);
});
