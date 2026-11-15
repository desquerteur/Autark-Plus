// Core tool sets: the few tools an engine gets directly per mode. Every other tool the agent may use in that mode stands
// in its prompt as one line (tools-meta.ts moreToolsSection) and runs through tools.call; tools.find gives its arguments.
// - BASE_CORE: every mode; MODE_CORE: a built-in mode's own; a saved mode gets FAMILY_CORE by the families its patterns
//   name ('*' → general's);
// - NO_OWN_TOOLS_CORE: what an engine without its own shell, file and web tools needs (HTTP/local models) – Claude Code
//   and Codex read, search and browse with their own;
// - META_TOOLS: tools.find and tools.call, beside every core set.
// The registry intersects a core set with what the mode offers the agent (registry.ts offerFor). Learned tools join at
// a fresh session (learned.ts).
// Owns: these lists and their reasons. Never: widens what a mode allows.

import type { ModeInfo } from '../../shared/model/knowledge.ts';

export const FIND_TOOL = 'tools.find';
export const CALL_TOOL = 'tools.call';
export const META_TOOLS: readonly string[] = [FIND_TOOL, CALL_TOOL];

/** tool name → why it is offered directly. */
type Reasons = Readonly<Record<string, string>>;

export const BASE_CORE: Reasons = {
  'model.set': 'self-routing (RT4): the rules tell every agent to say which model its work needs',
  'tasks.create': 'the four task commands every agent runs: new work for me, a colleague, a person or "team" – asking a person is one',
  'tasks.give': 'the four task commands: handing a task on or taking one',
  'tasks.update': 'the four task commands: the state, the wait, the plan and facts of my work',
  'tasks.finish': 'the four task commands: done or dropped with what came out (turn-finish judges the task change)',
  'chat.read': 'B-050 K10: a chat\'s lines again (the context compacts them; render.ts points to chat.read for a cut message) – ~120 tokens',
  'chat.direct': 'B-050 K10: the 1:1 with any member (agent, person, colleague) without a search first – ~120 tokens',
  'web.fetch': 'the environment web line names it: reading a page whose address I know',
  'knowledge.find': 'the one finder of skills, notes, references and documents; the skills line names it',
  'knowledge.open': 'opens what knowledge.find returns and loads a skill by name (the skills index says to load one before that kind of work)',
  subconscious: 'owner 15.10./01.11.2026: the main AI can start the subconscious itself with any text; its answer is the tool output – ~110 tokens',
};

const BROWSER_BASICS: Reasons = {
  'browser.open': 'opening a page in the agent\'s own browser profile',
  'browser.snapshot': 'the page\'s refs before every act',
  'browser.act': 'click, fill, select on the page',
  'browser.extract': 'reading the page\'s text',
};

const COMPUTER_BASICS: Reasons = {
  'computer.windows': 'mode text: start here',
  'computer.ui_tree': 'the refs computer.act works on',
  'computer.act': 'acting on a UI element by ref',
  'computer.screenshot': 'looking at the screen',
};

/** The block prompt (shared/blocks/prompt.ts) tells chat agents to look a block type up with it before its first use. */
const UI_HELP: Reasons = { 'ui.help': 'the block prompt: look a block type up with it before its first use' };

