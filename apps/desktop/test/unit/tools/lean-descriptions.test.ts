// Lean tool descriptions keep what the model must know before a call: where a file tool reads and writes, and the
// pointer to a neighbour tool. Checks the file group as registered (builtinTools). B-080: files.read and files.list are
// remote tools – the shared `device` argument (placement.ts withDeviceArg) names a linked PC.
// Owns: these assertions only. Never: runs a tool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtinTools } from '../../../src/runtime/tools/builtin/index.ts';
import { withDeviceArg } from '../../../src/runtime/tools/placement.ts';
import { DEVICE_PROPERTY } from '../../../src/runtime/tools/types.ts';

const tools = builtinTools();
const spec = (name: string) => {
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `${name} is registered`);
  return { tool, description: tool.description, schema: JSON.stringify(withDeviceArg(tool).inputSchema) };
};

test('files.read / files.list / files.write / shell.exec say they work anywhere on the PC; a linked PC is named by device', () => {
  assert.match(spec('files.read').description, /^Reads a text file anywhere on the PC/);
  assert.match(spec('files.list').description, /^Lists a folder anywhere on the PC/);
  assert.match(spec('files.write').description, /a file anywhere on this PC, as text or bytes/);
  assert.match(spec('shell.exec').description, /^Runs a shell command on this PC or a linked PC/);
  for (const name of ['files.read', 'files.list', 'shell.exec']) {
    assert.equal(spec(name).tool.remote, true, `${name} runs on the PC device names`);
    assert.ok(spec(name).schema.includes(JSON.stringify(DEVICE_PROPERTY.description)), `${name}: the shared device argument`);
  }
  assert.equal(spec('files.write').tool.remote, undefined, 'files.write runs on this PC');
});
