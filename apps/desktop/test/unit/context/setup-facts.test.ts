// Live setup facts (O2): no turn carries them (E1: they read like a setup checklist) – the app.status tool (G1: was
// setup.status) returns the whole '## App status (live)' text: agents, accounts, strong models, the models for
// decisions and search by name, the app's switches; no account secrets (email, home, base URL, secret id, limits),
// failing sources skipped; offered by the registry in the '*' modes (manager, general, secretary), hidden by specialist
// modes (not a core tool).
// B-080: an account names what holds it – its return time or cooling (09.11.2026: each one its own; every plan takes turns).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { agent } from '../chat/harness.ts';
import { RESOURCES, fixture, model, route } from './fixture.ts';
import { GENERAL_MODE, parseMode } from '../../../src/runtime/modes/service.ts';
import { Registry } from '../../../src/runtime/tools/registry.ts';
import { BASE_CORE } from '../../../src/runtime/tools/core-sets.ts';
import { APP_STATUS_HEADER, collectSetupFacts, renderSetupFacts } from '../../../src/runtime/context/setup-facts.ts';
import { appStatusTools } from '../../../src/runtime/tools/builtin/app-status.ts';
import { builtinTools } from '../../../src/runtime/tools/builtin/index.ts';
import { TokenService } from '../../../src/runtime/pwa/tokens.ts';
import { BridgeRepo } from '../../../src/runtime/bridges/repo.ts';
import type { ToolContext } from '../../../src/runtime/tools/types.ts';
import type { Account } from '../../../src/shared/model/providers.ts';
import type { Device } from '../../../src/shared/model/devices.ts';
import type { Settings } from '../../../src/shared/model/system.ts';
import type { Space } from '../../../src/shared/model/org.ts';

const SECRET_BITS = ['alex@example.com', '/home/alex/.codex', 'http://10.0.0.5:11434/v1', 'sec_abc123', 'weekly-opus', 'five-hour-window', 'usedPercent'];

function account(id: string, extra: Partial<Account> = {}): Account {
  return {
    id, provider: 'codex', label: 'Codex', auth: 'cli', state: 'ok', priority: 0, enabled: true, detected: true, createdAt: 0, ...extra,
  };
}

function pc(id: string, name: string, extra: Partial<Device> = {}): Device {
  return { id, name, kind: 'pc', role: 'home', fingerprint: 'f', addresses: [], caps: {}, status: 'online', self: false, ...extra };
}


/** The context fixture plus full settings, accounts, devices, one paired phone and a Telegram bridge. */
function setup(options: { accounts?: Account[]; devices?: Device[] } = {}) {
  const f = fixture();
  const s = f.services as unknown as Record<string, unknown>;
  const settings = {
    profile: f.profile, onboarding: { completed: false, step: 'done' },
    routing: { costMode: 'balanced', decisionBackend: 'auto', allowPaidFallback: false, functions: {}, embeddingBackend: 'auto' },
    pwa: { enabled: true, bind: 'lan' },
  } as unknown as Settings;
  const accounts = options.accounts ?? [
    account('acc_1', { label: 'Codex · alex@example.com', email: 'alex@example.com', home: '/home/alex/.codex', plan: 'pro',
      limits: { windows: [{ name: 'weekly-opus', windowMinutes: 10080, usedPercent: 40 }, { name: 'five-hour-window', windowMinutes: 300, usedPercent: 10 }], readAt: 0 } }),
    account('acc_2', { provider: 'ollama', label: 'Ollama', auth: 'local', baseUrl: 'http://10.0.0.5:11434/v1', home: 'http://10.0.0.5:11434/v1' }),
    account('acc_3', { provider: 'openai', label: 'OpenAI key', auth: 'api_key', secretId: 'sec_abc123', state: 'needs_login', enabled: false }),
  ];
  const devices = options.devices ?? [pc('dev_self', 'This desk', { self: true }), pc('dev_a', 'Laptop'), pc('dev_b', 'Office', { status: 'offline' }), pc('dev_c', 'Old', { status: 'revoked', revokedAt: 1 })];
  Object.assign(s, {
    settings: { get: () => settings, update: () => { throw new Error('read-only'); } },
    accounts: { list: () => accounts },
    devices: { list: () => devices, online: (id: string) => id === 'dev_a', self: () => devices[0] },
    catalog: { get: (id: string) => f.models.get(id), list: () => [model('codex:gpt-6.1-sol', 'frontier', 'GPT-6.1 Sol'), model('ollama:gemma', 'local', 'Gemma')] },
  });
  const boss = f.org.add(agent('ag_boss', 'Mara', { mode: 'manager', role: 'Manager', spaceId: 'sp_co' }));
  const chat = f.chats.create({ agentIds: [boss.id], createdBy: 'human' });
  const tokens = new TokenService(f.db, f.clock);
  const link = tokens.createLink({ name: 'Pixel' });
  tokens.exchange(link.secret, 'dev_phone', 'Pixel');
  new BridgeRepo(f.db).insert({ id: 'br_1', kind: 'telegram', conversationId: chat.id, externalChatId: '123', status: 'connected', createdAt: 0, updatedAt: 0, secretId: 'sec_bot' });
  return { ...f, boss, chat, settings };
}

