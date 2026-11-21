// LIVE (opt-in, desquerteur/Autark-Plus#28): a real Grok Build turn on Autark's ACP engine – the finder's ~/.grok/bin binary,
// `grok agent stdio` with the lean environment, the silent authenticate of the person's cached `grok login`, the account
// check, the model list, one turn that must use a tool of Grok's own (read a file only the folder holds) and streams its
// answer, and a second turn in the same session. Uses the SuperGrok / X Premium+ plan of the signed-in home (no API key:
// childEnv strips XAI_API_KEY). Reports model ids, event counts and the answer's check – never account values.
//   WORKFORCE_LIVE=1 [WORKFORCE_LIVE_GROK_HOME=<GROK_HOME of a signed-in account>] node --test test/live/grok-build.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Account } from '../../src/shared/model/providers.ts';
import type { EngineEvent } from '../../src/runtime/engines/types.ts';
import { AcpEngine } from '../../src/runtime/engines/acp/engine.ts';
import { AcpLaunches } from '../../src/runtime/engines/acp/providers.ts';
import { Supervisor } from '../../src/runtime/system/supervisor.ts';
import { ExecutableFinder } from '../../src/runtime/accounts/executables.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const live = process.env.WORKFORCE_LIVE === '1';
const home = process.env.WORKFORCE_LIVE_GROK_HOME || undefined; // unset: the default ~/.grok login

/** A one-tool MCP server on loopback (JSON answers, bearer token) standing in for Autark's hub lease. */
async function mcpHub(stamp: string) {
  const token = randomUUID();
  const calls: string[] = [];
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${token}`) { res.writeHead(req.method === 'POST' ? 401 : 405).end(); return; }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const msg = JSON.parse(body || '{}');
      if (msg.id === undefined) { res.writeHead(202).end(); return; } // notifications
      const result = msg.method === 'initialize'
        ? { protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'workforce', version: 'live' } }
        : msg.method === 'tools/list'
          ? { tools: [{ name: 'office_stamp', description: 'Returns the office stamp of today.', inputSchema: { type: 'object', properties: {} } }] }
          : msg.method === 'tools/call'
            ? (calls.push(String(msg.params?.name)), { content: [{ type: 'text', text: `The stamp is ${stamp}.` }] })
            : undefined;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result ? { jsonrpc: '2.0', id: msg.id, result } : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/mcp`, token, stamp, calls, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test('grok build: account check, models and real turns with a tool and streaming (opt-in)', { skip: live ? false : 'set WORKFORCE_LIVE=1', timeout: 300_000 }, async (t) => {
  const finder = new ExecutableFinder();
  const exe = await finder.find('grok');
  assert.ok(exe, 'Grok Build is installed');
  t.diagnostic(`grok: ${exe.command}`);
  const base = path.join(root, 'test-results', 'grok-live');
  const neutral = path.join(base, 'engine');
  const work = path.join(base, 'work');
  await rm(base, { recursive: true, force: true });
  await mkdir(neutral, { recursive: true });
  await mkdir(work, { recursive: true });
  const secret = `lime-${randomUUID().slice(0, 8)}`;
  await writeFile(path.join(work, 'answer.txt'), `The code word is ${secret}.\n`);

  const supervisor = new Supervisor({});
  const launches = new AcpLaunches({ finder, supervisor, cwd: neutral });
  const engine = new AcpEngine({ supervisor, launch: (account) => launches.resolve(account), cwd: neutral, version: 'live' });
  const account: Account = { id: 'live_grok', provider: 'grok-cli', label: 'Grok Build', auth: 'cli', ...(home ? { home } : {}), state: 'unknown', priority: 0, rotation: false, enabled: true, detected: false, createdAt: 0 };
  try {
    const check = await engine.checkAccount(account);
    t.diagnostic(`check: ${JSON.stringify(check)}`);
    assert.equal(check.state, 'ok', 'the cached sign-in is reused');
    const models = await engine.listModels(account);
    t.diagnostic(`models: ${models.map((m) => `${m.model}${m.efforts?.length ? ` [${m.efforts.join('/')}]` : ''}`).join(', ')}`);
    assert.ok(models.length > 0);

    const turn = async (text: string, session?: { ref: string; generation: number }) => {
      const events: EngineEvent[] = [];
      const result = await engine.run({
        runId: randomUUID(), agentId: 'ag_live', account, model: models[0].model, effort: 'low', session,
        system: { stable: 'You are a test agent. Answer in one short sentence.', volatile: '' },
        input: [{ type: 'text', text }], tools: [], callTool: async () => { throw new Error('no app tools here'); },
        cwd: work, onEvent: (event) => events.push(event), signal: new AbortController().signal,
      });
      return { result, events };
    };

    const first = await turn('Read the file answer.txt in the current folder with your file tool and tell me the code word in it.');
    const kinds = first.events.reduce<Record<string, number>>((all, e) => ({ ...all, [e.type]: (all[e.type] ?? 0) + 1 }), {});
    t.diagnostic(`turn 1: stop=${first.result.stop} error=${JSON.stringify(first.result.error ?? null)} events=${JSON.stringify(kinds)}`);
    t.diagnostic(`turn 1 tools: ${first.events.filter((e) => e.type === 'tool_start').map((e) => (e as { name: string }).name).join(', ')}`);
    assert.ok(!first.result.error, 'the turn ran');
    assert.ok((kinds.tool_start ?? 0) > 0, 'Grok used a tool');
    assert.ok((kinds.text ?? 0) > 1, 'the answer streamed in several chunks');
    assert.match(first.result.text, new RegExp(secret), 'the answer holds what only the file says');

    const ref = first.result.session?.ref;
    assert.ok(ref, 'the turn names its session');
    const second = await turn('What was the code word again? Answer with the word only.', { ref, generation: 1 });
    t.diagnostic(`turn 2: stop=${second.result.stop} text=${JSON.stringify(second.result.text.slice(0, 80))}`);
    assert.match(second.result.text, new RegExp(secret), 'the session remembers the first turn');

    // An Autark tool through the hub: a minimal MCP server (streamable HTTP, JSON answers) behind the engine's proxy.
    const hub = await mcpHub(`stamp-${randomUUID().slice(0, 6)}`);
    try {
      const events: EngineEvent[] = [];
      const result = await engine.run({
        runId: randomUUID(), agentId: 'ag_live', account, model: models[0].model, effort: 'low',
        system: { stable: 'You are a test agent. Answer in one short sentence.', volatile: '' },
        input: [{ type: 'text', text: 'Call the tool office_stamp (from the workforce MCP server) and tell me the stamp it returns.' }], tools: [],
        callTool: async () => { throw new Error('no dynamic tools on ACP'); }, mcp: { url: hub.url, token: hub.token },
        cwd: work, onEvent: (event) => events.push(event), signal: new AbortController().signal,
      });
      t.diagnostic(`hub turn: stop=${result.stop} calls=${hub.calls.join(',')} tools=${events.filter((e) => e.type === 'tool_start').map((e) => (e as { name: string }).name).join(', ')}`);
      assert.ok(hub.calls.includes('office_stamp'), 'Grok called the Autark tool through the hub');
      assert.match(result.text, new RegExp(hub.stamp), 'and answered with its result');
    } finally { await hub.close(); }
  } finally {
    await engine.dispose();
    await supervisor.killAll();
  }
});
