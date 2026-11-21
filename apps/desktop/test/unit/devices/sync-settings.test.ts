// Settings between the CEO's PCs (devices/sync/settings.ts), one stamp per section: a PC that joins as CEO adopts the
// existing company's name, owner and picture even when its own devices section changes at the link (the live bug of
// 04.11.2026: the new company's empty profile overwrote the main PC's); a section is stamped only when it really
// changes (a baseline at 0 before that); a change in one section never resets another; at the first link an empty
// text never clears the joiner's name (it goes back instead), while a text cleared later travels and stays cleared;
// a section only the joiner has reaches the other PC; an older single 'settings' stamp counts for every section.
// B-080: a key of a known section this PC does not know (a newer PC's) is left out of the patch and the rest applies –
// no more refusal of every section (live: voice.dictation); the shared keys of every section are pinned, so a key
// added to a section older PCs know becomes an OWN_UNITS entry or changes the pin on purpose (CONTRACT rule 9).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { Settings } from '../../../src/shared/model/system.ts';
import { DevicesRepo, type DeviceRecord } from '../../../src/runtime/devices/repo.ts';
import { SettingsSync, settingsPatch, type SettingsMessage } from '../../../src/runtime/devices/sync/settings.ts';
import { Stamps, hashOf } from '../../../src/runtime/devices/sync/stamps.ts';
import { deepMerge } from '../../../src/runtime/settings/validate.ts';
import { SECTIONS } from '../../../src/runtime/settings/schema.ts';
import { ManualClock, memoryDb, recordingBus, silentLog } from './fakes.ts';

const AVATAR = 'a'.repeat(64);

const record = (id: string, extra: Partial<DeviceRecord> = {}): DeviceRecord => ({
  id, name: id, kind: 'pc', role: 'home', fingerprint: `fp_${id}`, addresses: [], caps: {}, status: 'online', self: false, ...extra,
});

interface Pc { id: string; sync: SettingsSync; stamps: Stamps; store: { current: Settings }; clock: ManualClock; s: RuntimeServices; up: boolean }

/** Two PCs whose settings syncs reach each other directly (the mesh carries 'sync.file' op 'settings' the same way). */
function makePcs(a: Record<string, unknown>, b: Record<string, unknown>): [Pc, Pc] {
  const pcs = new Map<string, Pc>();
  const make = (id: string, settings: Record<string, unknown>, start: number): Pc => {
    const db = memoryDb();
    const { bus } = recordingBus();
    const clock = new ManualClock(start);
    new DevicesRepo(db).upsert(record(id, { self: true }));
    const store = { current: settings as unknown as Settings };
    const s = {
      db, bus, clock, log: silentLog,
      settings: { get: () => store.current, update: (patch: unknown) => { store.current = deepMerge(store.current, patch); bus.emit('settings.updated', store.current); return store.current; } },
    } as unknown as RuntimeServices;
    const stamps = new Stamps(db, clock);
    const pc: Pc = { id, store, clock, s, stamps, up: true, sync: undefined as unknown as SettingsSync };
    pc.sync = new SettingsSync(s, stamps, (message, except) => {
      for (const other of pcs.values()) {
        if (other.id === id || other.id === except || !other.up || !pc.up) continue;
        other.sync.receive(JSON.parse(JSON.stringify(message)) as SettingsMessage, id, other.id === 'dev_b');
      }
    });
    pcs.set(id, pc);
    return pc;
  };
  return [make('dev_a', a, 1_000_000), make('dev_b', b, 2_000_000)];
}

/** The link-up both ways: each PC sends its current copy (B joined A). */
function linkUp(a: Pc, b: Pc): void {
  b.sync.receive(JSON.parse(JSON.stringify(a.sync.current())) as SettingsMessage, a.id, true);
  a.sync.receive(JSON.parse(JSON.stringify(b.sync.current())) as SettingsMessage, b.id, false);
}

const profileOf = (pc: Pc) => pc.store.current.profile as unknown as Record<string, unknown>;
/** A settings edit on `pc` (any keys: the fake store takes them like the real one's patch). */
const edit = (pc: Pc, patch: Record<string, unknown>) => pc.s.settings.update(patch as never);