const promptOf = (f: ReturnType<typeof setup>, who = f.boss, conversationId: string | undefined = f.chat.id) =>
  f.context.prompt({ agent: who, conversationId, mode: GENERAL_MODE, route: route() }).volatile;

/** What app.status says now. */
const status = (f: ReturnType<typeof setup>): string => renderSetupFacts(collectSetupFacts(f.services));

const TEAM_LINES = [
  '- Agents: 3 active – Company 2 (manager Mara) · no space 1 (manager Mia)',
  '- Accounts: Codex (codex, ok, plan pro); Ollama (ollama, ok); OpenAI key (openai, disabled)',
  '- Strong model: usable – GPT-6.1 Sol',
  // B-072: by model name, never the stored "auto"; what searches by meaning here depends on this PC (the local model)
  '- Decisions: Gemma on Codex (a chat model; no decision model connected) · Search by meaning: ',
];
const APP_LINES = [
  '- First run: not finished',
  '- Spaces: Company (company)',
  '- Routing: cost mode balanced · paid API fallback off',
  '- Linked PCs: Laptop (online), Office (offline)',
  '- Paired phones/browsers: 1 · browsers reach this PC over lan',
  '- Chat bridges: Telegram on – 1 chat (1 connected)',
];

test('no turn carries the team or the app switches – a manager\'s neither; app.status has them', () => {
  const f = setup();
  const volatile = promptOf(f);
  for (const line of [...TEAM_LINES, ...APP_LINES]) assert.ok(!volatile.includes(line), `not in the prompt: ${line}\n${volatile}`);
  assert.ok(!volatile.includes(APP_STATUS_HEADER) && !volatile.includes('Team and models'), 'no app checklist in the prompt');
  for (const line of TEAM_LINES) assert.ok(status(f).includes(line), `missing: ${line}\n${status(f)}`);
});

test('no account email, home, base URL, secret id or limit detail reaches the prompt or the tool', async () => {
  const f = setup();
  const volatile = promptOf(f);
  const result = await appStatusTools[0].run({}, { agent: f.vid, services: f.services, runId: 'run_1', mode: 'general' } as unknown as ToolContext);
  for (const text of [volatile, result.content.map((part) => (part.type === 'text' ? part.text : '')).join(''), JSON.stringify(result.structured)]) {
    for (const bit of SECRET_BITS) assert.ok(!text.includes(bit), `leaked ${bit}`);
    assert.ok(!text.includes('sec_bot'), 'no bridge vault handle');
  }
});

test('the manager sees which models answer decisions and search by meaning, by name', () => {
  const f = setup();
  f.settings.routing = { ...f.settings.routing, decision: 'codex:gpt-6.1-sol', embeddings: 'off' };
  assert.ok(status(f).includes('- Decisions: GPT-6.1 Sol on Codex (a chat model; no decision model connected) · Search by meaning: off (settings.json routing.decision, routing.embeddings)'), status(f));
  f.settings.routing = { ...f.settings.routing, decision: 'codex:gpt-6.1-mini' };
  assert.ok(status(f).includes('- Decisions: Gemma on Codex (a chat model; no decision model connected; codex:gpt-6.1-mini is not available now) · '), 'a chosen model that is gone: what stands in');
  assert.ok(!status(f).split('\n').find((line) => line.startsWith('- Decisions:'))!.includes('auto'), status(f));

  const typed = setup({ accounts: [account('acc_ts', { provider: 'decision-api', label: 'TypeSafe', auth: 'api_key' })] });
  typed.settings.routing = { ...typed.settings.routing, decision: 'acc_ts:jev-1', embeddings: 'off' };
  assert.ok(status(typed).includes('- Decisions: jev-1 on TypeSafe (a decision model) · Search by meaning: off'), status(typed));

  // A long case (labels up to 40 characters, a gone pin, a hosted search model) keeps the pointer to settings.json.
  const label = 'Codex work plan of the company team 2026';
  const long = renderSetupFacts({ uses: {
    decision: `GPT-6 Luna on ${label} (a chat model; no decision model connected; codex:gpt-6.1-mini is not available now)`,
    embeddings: `Qwen/Qwen3-Embedding-8B on ${label}`,
  } });
  assert.ok(long.endsWith('(settings.json routing.decision, routing.embeddings)'), long);
});