export const MODE_CORE: Readonly<Record<string, Reasons>> = {
  general: {
    ...UI_HELP,
  },
  manager: {
    ...UI_HELP,
    'agents.templates': 'mode text: hiring starts from a template',
    'agents.create': 'mode text: hiring (agents.templates, agents.create)',
    'agents.update': 'the manager standard: a hire makes its SYSTEM.md its own with my brief',
    'chat.create': 'work groups and topic chats are everyday manager work (B-050 R5 searched for it); members by name, so no agents.list first',
  },
  secretary: {
    ...UI_HELP,
    'calendar.list': 'appointments and the person\'s day',
    'calendar.add': 'putting an appointment into the calendar',
    'todos.prepare': 'the rules: the person\'s to-dos are prepared, never ticked off (has_todos)',
    'schedules.remind': 'mode text: self-reminders for the agent\'s own follow-ups',
  },
  research: {
    'browser.open': 'primary sources that need a real browser',
    'browser.extract': 'reading such a page',
    'memory.write': 'mode text: save durable findings with source and date',
  },
  writing: {},
  browser: {
    ...BROWSER_BASICS,
    'browser.screenshot': 'visual checks of the page',
    'secrets.list': 'handles for sign-ups and sign-ins (browser.act fills secret:// handles)',
    'secrets.save': 'owner 29.10.2026: a key or password met on the way goes straight into the catalog',
  },
  computer: {
    ...COMPUTER_BASICS,
    'computer.type': 'typing into the focused element',
    'computer.key': 'keys and shortcuts',
  },
  finance: {
    ...BROWSER_BASICS,
    'secrets.list': 'handles for bank and portal sign-ins',
    'secrets.save': 'owner 29.10.2026: a key or password met on the way goes straight into the catalog',
  },
  social: {
    'browser.open': 'the platform UI in the agent\'s own profile',
    'browser.snapshot': 'the page\'s refs before every act',
    'browser.act': 'posting and replying on the page',
    'browser.screenshot': 'checking a post as it looks',
    'media.look': 'mode text: watch a video before describing or posting it',
    'media.listen': 'mode text: hear audio before describing or posting it',
    'schedules.routine': 'mode text: every publish gets its comment routine',
  },
  video: {
    'media.look': 'mode text: watch a video (keyframes) before answering about it',
    'media.listen': 'hearing music, sounds and voices',
    'media.transcribe': 'what is said in a recording',
    'media.search': 'finding stored footage',
    'media.video': 'B-058 G13: generated clips are part of video work',
    'media.speak': 'B-058 G12: voice-overs, free in the local voice',
  },
  web: {
    'browser.open': 'checking the built site',
    'browser.screenshot': 'seeing the built site',
  },
};

/** A saved mode's essentials by the tool families its patterns name ('*' → general's). */
const FAMILY_CORE: Readonly<Record<string, Reasons>> = {
  browser: BROWSER_BASICS,
  computer: COMPUTER_BASICS,
  media: { 'media.search': 'finding stored media', 'media.look': 'watching a stored video', 'media.view': 'B-058 G10: every image line not attached to the turn names media.view' },
};

export const NO_OWN_TOOLS_CORE: Reasons = {
  'files.read': 'an engine without its own file tools reads files with ours',
  'files.search': 'an engine without its own file tools searches files with ours',
  'web.search': 'an engine without its own web search searches with ours',
  'files.list': 'an engine without its own file tools lists folders with ours',
  'files.write': 'an engine without its own file tools writes with ours',
  'shell.exec': 'an engine without its own shell runs commands with ours',
};

function modeCore(mode: Pick<ModeInfo, 'key' | 'tools'>): Reasons {
  if (Object.hasOwn(MODE_CORE, mode.key)) return MODE_CORE[mode.key];
  const patterns = mode.tools ?? ['*'];
  if (!patterns.length || patterns.includes('*')) return MODE_CORE.general;
  const families = new Set(patterns.filter((pattern) => !pattern.startsWith('!')).map((pattern) => pattern.split('.')[0]));
  return Object.assign({}, ...[...families].filter((family) => Object.hasOwn(FAMILY_CORE, family)).map((family) => FAMILY_CORE[family]));
}

const reasonIn = (reasons: Reasons, name: string): string | undefined => (Object.hasOwn(reasons, name) ? reasons[name] : undefined);

/**
 * The names an engine is offered directly in `mode` (before the registry intersects them with the mode's offer).
 * `engine`: whether it brings its own shell, file and web tools; undefined counts as yes (the CLI engines).
 */
export function coreNames(mode: Pick<ModeInfo, 'key' | 'tools'>, engine?: { ownTools: boolean }): Set<string> {
  const names = new Set([...Object.keys(BASE_CORE), ...Object.keys(modeCore(mode)), ...META_TOOLS]);
  if (engine && !engine.ownTools) for (const name of Object.keys(NO_OWN_TOOLS_CORE)) names.add(name);
  return names;
}

/** Why `name` is offered directly in `mode` (undefined: it is not a core tool there) – for docs and tests. */
export function coreReason(mode: Pick<ModeInfo, 'key' | 'tools'>, name: string): string | undefined {
  if (META_TOOLS.includes(name)) return 'B-049 F4 meta tool: finds and runs every other tool the agent may use here';
  return reasonIn(BASE_CORE, name) ?? reasonIn(modeCore(mode), name) ?? reasonIn(NO_OWN_TOOLS_CORE, name);
}