test('a PC that joins as CEO adopts the company name, the owner and the picture – its devices change at the link stamps nothing', () => {
  const [a, b] = makePcs(
    { profile: { name: 'Alex', company: 'Berger', avatarFileId: AVATAR }, routing: { work: 'auto' }, devices: { peerPort: 1 } },
    { profile: { name: '', company: '' }, routing: { work: 'auto' }, devices: { peerPort: 2 } },
  );
  const offs = [a.sync.attach(), b.sync.attach()];
  a.up = false; // the link exists, the channel is not up yet
  edit(b, { devices: { peerPort: 3, peer: 'lan' } }); // the new company's link writes its devices section
  assert.equal(b.stamps.get('settings/profile')?.at, 0, 'no shared change, no stamp: the baseline stays at 0');
  a.up = true;
  linkUp(a, b);
  assert.deepEqual(profileOf(b), { name: 'Alex', company: 'Berger', avatarFileId: AVATAR }, 'the joiner takes the company\'s profile');
  assert.deepEqual(profileOf(a), { name: 'Alex', company: 'Berger', avatarFileId: AVATAR }, 'the existing PC keeps it');
  assert.equal((b.store.current.devices as unknown as { peerPort: number }).peerPort, 3, 'its own devices section stays');
  for (const off of offs) off();
});

test('a change in one section never resets another: the later routing and the later name both win', () => {
  const [a, b] = makePcs(
    { profile: { name: 'Alex' }, routing: { work: 'auto' } },
    { profile: { name: 'Alex' }, routing: { work: 'auto' } },
  );
  const offs = [a.sync.attach(), b.sync.attach()];
  a.up = false;
  edit(a, { profile: { name: 'Alex Berger' } }); // A, at 1 000 000
  edit(b, { routing: { work: 'acc_1:gpt' } }); // B, later: at 2 000 000
  a.up = true;
  linkUp(a, b);
  for (const pc of [a, b]) {
    assert.equal(profileOf(pc).name, 'Alex Berger', `${pc.id}: A's name stays`);
    assert.equal((pc.store.current.routing as unknown as { work: string }).work, 'acc_1:gpt', `${pc.id}: B's routing arrives`);
  }
  for (const off of offs) off();
});

test('at the first link an empty name never clears the joiner\'s name – it goes back to the other PC instead', () => {
  const [a, b] = makePcs(
    { profile: { name: '', company: '' }, routing: { work: 'auto' } },
    { profile: { name: 'Alex', company: 'Berger' }, routing: { work: 'auto' } },
  );
  const offs = [a.sync.attach(), b.sync.attach()];
  linkUp(a, b);
  assert.deepEqual(profileOf(b), { name: 'Alex', company: 'Berger' }, 'the joiner keeps its texts');
  assert.deepEqual(profileOf(a), { name: 'Alex', company: 'Berger' }, 'what it kept went back');
  for (const off of offs) off();
});

test('a text cleared later travels like any change and stays cleared on the PC that cleared it', () => {
  const voice = { realtime: 'off', localStt: 'whisper', ttsVoice: 'anna' };
  const [a, b] = makePcs({ voice }, { voice });
  const offs = [a.sync.attach(), b.sync.attach()];
  edit(a, { voice: { localStt: '', ttsVoice: null } }); // B online: no local speech recognition, the default voice
  for (const pc of [a, b]) assert.deepEqual(pc.store.current.voice, { realtime: 'off', localStt: '' }, `${pc.id}: at once`);

  edit(b, { voice: { localStt: 'whisper', ttsVoice: 'anna' } });
  for (const pc of [a, b]) assert.deepEqual(pc.store.current.voice, voice, `${pc.id}: set again on B`);
  b.up = false;
  edit(a, { voice: { localStt: '', ttsVoice: null } }); // A clears them while B is away
  b.up = true;
  linkUp(a, b);
  for (const pc of [a, b]) assert.deepEqual(pc.store.current.voice, { realtime: 'off', localStt: '' }, `${pc.id}: after the link-up`);
  for (const off of offs) off();
});

test('a section only the joiner has reaches the PC it joined', () => {
  const provider = { prv_1: { kind: 'openai', label: 'OpenAI', secretId: 'sec_1' } };
  const [a, b] = makePcs({ profile: { name: 'Alex' } }, { profile: { name: '' }, providers: provider });
  const offs = [a.sync.attach(), b.sync.attach()];
  linkUp(a, b);
  for (const pc of [a, b]) {
    assert.equal(profileOf(pc).name, 'Alex', `${pc.id}: the company's name`);
    assert.deepEqual(pc.store.current.providers, provider, `${pc.id}: the joiner's API connection`);
  }
  for (const off of offs) off();
});

