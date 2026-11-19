// Which files hold a CLI plan's login and where a CLI's default home is (accounts/cli-homes.ts; the copy between the
// CEO's PCs: devices/sync/logins.ts): Codex auth.json, Claude Code .credentials.json (none on a Mac: the Keychain),
// Gemini CLI its two files; Copilot CLI and Kimi Code none known. Codex, Claude Code and Kimi Code accounts have
// homes of their own, Gemini CLI and Copilot CLI one sign-in per PC.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { defaultHome, loginDir, loginFiles, onePerPc, ownHomes } from '../../../src/runtime/accounts/cli-homes.ts';

test('the login files per CLI, none where the login is no known file', () => {
  assert.deepEqual(loginFiles('codex', 'win32'), ['auth.json']);
  assert.deepEqual(loginFiles('claude', 'linux'), ['.credentials.json']);
  assert.deepEqual(loginFiles('claude', 'darwin'), [], 'a Mac keeps Claude Code\'s login in the Keychain');
  assert.deepEqual(loginFiles('gemini-cli', 'darwin'), ['oauth_creds.json', 'google_accounts.json']);
  for (const provider of ['copilot', 'kimi-cli', 'openai'] as const) assert.deepEqual(loginFiles(provider, 'win32'), [], provider);
});

test('default homes follow the CLIs\' own variables; own homes for Codex, Claude Code, Kimi Code and (AF-024) Gemini CLI', () => {
  const home = path.join('C:', 'Users', 'lena');
  assert.equal(defaultHome('codex', {}, home), path.join(home, '.codex'));
  assert.equal(defaultHome('codex', { CODEX_HOME: 'D:\\codex' }, home), 'D:\\codex');
  assert.equal(defaultHome('claude', { CLAUDE_CONFIG_DIR: 'D:\\claude' }, home), 'D:\\claude');
  assert.equal(defaultHome('gemini-cli', {}, home), path.join(home, '.gemini'));
  assert.equal(defaultHome('copilot', {}, home), undefined);
  assert.deepEqual(['codex', 'claude', 'kimi-cli', 'gemini-cli', 'copilot'].map((provider) => ownHomes(provider as never)), [true, true, true, true, false]);
});

test('AF-024: the login folder – Gemini CLI keeps its files in <home>/.gemini (GEMINI_CLI_HOME is its root); one per PC only in its default home', () => {
  const home = path.join('C:', 'Users', 'lena');
  const own = path.join('D:', 'data', 'accounts', 'gemini-cli', 'acc_g2');
  assert.equal(loginDir({ provider: 'gemini-cli', home: own }, {}, home), path.join(own, '.gemini'));
  assert.equal(loginDir({ provider: 'gemini-cli' }, {}, home), path.join(home, '.gemini'), 'the login found on this PC');
  assert.equal(loginDir({ provider: 'codex', home: 'D:\\x' }, {}, home), 'D:\\x');
  assert.equal(loginDir({ provider: 'codex' }, {}, home), path.join(home, '.codex'));
  assert.deepEqual([onePerPc({ provider: 'gemini-cli' }), onePerPc({ provider: 'gemini-cli', home: own }), onePerPc({ provider: 'copilot' }), onePerPc({ provider: 'codex' })],
    [true, false, true, false]);
  assert.equal(onePerPc({ provider: 'gemini-cli' }, true), false, 'the sender says its account has a home of its own');
});
