// B-085 – wf run by an agent: AUTARK_AGENT beside AUTARK_DATA of the same data folder puts `agent` into the Hello
// (wf-cli/discover.ts agentOf); a wf aimed at another data folder (--data elsewhere, no or another AUTARK_DATA) or a
// malformed id sends none.
// Owns: these assertions only. Never: reads the person's real app data or connects anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Endpoint, agentOf, discover, type DiscoverEnv } from '../../../src/runtime/wf-cli/discover.ts';

const DATA = 'C:\\Users\\Ann\\AppData\\Roaming\\Autark';
const INFO = JSON.stringify({ port: 4321, token: 'owner-token-0123456789abcdef', pid: 77 });

function env(vars: Record<string, string | undefined>): DiscoverEnv {
  const files: Record<string, string> = { [`${DATA}\\runtime.json`]: INFO, ['D:\\Other\\runtime.json']: INFO };
  return {
    platform: 'win32', env: vars, home: 'C:\\Users\\Ann', cwd: 'C:\\work',
    readFile: (file) => { if (!(file in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files[file]!; },
    alive: () => true,
  };
}

test("an agent's wf names it in the Hello – only for its own data folder", () => {
  const own = discover({}, env({ AUTARK_DATA: DATA, AUTARK_AGENT: 'ag_ava' }));
  assert.ok(own.ok);
  assert.equal(own.endpoint.agent, 'ag_ava');
  assert.equal(own.endpoint.hello().agent, 'ag_ava');
  const same = discover({ data: `${DATA}\\` }, env({ AUTARK_DATA: DATA.toLowerCase(), AUTARK_AGENT: 'ag_ava' }));
  assert.ok(same.ok && same.endpoint.agent === 'ag_ava', 'the same folder spelled otherwise (case on Windows, a trailing separator)');
  const other = discover({ data: 'D:\\Other' }, env({ AUTARK_DATA: DATA, AUTARK_AGENT: 'ag_ava' }));
  assert.ok(other.ok);
  assert.equal(other.endpoint.hello().agent, undefined, 'another company: as the person there');
  const person = discover({}, env({ APPDATA: 'C:\\Users\\Ann\\AppData\\Roaming' }));
  assert.ok(person.ok);
  assert.deepEqual(Object.keys(person.endpoint.hello()).sort(), ['client', 'protocol', 'token'], "the person's wf as before");
});

test('agentOf: no AUTARK_DATA, an empty or malformed id gives none', () => {
  const base = { platform: 'win32' as const, cwd: 'C:\\work' };
  assert.equal(agentOf({ ...base, env: { AUTARK_AGENT: 'ag_ava' } }, DATA), undefined);
  assert.equal(agentOf({ ...base, env: { AUTARK_DATA: DATA, AUTARK_AGENT: ' ' } }, DATA), undefined);
  assert.equal(agentOf({ ...base, env: { AUTARK_DATA: DATA, AUTARK_AGENT: 'ag ava; x' } }, DATA), undefined);
  assert.equal(agentOf({ platform: 'linux', cwd: '/w', env: { AUTARK_DATA: '/d/Autark/', AUTARK_AGENT: 'ag_1' } }, '/d/Autark'), 'ag_1');
  assert.equal(agentOf({ platform: 'linux', cwd: '/w', env: { AUTARK_DATA: '/d/autark', AUTARK_AGENT: 'ag_1' } }, '/d/Autark'), undefined, 'case counts outside Windows');
  assert.equal(JSON.stringify(new Endpoint({ dataDir: DATA, port: 1, token: 'secret-token-value', agent: 'ag_1' })).includes('secret-token-value'), false);
});