test('an older single settings stamp counts for every section; then a change stamps only its own section', () => {
  const [a] = makePcs({ profile: { name: 'Alex' }, routing: { work: 'auto' }, voice: { realtime: 'off' } }, {});
  a.stamps.set('settings', { at: 5000, h: 'whole file' });
  const off = a.sync.attach();
  assert.equal(a.stamps.get('settings'), undefined, 'the single stamp is gone');
  for (const section of ['profile', 'routing', 'voice']) assert.equal(a.stamps.get(`settings/${section}`)?.at, 5000, section);
  edit(a, { voice: { realtime: 'auto' } });
  assert.ok(a.stamps.get('settings/voice')!.at > 5000, 'the changed section is stamped now');
  assert.equal(a.stamps.get('settings/profile')?.at, 5000, 'the others keep theirs');
  assert.deepEqual(Object.keys(a.sync.current().sections).sort(), ['profile', 'profile.forEveryAgent', 'profile.notes', 'profile.pcAccess', 'routing', 'routing.accountFallback', 'routing.fallbacks', 'voice'], 'the link-up sends every section (and the units profile.notes, profile.pcAccess, profile.forEveryAgent, routing.accountFallback, routing.fallbacks)');
  off();
});

test('the patch: a later copy makes the section equal; at the first link the joiner merges and an empty text never replaces its own', () => {
  const local = { profile: { name: 'Lena', company: 'Berger', timezone: 'Europe/Vienna' }, voice: { talker: true, realtime: 'off' }, devices: { peerPort: 1 } } as unknown as Settings;
  const incoming = { profile: { name: '', company: null }, voice: { realtime: 'auto' } };
  assert.deepEqual(
    settingsPatch(local, incoming),
    { profile: { name: '', company: null, timezone: null }, voice: { talker: null, realtime: 'auto' } },
    'a cleared text and a key the copy lacks follow',
  );
  assert.deepEqual(settingsPatch(local, incoming, true), { voice: { realtime: 'auto' } }, 'merging: the texts and what only this PC has stay');
  assert.deepEqual(settingsPatch(local, { profile: { name: 'Lena Berg' } }), { profile: { name: 'Lena Berg', company: null, timezone: null } }, 'a set text replaces one');
  assert.deepEqual(settingsPatch(local, { devices: { peerPort: 9 } }), {}, 'this PC\'s own sections never change');
});

test('B-078 with a 0.3.x PC: profile.notes travels as its own unit – the profile looks as before and an older copy never clears it', () => {
  const [a, b] = makePcs(
    { profile: { name: 'Alex', notes: 'German at work, du' }, library: { publish: true }, routing: { work: 'auto' } },
    { profile: { name: 'Alex', notes: '' }, library: { publish: true }, routing: { work: 'auto' } },
  );
  const offs = [a.sync.attach(), b.sync.attach()];
  // What an older PC gets from here: a profile without notes (the hash it computes itself), plus units it skips.
  const copy = a.sync.current();
  assert.deepEqual(copy.sections.profile.value, { name: 'Alex' });
  assert.equal(copy.sections.profile.h, hashOf({ name: 'Alex' }), 'the older PC sees no change of its own');
  assert.equal(copy.sections['profile.notes']!.value, 'German at work, du');
  assert.deepEqual(Object.keys(copy.sections).sort(), ['library', 'profile', 'profile.forEveryAgent', 'profile.notes', 'profile.pcAccess', 'routing', 'routing.accountFallback', 'routing.fallbacks'], '0.3.x skips library and the units (no settings sections there)');
  // The older PC's message: its profile without notes, stamped later – the name follows, the notes stay.
  const old: SettingsMessage = { sections: { profile: { at: 9_000_000, h: hashOf({ name: 'Stan' }), value: { name: 'Stan' } } } };
  a.sync.receive(old, 'dev_old', false);
  assert.deepEqual(profileOf(a), { name: 'Stan', notes: 'German at work, du' });
  // Between two new PCs the notes travel, and clearing them travels too; the rest of the profile is untouched.
  a.clock.advance(10_000_000);
  edit(a, { profile: { notes: 'English with clients' } });
  assert.equal(profileOf(b).notes, 'English with clients');
  assert.equal(profileOf(b).name, 'Stan', 'the profile came along with the older PC\'s name');
  b.clock.advance(20_000_000);
  edit(b, { profile: { notes: null } });
  assert.equal(profileOf(a).notes, undefined, 'cleared on the other PC as well');
  assert.equal(profileOf(a).name, 'Stan');
  // At the first link an empty notes text never replaces one that is set.
  const local = { profile: { name: 'Stan', notes: 'du' } } as unknown as Settings;
  assert.deepEqual(settingsPatch(local, { 'profile.notes': '' }, true), {});
  assert.deepEqual(settingsPatch(local, { 'profile.notes': 'Sie' }), { profile: { notes: 'Sie' } });
  for (const off of offs) off();
});