test('G1: without any space the agents line names no "no space" group', () => {
  assert.equal(renderSetupFacts({ agents: { active: 1, bySpace: [{ space: '', count: 1, managers: ['Manager'] }] } }), `${APP_STATUS_HEADER}\n- Agents: 1 active (manager Manager)`);
  const f = setup();
  const s = f.services as unknown as Record<string, unknown>;
  const org = s.org as { spaces: () => Space[] };
  const spaces = org.spaces.bind(org);
  org.spaces = () => spaces().filter(() => false);
  const facts = status(f);
  assert.match(facts, /- Agents: 3 active \(managers (Mara, Mia|Mia, Mara)\)/);
  assert.ok(!facts.includes('no space'), facts);
});

test('a throwing source is skipped; nothing readable means no section', () => {
  const f = setup();
  const s = f.services as unknown as Record<string, unknown>;
  s.accounts = { list: () => { throw new Error('accounts store locked'); } };
  s.devices = undefined;
  const facts = status(f);
  assert.ok(facts.includes('- Agents:') && facts.includes('- Strong model:'), facts);
  assert.ok(!facts.includes('- Accounts:'));
  assert.equal(collectSetupFacts(f.services).accounts, undefined);

  const broken = () => { throw new Error('down'); };
  Object.assign(s, { settings: { get: broken }, org: { list: broken, spaces: broken, get: () => undefined }, catalog: { list: broken, get: () => undefined }, permissions: { settings: broken }, db: undefined });
  assert.equal(renderSetupFacts(collectSetupFacts(f.services)), '');
});

test('app.status is a read tool without role gate and returns every fact', async () => {
  const f = setup();
  const tool = appStatusTools[0];
  assert.equal(tool.name, 'app.status');
  assert.equal(tool.category, 'read');
  assert.equal(tool.requires, undefined);
  assert.ok(builtinTools().some((entry) => entry.name === 'app.status'), 'registered with the built-in tools');
  assert.ok(!builtinTools().some((entry) => /(^|\.)setup(\.|$)/.test(entry.name)), 'G1: no tool an agent sees is named "setup"');
  const result = await tool.run({}, { agent: f.vid, services: f.services, runId: 'run_1', mode: 'general' } as unknown as ToolContext);
  const text = result.content[0].type === 'text' ? result.content[0].text : '';
  assert.ok(text.startsWith(APP_STATUS_HEADER));
  for (const line of [...TEAM_LINES, ...APP_LINES]) assert.ok(text.includes(line), `missing: ${line}\n${text}`);
  assert.ok(!text.includes('This desk') && !text.includes('Old'), 'this PC and revoked PCs are not linked PCs');
  assert.deepEqual(result.structured, collectSetupFacts(f.services));
});

test('the registry offers app.status in the manager, general and secretary modes only (not a core tool)', () => {
  const f = setup();
  const registry = new Registry({ services: () => f.services });
  const dir = path.join(RESOURCES, 'modes');
  const modes = readdirSync(dir).filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .map((name) => parseMode(name.replace(/\.md$/, ''), readFileSync(path.join(dir, name), 'utf8')));
  const offered = modes.filter((mode) => registry.allowed(appStatusTools[0], f.vid, mode)).map((mode) => mode.key).sort();
  assert.ok(!('app.status' in BASE_CORE), 'if app.status becomes a core tool, update the app-status.ts header and this test');
  assert.deepEqual(offered, ['general', 'manager', 'secretary'], 'the modes with every tool');
  assert.equal(registry.allowed(appStatusTools[0], f.boss, modes.find((mode) => mode.key === 'research')!), false, 'specialist modes hide it, even for a manager');
});

test('B-080: the account line names what holds each account – its return time or cooling', () => {
  const now = Date.UTC(2026, 9, 17, 9, 0, 0); // the harness clock: 11:00 in Europe/Berlin
  const f = setup({ accounts: [
    account('acc_c1', { provider: 'claude', label: 'Claude Code', limits: { windows: [{ name: 'weekly', windowMinutes: 10080, usedPercent: 100, resetsAt: Date.UTC(2026, 9, 19, 5, 0) }], readAt: 0 } }),
    account('acc_c2', { provider: 'claude', label: 'Claude Code 2', priority: 1 }),
    account('acc_x', { label: 'Codex', state: 'cooling', coolingUntil: now + 5 * 60_000 }),
  ] });
  assert.equal(f.clock.now(), now);
  const line = '- Accounts: Claude Code (claude, ok, at its limit until 19 Oct 07:00); Claude Code 2 (claude, ok); Codex (codex, cooling, cooling until 11:05)';
  assert.ok(status(f).includes(line), status(f));
  const rotating = setup({ accounts: [account('acc_c1', { provider: 'claude', label: 'Claude Code' }), account('acc_c2', { provider: 'claude', label: 'Claude Code 2', priority: 1 })] });
  assert.ok(status(rotating).includes('- Accounts: Claude Code (claude, ok); Claude Code 2 (claude, ok)'), 'nothing held: the line as before');
});
