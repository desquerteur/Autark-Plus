// B-087: the iPhone shell (src/ui/hosted/shell.ts) tells the PC UI at once when its channel to a PC is up again – the
// Connection's status callback with `connected` calls window.autarkResume, which lib/rpc.ts sets to checkAlive – so the
// page's socket does not wait out rpc's backoff (up to 10 s) after the PC came back; other status lines only show text.
// shell.ts starts itself on import (it needs a DOM), so this runs its status callback taken from the source.
// Owns: these assertions. Never: a real tunnel or browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const shell = readFileSync(new URL('../../../src/ui/hosted/shell.ts', import.meta.url), 'utf8');
const rpc = readFileSync(new URL('../../../src/ui/lib/rpc.ts', import.meta.url), 'utf8');

/** The Connection's `status` option of shell.ts, compiled and bound to fake screens and window. */
function statusCallback(screens: { status(text: string): void }, window: { autarkResume?: () => void }) {
  const source = /\n\s*status: (\([^)]*\) => [^\n]+),\n/.exec(shell)?.[1];
  assert.ok(source, 'shell.ts passes a status callback to its Connection');
  const code = transformSync(`(${source})`, { loader: 'ts' }).code;
  return new Function('screens', 'window', `return ${code}`)(screens, window) as (text: string, connected: boolean) => void;
}

test('a new channel calls autarkResume once; a status line without a channel only shows its text', () => {
  const lines: string[] = [];
  let resumed = 0;
  const status = statusCallback({ status: (text) => lines.push(text) }, { autarkResume: () => { resumed++; } });
  status('Connecting to Desk…', false);
  status('Lost the connection to Desk.', false);
  assert.equal(resumed, 0);
  status('Connected to Desk.', true);
  assert.equal(resumed, 1, 'the PC UI checks its socket at once');
  assert.deepEqual(lines, ['Connecting to Desk…', 'Lost the connection to Desk.', 'Connected to Desk.']);
  const early = statusCallback({ status: () => undefined }, {});
  assert.doesNotThrow(() => early('Connected to Desk.', true), 'before the PC UI started (no hook yet) nothing happens');
});

test('the PC UI\'s rpc answers autarkResume with its liveness check', () => {
  assert.match(rpc, /\.autarkResume = checkAlive;/);
});