test('B-085 with a 0.3.4 PC: profile.pcAccess travels as its own unit – an older copy of the profile never clears it', () => {
  const [a, b] = makePcs(
    { profile: { name: 'Alex', pcAccess: 'careful' }, routing: { work: 'auto' } },
    { profile: { name: 'Alex' }, routing: { work: 'auto' } },
  );
  const offs = [a.sync.attach(), b.sync.attach()];
  const copy = a.sync.current();
  assert.deepEqual(copy.sections.profile.value, { name: 'Alex' }, 'the profile looks as it does on 0.3.4');
  assert.equal(copy.sections['profile.pcAccess']!.value, 'careful');
  // The older PC wins the profile (its person edited the name there): the name follows, careful stays.
  const old: SettingsMessage = { sections: { profile: { at: 9_000_000, h: hashOf({ name: 'Stan' }), value: { name: 'Stan' } } } };
  a.sync.receive(old, 'dev_old', false);
  assert.deepEqual(profileOf(a), { name: 'Stan', pcAccess: 'careful' });
  // Between two new PCs the choice travels: full access given on A reaches B.
  a.clock.advance(10_000_000);
  edit(a, { profile: { pcAccess: 'whole' } });
  assert.equal(profileOf(b).pcAccess, 'whole');
  // At the first link a missing choice never replaces one that is set.
  const local = { profile: { name: 'Stan', pcAccess: 'careful' } } as unknown as Settings;
  assert.deepEqual(settingsPatch(local, { 'profile.pcAccess': null }, true), {});
  for (const off of offs) off();
});

test('16.11.2026 with a 0.3.8 PC: profile.forEveryAgent travels as its own unit – an older copy of the profile never resets it', () => {
  const [a, b] = makePcs(
    { profile: { name: 'Alex', forEveryAgent: 'I sign with my name.' }, routing: { work: 'auto' } },
    { profile: { name: 'Alex', forEveryAgent: '' }, routing: { work: 'auto' } },
  );
  const offs = [a.sync.attach(), b.sync.attach()];
  const copy = a.sync.current();
  assert.deepEqual(copy.sections.profile.value, { name: 'Alex' }, 'the profile looks as it does on 0.3.8');
  assert.equal(copy.sections['profile.forEveryAgent']!.value, 'I sign with my name.');
  const old: SettingsMessage = { sections: { profile: { at: 9_000_000, h: hashOf({ name: 'Stan' }), value: { name: 'Stan' } } } };
  a.sync.receive(old, 'dev_old', false);
  assert.deepEqual(profileOf(a), { name: 'Stan', forEveryAgent: 'I sign with my name.' });
  a.clock.advance(10_000_000);
  edit(a, { profile: { forEveryAgent: 'I answer in German.' } });
  assert.equal(profileOf(b).forEveryAgent, 'I answer in German.', 'between two new PCs the text travels');
  for (const off of offs) off();
});

