// S2 (17.11.2026, Felix's mode 'coding' that no mode file defines): an unknown mode key on an agent is answered with
// general and logged once while the runtime runs (agents/turn-prepare.ts resolveMode).
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMode } from '../../../src/runtime/agents/turn-prepare.ts';
import { GENERAL_MODE } from '../../../src/runtime/modes/service.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';

test('an unknown mode key runs in general and is logged once per key', () => {
  const warned: Array<{ message: string; data: unknown }> = [];
  const services = {
    modes: { get: (key: string) => { if (key === GENERAL_MODE.key) return GENERAL_MODE; throw new Error(`unknown mode ${key}`); } },
    log: { warn: (message: string, data: unknown) => { warned.push({ message, data }); }, info() {}, debug() {}, error() {} },
  } as unknown as RuntimeServices;
  assert.equal(resolveMode(services, ['coding-s2-test']).key, 'general');
  assert.equal(resolveMode(services, ['coding-s2-test']).key, 'general');
  assert.deepEqual(warned, [{ message: 'unknown mode key – the turn runs in general', data: { mode: 'coding-s2-test' } }], 'once');
  assert.equal(resolveMode(services, ['other-s2-test', 'general']).key, 'general');
  assert.equal(warned.length, 2, 'another unknown key is logged once too');
});
