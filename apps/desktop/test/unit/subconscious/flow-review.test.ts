// The review of the subconscious around the main AI: what it asks to get back comes back whole; the person's newest message stays
// out of reach; a kept trace does not outlive a Forget; and the marks and the trace stay real pairs in a rebuilt history.
// Owns: these assertions only. Never: real models.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { RESOURCES, fixture } from '../context/fixture.ts';
import { mid, ledgerSetup } from '../context/ledger-fixture.ts';
import { PromptTemplates } from '../../../src/runtime/context/templates.ts';
import { contextTools } from '../../../src/runtime/subconscious/context-tools.ts';
import { SubconsciousImpl } from '../../../src/runtime/subconscious/service.ts';
import type { FlowRun } from '../../../src/runtime/subconscious/tools.ts';
import type { StructuredRunner } from '../../../src/runtime/decision/types.ts';
import { rebuildItems } from '../../../src/runtime/agents/rebuild-items.ts';
import { TRACE_TOKENS, capTrace } from '../../../src/shared/model/subconscious.ts';

const tool = (name: string) => contextTools.find((entry) => entry.name === name)!;

function scripted(steps: Array<{ tool: string; args?: Record<string, unknown> }>): StructuredRunner {
  return async () => {
    const next = steps.shift() ?? { tool: 'done' };
    return { text: '', structured: { tool: next.tool, args: JSON.stringify(next.args ?? {}) }, by: 'fake' };
  };
}

test('asking the subconscious to get something back: the original comes back whole, not cut to a trace', async () => {
  const t = ledgerSetup();
  try {
    for (let index = 1; index <= 4; index++) {
      const run = t.turn(t.say(`Step ${index} please, with some words.`).seq);
      t.ourCall(run, 'shell.exec', { command: `build ${index}` }, `${'log line\n'.repeat(800)}THE END ${index}`, `c${index}`);
      t.done(run);
      t.clock.advance(1000);
    }
    await t.journal.settled();
    t.ledger.mark(t.tom.id, 'main', [{ itemId: 't1', state: 'condensed', condensed: 'build 1 log', reason: 'old', by: 'subconscious' }]);
    t.services.prompts = new PromptTemplates(() => path.join(RESOURCES, 'prompts'));
    const impl = new SubconsciousImpl({ services: () => t.services, runner: scripted([{ tool: 'context.restore', args: { ids: ['t1'] } }, { tool: 'done' }]) });
    const answer = await impl.ask({ agent: t.tom, conversationId: t.chat.id, ask: 'Hol mir t1 zurück', context: 'none' });
    assert.ok(answer.length > TRACE_TOKENS * 4, `the answer holds ${answer.length} characters`);
    assert.match(answer, /THE END 1/);
  } finally { t.cleanup(); }
});

test('an automatic trace stays small and says when it is cut', () => {
  const capped = capTrace({ calls: [{ tool: 'context.restore', args: { ids: ['t1'] }, output: 'x'.repeat(TRACE_TOKENS * 10) }] });
  assert.match(capped.calls[0].output, /\[cut\]$/);
  assert.ok(capped.calls[0].output.length <= TRACE_TOKENS * 4);
});

test('a kept trace that mentions what the person forgot never reaches the main AI', async () => {
  const f = fixture();
  const impl = new SubconsciousImpl({ services: () => f.services, runner: false });
  impl.putBack(f.vid.id, 'main', { calls: [{ tool: 'agent.tell', args: {}, output: 'Invoice INV-55821 is disputed.' }] });
  impl.forget((text) => text.includes('INV-55821'));
  assert.equal(await impl.beforeTurn({ agent: f.vid, thread: 'main' }), undefined);
});

function runOf(t: ReturnType<typeof ledgerSetup>): FlowRun {
  return {
    services: t.services, agent: t.tom, conversationId: t.chat.id, thread: 'main', signal: new AbortController().signal,
    hits: new Map(), searches: [], show: () => {}, finish: () => {},
  } as unknown as FlowRun;
}

test('the person\'s newest message stays out of reach however many turns the work took since', async () => {
  const t = ledgerSetup();
  try {
    const first = t.turn(t.say('An older wish about the logo, long enough to be worth a look.').seq);
    t.done(first);
    t.clock.advance(1000);
    const said = t.say(`Build the whole invoice export for Brightwave and send it to Lea. ${'Details follow. '.repeat(40)}`);
    const second = t.turn(said.seq);
    t.done(second);
    for (let index = 0; index < 4; index++) {
      t.clock.advance(1000);
      const run = t.turn(said.seq);
      t.ourCall(run, 'shell.exec', { command: `step ${index}` }, 'x'.repeat(5000), `c${index}`);
      t.done(run);
    }
    const run = runOf(t);
    const newest = mid(t.db, said);
    assert.doesNotMatch(String(await tool('context.list').run({}, run)), new RegExp(`\\n${newest} `), 'not even offered');
    assert.match(String(await tool('context.hide').run({ ids: [newest] }, run)), /left as they are/);
    assert.match(String(await tool('context.condense').run({ id: newest, text: 'export for Brightwave' }, run)), /stays as it is/);
    assert.equal(t.ledger.items(t.tom.id, 'main').find((item) => item.itemId === newest)?.state, 'keep');
    assert.match(String(await tool('context.hide').run({ ids: [`m${said.seq - 1}`] }, run)), /^hidden: /, 'an older message may go');
  } finally { t.cleanup(); }
});

test('a condensed or hidden item never breaks a call from its output in a rebuilt history', async () => {
  const t = ledgerSetup();
  try {
    const run = t.turn(t.say('Do it.').seq);
    t.ourCall(run, 'shell.exec', { command: 'a' }, 'a'.repeat(5000), 'c1');
    t.ourCall(run, 'shell.exec', { command: 'b' }, 'b'.repeat(5000), 'c2');
    t.ourCall(run, 'shell.exec', { command: 'c' }, 'c'.repeat(5000), 'c3');
    t.done(run);
    t.ledger.mark(t.tom.id, 'main', [
      { itemId: 't1', state: 'condensed', condensed: 'a log', reason: 'old', by: 'subconscious' },
      { itemId: 't2', state: 'hidden', reason: 'old', by: 'subconscious' },
    ]);
    const { items } = rebuildItems(t.ledger.view(t.tom.id, 'main'));
    const calls = items.filter((item) => item.call);
    assert.deepEqual(calls.map((item) => item.call?.callId), ['c1', 'c3'], 'the hidden pair goes whole');
    assert.ok(calls.every((item) => item.call?.output), 'each call keeps an output');
    assert.match(calls[0].call!.output, /a log\n\{"compacted":"t1"/, 'the short text with its stamp under it');
  } finally { t.cleanup(); }
});

test('live 01.11., q-r 03.11., 13.11.: How I work names abilities, no tool and no order of steps – the vector tools say what they do themselves', () => {
  const prompts = new PromptTemplates(() => path.join(RESOURCES, 'prompts'));
  const how = `${prompts.text('standard-agent')}\n${prompts.text('standard-manager')}`;
  assert.doesNotMatch(how, /vector\.|grep only/, 'no tool, no order of steps (owner\'s rule (f))');
});

test('live 01.11.: the model is told their tools are no functions: a model that tried real function calls got refusals, looped until the time limit or said the search was unavailable', () => {
  const prompt = new PromptTemplates(() => path.join(RESOURCES, 'prompts')).text('subconscious');
  assert.match(prompt, /I call no functions/);
  assert.doesNotMatch(prompt, /tool call as JSON/);
});
