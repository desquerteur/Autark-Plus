// Owns: Settings › Security's change log (runtime/settings/security-log.ts): who changed the access level, the line for
// every agent or (17.11.2026) sharing in the public library, when, old → new – by an agent's wf, the person's window, a phone, and by no caller at all (settings.json);
// the caller counts only for what its own patch carries, and a change made while Autark was off is noticed at the start.
// Never: the page or the RPC server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bus } from '../../../src/runtime/bus.ts';
import { actingAs, actorOf, readSecurityChanges, startSecurityLog, type LogKv } from '../../../src/runtime/settings/security-log.ts';
import { SECURITY_LOG_MAX, SECURITY_LOG_TEXT } from '../../../src/shared/model/security-log.ts';
import type { ClientScope } from '../../../src/shared/api/protocol.ts';
import type { Settings } from '../../../src/shared/model/system.ts';

function world(store = new Map<string, unknown>(), profile: Record<string, unknown> = {}) {
  const kv: LogKv = { get: <T>(ns: string, key: string) => store.get(`${ns}/${key}`) as T | undefined, set: (ns, key, value) => { store.set(`${ns}/${key}`, value); } };
  const bus = new Bus();
  let settings = { profile: { name: 'Stan', pcAccess: 'whole', forEveryAgent: 'No captchas.', ...profile } } as unknown as Settings;
  let clock = 1000;
  const change = (next: Record<string, unknown>) => { settings = { ...settings, profile: { ...settings.profile, ...next } } as Settings; bus.emit('settings.updated', settings); };
  const stop = startSecurityLog({ bus: bus as never, settings: { get: () => settings }, kv, now: () => (clock += 10) });
  return { kv, store, change, stop };
}
const lookup = { person: () => 'Stan', agent: (id: string) => (id === 'ag_1' ? 'Felix' : undefined) };
const STAN = { kind: 'person', name: 'Stan' } as const;

test('an agent changing the line for every agent is written down with its name, time and both texts', () => {
  const { kv, change } = world();
  const by = actorOf({ kind: 'owner', agentId: 'ag_1' }, lookup);
  const patch = { profile: { forEveryAgent: 'Captchas are fine.' } };
  actingAs(by, patch, () => change(patch.profile));
  assert.deepEqual(readSecurityChanges(kv), [{ at: 1020, field: 'forEveryAgent', by: { kind: 'agent', id: 'ag_1', name: 'Felix' }, from: 'No captchas.', to: 'Captchas are fine.' }]);
});

test('the person is the window or main; the launch token alone names nobody; a phone and an unknown agent are named', () => {
  assert.deepEqual(actorOf({ kind: 'owner', window: true }, lookup), STAN);
  assert.deepEqual(actorOf({ kind: 'owner', main: true }, lookup), STAN);
  const token = actorOf({ kind: 'owner' }, lookup); // wf outside an agent's turn, a script, POST /rpc with the launch token
  assert.equal(token.kind, 'other');
  assert.match(token.name, /no agent named/);
  assert.deepEqual(actorOf({ kind: 'owner', window: true, agentId: 'ag_1' }, lookup), { kind: 'agent', id: 'ag_1', name: 'Felix' }, 'a named agent wins');
  assert.deepEqual(actorOf({ kind: 'device', deviceId: 'd1', capabilities: ['settings'], secure: true } as ClientScope, lookup), { kind: 'phone', id: 'd1', name: "Stan's phone" });
  assert.deepEqual(actorOf({ kind: 'owner', agentId: 'ag_x' }, lookup), { kind: 'agent', id: 'ag_x', name: 'An agent' });
});

test('a change with no caller is "other"', () => {
  const { kv, change } = world();
  change({ pcAccess: 'careful' });
  const [entry] = readSecurityChanges(kv);
  assert.equal(entry?.by.kind, 'other');
  assert.equal(entry?.from, 'whole');
  assert.equal(entry?.to, 'careful');
});

test('a caller is named only for what its own patch carries (an edit of settings.json taken over by the same update is not its change)', () => {
  const { kv, change } = world();
  // the person saves their name; the same update carries an edit of settings.json nobody handed over yet
  actingAs(STAN, { profile: { name: 'Alexander' } }, () => change({ name: 'Alexander', forEveryAgent: 'Changed in the file.' }));
  assert.deepEqual(readSecurityChanges(kv).map((entry) => [entry.field, entry.by.kind]), [['forEveryAgent', 'other']]);
  // both in one update: the patch's own field is the caller's, the other one is not
  actingAs(STAN, { profile: { pcAccess: 'careful' } }, () => change({ pcAccess: 'careful', forEveryAgent: 'Again in the file.' }));
  const byField = new Map(readSecurityChanges(kv).slice(0, 2).map((entry) => [entry.field, entry.by.kind]));
  assert.deepEqual([byField.get('pcAccess'), byField.get('forEveryAgent')], ['person', 'other']);
  // a patch without a profile, and one that resets the whole section
  actingAs(STAN, { voice: {} }, () => change({ pcAccess: 'whole' }));
  assert.equal(readSecurityChanges(kv)[0]?.by.kind, 'other');
  actingAs(STAN, { profile: null }, () => change({ pcAccess: 'careful' }));
  assert.equal(readSecurityChanges(kv)[0]?.by.kind, 'person');
});

