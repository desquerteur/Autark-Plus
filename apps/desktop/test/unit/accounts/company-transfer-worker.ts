// Two-process HTTP fixture. Synthetic databases, homes, owner tokens and injected OS inventory only.
import { createServer, request } from 'node:http';
import path from 'node:path';
import { HomeOwners } from '../../../src/runtime/accounts/home-owner.ts';
import { HandlerTable, allowedScope } from '../../../src/runtime/rpc/table.ts';
import { register } from '../../../src/runtime/rpc/handlers/providers.ts';
import type { HandlerContext } from '../../../src/runtime/rpc/table.ts';
import type { TransferCommand } from '../../../src/shared/model/account-transfer.ts';
import { harness, row } from './harness.ts';
const [root, company] = process.argv.slice(2);
const data = path.join(root, company);
const owners = new HomeOwners(path.join(root, 'machine'), { company, data, accounts: path.join(data, 'accounts') });
const h = harness({ accounts: owners.runtime.accounts, homeOwners: owners });
if (company === 'source') h.repo.save(row('acc_source', { provider: 'claude', auth: 'cli', home: path.join(data, 'accounts', 'claude', 'acc_source'), state: 'needs_login', enabled: false }));
let peers: Record<string, { port: number; pid: number }> = {};
const table = new HandlerTable(); register(table);
const server = createServer((req, res) => {
  if (req.headers.authorization !== `Bearer synthetic-${company}`) { res.writeHead(401).end(); return; }
  let text = ''; req.on('data', c => { text += String(c); });
  req.on('end', async () => {
    try {
      const { method, params } = JSON.parse(text);
      const entry = table.get(method);
      if (!entry || !allowedScope(entry.scope, { kind: 'owner' })) throw new Error('forbidden');
      const result = await entry.handler(params, { scope: { kind: 'owner' }, services: { accounts: h.service }, topics: new Set(), signal: new AbortController().signal } as unknown as HandlerContext);
      res.end(JSON.stringify({ result }));
    } catch (e) { res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'error' })); }
  });
});
function call(peer: string, command: TransferCommand): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: peers[peer].port, path: '/rpc', method: 'POST', headers: { Authorization: `Bearer synthetic-${peer}` } }, res => {
      let text = ''; res.on('data', c => { text += String(c); }); res.on('end', () => { const reply = JSON.parse(text); reply.error ? reject(new Error(reply.error)) : resolve(reply.result); });
    }); req.on('error', reject); req.end(JSON.stringify({ method: 'accounts.transfer', params: command }));
  });
}
process.on('message', message => {
  const m = message as { peers?: typeof peers; stop?: boolean };
  if (m.peers) {
    peers = m.peers;
    h.service.configureTransfers({ peer: c => ({ data: path.join(root, c), pid: peers[c].pid }), call, externalQuiet: async () => ({ probeId: 'two-runtime-process-fixture', runtimeBoot: owners.runtime.boot, at: Date.now(), pids: [] }) });
    process.send?.({ configured: true });
  }
  if (m.stop) server.close(() => { h.db.close(); process.exit(0); });
});
server.listen(0, '127.0.0.1', () => process.send?.({ port: (server.address() as { port: number }).port, pid: process.pid }));
