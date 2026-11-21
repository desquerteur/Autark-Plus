// B-080 (tool-input-strictness #6, live: "unknown property" and "does not match any allowed shape" left agents guessing,
// agents.split_tell to:"2" was refused): src/runtime/tools/validate.ts and the registry's call path –
// - an unknown property's line names what that object takes (the tool's arguments at the top);
// - an anyOf line names the shapes (enum values, an integer range); an object fitting one shape gets that shape's lines;
// - coerce: a numeric string where only a number fits becomes that number, an enum value in another case that value –
//   nested too, never mutating the input; the registry applies it before validation (agents.split_tell's real schema).
// Owns: these assertions only. Never: real engines, splits or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerce, validate } from '../../../src/runtime/tools/validate.ts';
import { Registry } from '../../../src/runtime/tools/registry.ts';
import { tellTool } from '../../../src/runtime/tools/builtin/agents-split-tell.ts';
import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { ToolContext, ToolOutput } from '../../../src/runtime/tools/types.ts';
import { setup } from './helpers.ts';

const textOf = (output: ToolOutput) => output.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');

const SHELL = {
  type: 'object',
  properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeoutSeconds: { type: 'integer', minimum: 1, maximum: 1800 } },
  required: ['command'], additionalProperties: false,
};

test('an unknown property names what that object takes – the tool\'s arguments at the top, a nested object by its path', () => {
  assert.deepEqual(validate({ command: 'dir', max_output_tokens: 4000 }, SHELL), ['max_output_tokens: unknown property – the tool takes command, cwd, timeoutSeconds']);
  const nested = { type: 'object', properties: { when: { type: 'object', properties: { once: { type: 'string' }, repeat: { type: 'object' } }, additionalProperties: false } } };
  assert.deepEqual(validate({ when: { at: '+2h' } }, nested), ['when.at: unknown property – when takes once, repeat']);
});

test('an anyOf line names the shapes: enum values and the integer range; an object that fits one shape gets its own lines', () => {
  const to = tellTool.inputSchema;
  assert.deepEqual(validate({ to: 'parent' }, to), ['to: takes "origin", "all" or an integer 1–12']);
  assert.deepEqual(validate({ to: 0 }, to), ['to: takes "origin", "all" or an integer 1–12']);
  assert.deepEqual(validate({ to: 'all' }, to), []);
  const who = { type: 'object', properties: { who: { anyOf: [{ type: 'string' }, { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }] } } };
  assert.deepEqual(validate({ who: { name: 'Mara' } }, who), ['who.id: required', 'who.name: unknown property – who takes id']);
});

test('coerce: a numeric string where only a number fits, an enum value in another case – nested and in anyOf shapes; the input stays as given', () => {
  const schema = { type: 'object', properties: {
    to: (tellTool.inputSchema.properties as Record<string, unknown>).to, effort: { type: 'string', enum: ['low', 'medium', 'high'] },
    limit: { type: 'integer' }, ratio: { type: 'number' }, label: { type: 'string' }, ids: { type: 'array', items: { type: 'integer' } },
  } };
  const field = (value: Record<string, unknown>, key: string) => (coerce(value, schema) as Record<string, unknown>)[key];
  const given = { to: '2', effort: 'High', limit: ' 12 ', ratio: '0.5', label: '42', ids: ['1', 2] };
  assert.deepEqual(coerce(given, schema), { to: 2, effort: 'high', limit: 12, ratio: 0.5, label: '42', ids: [1, 2] });
  assert.deepEqual(given, { to: '2', effort: 'High', limit: ' 12 ', ratio: '0.5', label: '42', ids: ['1', 2] }, 'not mutated');
  assert.equal(field({ to: 'Origin' }, 'to'), 'origin');
  assert.equal(field({ limit: '1.5' }, 'limit'), '1.5', 'no integer: left for validation to name');
  const same = { to: 'all', effort: 'low' };
  assert.equal(coerce(same, schema), same, 'nothing to change: the same value');
});

test('the registry coerces before validation: agents.split_tell to:"2" runs as 2, an enum in another case is accepted', async () => {
  const h = setup();
  const services = h.services as RuntimeServices;
  const registry = new Registry({ services: () => services });
  services.tools = registry;
  services.modes = { get: () => ({ key: 'general', tools: ['*'] }) } as unknown as RuntimeServices['modes'];
  const seen: unknown[] = [];
  registry.register({ ...tellTool, run: async (args) => { seen.push(args); return { content: [{ type: 'text', text: 'told' }] }; } });
  const base: Omit<ToolContext, 'services'> = { agent: h.tom, runId: 'run_v', conversationId: h.chat.id, mode: 'general', signal: new AbortController().signal, status: () => {} };
  const out = await registry.call('agents.split_tell', { to: '2', text: 'Look at the second page.', effort: 'HIGH' }, base, 'v1');
  assert.equal(textOf(out), 'told');
  assert.deepEqual(seen, [{ to: 2, text: 'Look at the second page.', effort: 'high' }]);
  const refused = await registry.call('agents.split_tell', { to: 'parent', text: 'x' }, base, 'v2');
  assert.match(textOf(refused), /^Invalid arguments for agents\.split_tell:\nto: takes "origin", "all" or an integer 1–\d+$/);
});
