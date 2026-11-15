// B-044 prompt overrides (context/templates.ts; contract §5): <data>/prompts/<name>.md replaces the shipped
// prompt of that name – every prompt, the standards included (the open system, 31.10.2026) –
// - the stable prompt uses the own identity.md and stays byte-identical until the data folder watcher reports a
//   change in prompts/; deleting the file brings the shipped text back;
// - an own identity.md replaces the shipped one; an unusable file (NUL bytes) falls back to the shipped text;
// - text()/renderText() give the own version cleaned (comments dropped), else the shipped text.
// Owns: these assertions only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PromptTemplates } from '../../../src/runtime/context/templates.ts';
import { Context } from '../../../src/runtime/context/service.ts';
import { loadTemplates } from '../../../src/runtime/context/templates.ts';
import { RootWatcher } from '../../../src/runtime/root/watcher.ts';
import { ROOT_PROMPTS } from '../../../src/runtime/root/layout.ts';
import { fixture, RESOURCES, route, VIDEO_MODE } from './fixture.ts';
import { clock, tempDir } from '../store/helpers.ts';

function setup() {
  const temp = tempDir('wf-prompts-');
  const own = path.join(temp.dir, ROOT_PROMPTS);
  mkdirSync(own, { recursive: true });
  const root = new RootWatcher({ root: temp.dir, clock: clock(), watch: false, debounceMs: 1, maxWaitMs: 5 });
  root.start();
  const templates = new PromptTemplates(() => path.join(RESOURCES, 'prompts'), () => undefined, { data: () => temp.dir });
  templates.watch(root);
  const write = (name: string, text: string | Buffer) => writeFileSync(path.join(own, name), text);
  const changed = (name?: string) => { root.nudge(ROOT_PROMPTS, name ? [name] : undefined); root.flush(ROOT_PROMPTS); };
  return { temp, own, root, templates, write, changed, done: () => { root.stop(); temp.cleanup(); } };
}

test('an own identity.md shapes the stable prompt and stays byte-identical until the file changes', (t) => {
  const p = setup();
  t.after(p.done);
  const f = fixture();
  const context = new Context({ services: () => f.services, templates: p.templates });
  const chat = f.chats.create({ agentIds: [f.vid.id], createdBy: 'human' });
  const input = { agent: f.vid, conversationId: chat.id, mode: VIDEO_MODE, route: route() };
  const shipped = context.prompt(input).stable;
  assert.match(shipped, /^# Who I am/);
  p.write('identity.md', '<!-- my own note -->\n# Who you are\nYou are {{agent_name}}, the crew\'s editor.\n');
  assert.equal(context.prompt(input).stable, shipped, 'read once: nothing changes before the watcher reports it');
  p.changed('identity.md');
  const own = context.prompt(input).stable;
  assert.match(own, /^# Who you are\nYou are Vic, the crew's editor\./);
  assert.doesNotMatch(own, /my own note/, 'HTML comments are stripped'); // B-075: the shipped rules say "mine" now
  assert.equal(context.prompt(input).stable, own, 'byte-identical while the file stays');
  p.changed('skills.md'); // another prompt's change keeps this one
  assert.equal(context.prompt(input).stable, own);
  rmSync(path.join(p.own, 'identity.md'));
  p.changed('identity.md');
  assert.equal(context.prompt(input).stable, shipped, 'deleting the own file brings the shipped prompt back');
});

test('an own identity.md replaces the shipped one; an unusable own file falls back to the shipped prompt', (t) => {
  const p = setup();
  t.after(p.done);
  const shipped = loadTemplates(path.join(RESOURCES, 'prompts'));
  assert.match(shipped.identity, /^# Who I am\n/);
  p.write('identity.md', '# Who we are here');
  p.write('skills.md', Buffer.from([0x23, 0x00, 0x41]));
  p.changed();
  assert.equal(p.templates.get('identity'), '# Who we are here');
  assert.equal(p.templates.get('skills'), shipped.skills);
  p.write('standard-agent.md', '# How I work\nOur way.\n\n## My role\n{{role}}.\n');
  p.changed('standard-agent.md');
  assert.equal(p.templates.renderText('standard-agent', { role: 'Editor' }), '# How I work\nOur way.\n\n## My role\nEditor.');
});

test('text() gives the own onboarding text cleaned (comments dropped), else the shipped one', (t) => {
  const p = setup();
  t.after(p.done);
  assert.match(p.templates.text('onboarding'), /^\{\{#lang_de\}\}\nHallo\{\{#name\}\} \{\{name\}\}\{\{\/name\}\}, ich bin dein Manager/,"the shipped onboarding prompt (B-090: the Manager's first message, one section per language)");
  p.write('onboarding.md', '<!-- note -->\nHi {{profile.name}}!\n');
  p.changed('onboarding.md');
  assert.equal(p.templates.text('onboarding'), 'Hi {{profile.name}}!');
});