test('only the two security settings count, and a save that changes nothing writes nothing', () => {
  const { kv, change } = world();
  change({ name: 'Alexander' });
  change({ pcAccess: 'whole', forEveryAgent: ' No captchas.\r\n' });
  assert.deepEqual(readSecurityChanges(kv), []);
});

test('both settings in one update are two entries, newest first, and the log keeps SECURITY_LOG_MAX of them', () => {
  const { kv, change } = world();
  change({ pcAccess: 'careful', forEveryAgent: 'x' });
  assert.deepEqual(readSecurityChanges(kv).map((entry) => entry.field).sort(), ['forEveryAgent', 'pcAccess']);
  for (let i = 0; i < SECURITY_LOG_MAX + 5; i++) change({ forEveryAgent: `text ${i}` });
  const log = readSecurityChanges(kv);
  assert.equal(log.length, SECURITY_LOG_MAX);
  assert.equal(log[0]?.to, `text ${SECURITY_LOG_MAX + 4}`);
});

test('a very long text is cut, and a stopped log writes nothing more', () => {
  const { kv, change, stop } = world();
  change({ forEveryAgent: 'y'.repeat(SECURITY_LOG_TEXT + 100) });
  assert.equal(readSecurityChanges(kv)[0]?.to.length, SECURITY_LOG_TEXT + 1);
  stop();
  change({ pcAccess: 'careful' });
  assert.equal(readSecurityChanges(kv).length, 1);
});

test('the caller name does not leak into the next update', () => {
  const { kv, change } = world();
  actingAs(STAN, { profile: { pcAccess: 'careful' } }, () => change({ pcAccess: 'careful' }));
  change({ pcAccess: 'whole' });
  assert.deepEqual(readSecurityChanges(kv).map((entry) => entry.by.kind), ['other', 'person']);
});

test('a change made while Autark was not running gets its entry at the next start; a first start only remembers', () => {
  const first = world();
  assert.deepEqual(readSecurityChanges(first.kv), [], 'nothing known before: no entry');
  assert.deepEqual(first.store.get('security/last'), { pcAccess: 'whole', forEveryAgent: 'No captchas.', libraryPublish: 'on' });
  first.change({ pcAccess: 'careful' });
  first.stop();
  // the app is off; settings.json is edited; the next start sees other values than it remembered
  const second = world(first.store, { pcAccess: 'careful', forEveryAgent: 'Edited while off.' });
  const [entry, earlier] = readSecurityChanges(second.kv);
  assert.deepEqual([entry?.field, entry?.by.name, entry?.from, entry?.to], ['forEveryAgent', 'While Autark was not running', 'No captchas.', 'Edited while off.']);
  assert.equal(earlier?.field, 'pcAccess', 'the entry of the running time stays');
  second.stop();
  const third = world(first.store, { pcAccess: 'careful', forEveryAgent: 'Edited while off.' });
  assert.equal(readSecurityChanges(third.kv).length, 2, 'the same values again: nothing new');
});

test('17.11.2026: turning sharing in the public library off or on is written down, named for the patch that carries it', () => {
  const store = new Map<string, unknown>();
  const kv: LogKv = { get: <T>(ns: string, key: string) => store.get(`${ns}/${key}`) as T | undefined, set: (ns, key, value) => { store.set(`${ns}/${key}`, value); } };
  const bus = new Bus();
  let settings = { profile: { name: 'Stan' } } as unknown as Settings; // no library section: sharing counts as on
  const set = (library: unknown) => { settings = { ...settings, library } as Settings; bus.emit('settings.updated', settings); };
  let clock = 0;
  startSecurityLog({ bus: bus as never, settings: { get: () => settings }, kv, now: () => (clock += 10) });
  actingAs(STAN, { library: { publish: false } }, () => set({ publish: false }));
  actingAs({ kind: 'agent', id: 'ag_1', name: 'Felix' }, { profile: { name: 'x' } }, () => set({ publish: true })); // its patch carries no library key
  actingAs(STAN, { library: null }, () => set({ publish: false })); // a whole-section reset names the caller too
  assert.deepEqual(readSecurityChanges(kv).map((entry) => [entry.field, entry.by.name, entry.from, entry.to]), [
    ['libraryPublish', 'Stan', 'on', 'off'],
    ['libraryPublish', 'settings.json or a linked PC', 'off', 'on'],
    ['libraryPublish', 'Stan', 'on', 'off'],
  ]);
});

test('17.11.2026: a PC whose stored values predate the library field writes no entry for it and remembers it from then on', () => {
  const store = new Map<string, unknown>([['security/last', { pcAccess: 'whole', forEveryAgent: 'No captchas.' }]]);
  const first = world(store);
  assert.deepEqual(readSecurityChanges(first.kv), [], 'an update of the app is not a change of the setting');
  assert.equal((store.get('security/last') as Record<string, string>).libraryPublish, 'on');
  first.stop();
});