test('B-080: a newer PC\'s key in a known section is left out of the patch; the rest of every section applies', () => {
  const local = { voice: { realtime: 'off', vocabulary: [] }, profile: { name: 'Alex' } } as unknown as Settings;
  assert.deepEqual(settingsPatch(local, { voice: { realtime: 'auto', vocabulary: [], dictation: 'local' }, profile: { name: 'Alex', mood: 'calm' } }),
    { voice: { realtime: 'auto' } }, 'voice.dictation and profile.mood are no keys here');
  const [a] = makePcs({ profile: { name: 'Alex' }, voice: { realtime: 'off' }, routing: { work: 'auto' } }, {});
  const updates: unknown[] = [];
  const update = a.s.settings.update.bind(a.s.settings);
  a.s.settings.update = ((patch: Record<string, unknown>) => {
    // The real store refuses an unknown key (settings/validate.ts checkPatchShape) – the whole patch would fail.
    if (JSON.stringify(patch).includes('dictation')) throw new Error('Invalid setting voice.dictation: expected a known key.');
    updates.push(patch);
    return update(patch as never);
  }) as typeof a.s.settings.update;
  const message: SettingsMessage = { sections: {
    voice: { at: 9_000_000, h: hashOf({ realtime: 'auto', dictation: 'local' }), value: { realtime: 'auto', dictation: 'local' } },
    routing: { at: 9_000_000, h: hashOf({ work: 'acc_1:gpt' }), value: { work: 'acc_1:gpt' } },
  } };
  assert.doesNotThrow(() => a.sync.receive(message, 'dev_old', false));
  assert.equal((a.store.current.voice as unknown as { realtime: string }).realtime, 'auto');
  assert.equal('dictation' in (a.store.current.voice as unknown as Record<string, unknown>), false);
  assert.equal((a.store.current.routing as unknown as { work: string }).work, 'acc_1:gpt', 'the other section of the message applies too');
  assert.equal(updates.length, 1);
});

/**
 * B-080 (CONTRACT rule 9): the keys each shared settings section carries as of this build. A key added to a section that
 * older PCs know makes them drop it on the way in and send the section back without it – such a key becomes an
 * OWN_UNITS entry (devices/sync/settings.ts) or, for a section no older PC has, this pin changes on purpose.
 */
const SHARED_KEYS: Record<string, string[]> = {
  profile: ['name', 'company', 'avatarFileId', 'language', 'timezone', 'notes', 'pcAccess', 'forEveryAgent'], // notes, pcAccess, forEveryAgent: OWN_UNITS
  personality: ['tone', 'address', 'language', 'emoji', 'length', 'instructions'], // Autark-Plus section: no upstream PC knows it
  preferences: ['theme', 'sidebarOpen', 'sidebarWidth', 'workspaceOpen', 'workspaceWidth', 'enterSends', 'whileWorking', 'dictationSend', 'closeToTray', 'openAtLogin', 'autoDownloadUpdates'], // whileWorking, dictationSend: OWN_UNITS
  appearance: ['chatDock', 'theme', 'themes', 'panels', 'hiddenPanels', 'uiScale', 'uiScalePhone'], // Autark-Plus section: no upstream PC knows it
  notifications: ['enabled', 'sound', 'computerUse', 'quietHours', 'pushFor'], // computerUse: OWN_UNITS
  voice: ['ttsVoice', 'vocabulary', 'realtime', 'talker', 'localStt', 'localTts'],
  routing: ['work', 'decision', 'voice', 'stt', 'tts', 'image', 'video', 'music', 'sound', 'embeddings', 'costMode', 'allowPaidFallback', 'accountFallback', 'fallbacks'], // accountFallback, fallbacks: OWN_UNITS
  providers: [],
  day: ['workStart', 'workEnd', 'bufferMin', 'autoPlan', 'planAt', 'aiHelps', 'keepAwake', 'agentLane'],
  calendar: ['googleClientId', 'googleSecretId'],
  lifecycle: ['retention'],
  feedback: ['includeDiagnostics', 'githubRepo'], // githubRepo: OWN_UNITS
  library: ['publish'],
  onboarding: ['completed', 'step', 'tour', 'tourStep', 'hints'], // tour, tourStep, hints: OWN_UNITS
};

test('B-080: the shared keys of every known settings section are pinned (voice.dictation is gone)', () => {
  const shared = Object.fromEntries(SECTIONS.filter((section) => !['devices', 'pwa'].includes(section.key)).map((section) => [section.key, section.keys.map((key) => key.key)]));
  assert.deepEqual(shared, SHARED_KEYS, 'a key added to a known section: an OWN_UNITS entry, or this pin on purpose');
  assert.equal(SHARED_KEYS.voice.includes('dictation'), false);
});
