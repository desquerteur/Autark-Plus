// library.* – the public library every Autark shares (services/library, library/hub.ts; owner 14.11.2026, no sign-in):
// library.find by words (without words: the best rated, and my skills whose library entry changed since I took it),
// library.open one entry (written by strangers: data I weigh), library.publish one of my skills or notes (the checks of
// library/publish.ts; CC0 for everyone), library.rate what I used. Keeping an entry as my own is skills.save with from.
// Owns: these tools and their wording. Never: writes to an agent's own memory or skills (keeping one is skills.save).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ToolContext, ToolDef } from '../types.ts';
import { failure, json, text } from '../types.ts';
import { clip, defineTool, internal } from './util.ts';
import type { LibraryHit, LibraryKind } from '../../../shared/model/library.ts';
import { externalMarker } from '../../../shared/text/external.ts';
import { findEntries, libraryUrl, openEntry, rateEntry, shareEntry, voterId } from '../../library/hub.ts';
import { publishEntry } from '../../library/publish.ts';
import { derivedFromFile } from '../../skills/service.ts';
import { helperOf } from '../../day/helper.ts';

function hitLine(hit: LibraryHit): string {
  const rating = hit.rating === null ? 'not rated yet' : `★${hit.rating} (${hit.votes})`;
  return `- ${hit.id} · ${hit.kind} – ${clip(hit.description, 220)} · ${rating} · ${hit.license}${hit.author ? `, ${hit.author}` : ''}`;
}

/** My skills taken from a library entry ("library:<id>@<rev>") whose entry has another rev now (at most 10 looked at). */
async function changedUpstream(ctx: ToolContext): Promise<string[]> {
  const taken = ctx.services.skills.list(ctx.agent.id)
    .filter((info) => info.source === 'agent' && info.ownerAgentId === ctx.agent.id)
    .flatMap((info) => derivedFromFile(path.join(info.path, 'SKILL.md')).map((item) => ({ skill: info.name, match: /^library:([^@]+)@([0-9a-f]+)$/.exec(item) })))
    .filter((item) => item.match).slice(0, 10);
  const lines: string[] = [];
  for (const { skill, match } of taken) {
    try {
      const entry = await openEntry(match![1]);
      if (entry.rev !== match![2]) lines.push(`- my skill ${skill} came from ${entry.id}, which changed (${entry.updated}): library.open ${entry.id}`);
    } catch { /* gone or unreachable: nothing to say */ }
  }
  return lines.length ? ['Library entries my skills came from that changed since:', ...lines] : [];
}

const find = defineTool<{ words?: string; kind?: LibraryKind }>({
  name: 'library.find',
  description: 'Searches the public library that every Autark shares – skills and notes from other teams, rated by those who used them – by the words of the job.',
  inputSchema: {
    type: 'object',
    properties: { words: { type: 'string', maxLength: 300, description: 'Words of the job; empty: the best rated, and my skills whose entry changed.' }, kind: { type: 'string', enum: ['skill', 'note'] } },
    additionalProperties: false,
  },
  category: 'read',
  describe: (args) => internal(args.words ? `Search the public library for ${clip(args.words, 60)}` : 'Look at the public library'),
  async run(args, ctx) {
    try {
      const hits = await findEntries({ words: args.words, kind: args.kind });
      const lines = hits.length ? [...hits.map(hitLine), 'library.open <id> reads one.'] : [`Nothing in the public library for "${clip(args.words ?? '', 60)}".`];
      return text([...lines, ...(args.words?.trim() ? [] : await changedUpstream(ctx))].join('\n'));
    } catch (error) {
      return failure((error as Error).message);
    }
  },
});

const open = defineTool<{ id: string }>({
  name: 'library.open',
  description: 'Reads one entry of the public library: its text, the files beside it, its license and what those who used it wrote.',
  inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['id'], additionalProperties: false },
  category: 'read',
  describe: (args) => internal(`Read library entry ${clip(args.id, 60)}`),
  async run(args, ctx) {
    try {
      const entry = await openEntry(args.id.trim());
      const files = Object.keys(entry.files);
      return text([
        externalMarker({ kind: 'library', source: [entry.author, entry.license].filter(Boolean).join(', ') }),
        `# ${entry.name} (${entry.kind}, ${entry.rating === null ? 'not rated yet' : `★${entry.rating} from ${entry.votes}`}, ${entry.uses} uses, ${entry.updated})`,
        entry.description,
        entry.body,
        ...(files.length ? [`Files beside it: ${files.join(', ')}`] : []),
        ...(entry.notes.length ? ['What those who used it wrote:', ...entry.notes.map((note) => `- ★${note.stars} ${note.day}: ${note.note}`)] : []),
        `${entry.source ? `Source: ${entry.source}. ` : ''}To keep it as my own: skills.save with from: "${entry.id}" (its files come along). After using it: library.rate.`,
      ].join('\n\n'));
    } catch (error) {
      return failure((error as Error).message);
    }
  },
});

/** The Markdown text of one of my skills or memory files. */
function ownText(ctx: ToolContext, args: { skill?: string; memory?: string; text?: string }): { text: string; name: string } | { error: string } {
  if (args.text) return { text: args.text, name: '' };
  if (args.skill) {
    const skill = ctx.services.skills.get(args.skill, ctx.agent.id);
    if (!skill) return { error: `No skill "${args.skill}".` };
    try { return { text: readFileSync(path.join(skill.info.path, 'SKILL.md'), 'utf8'), name: skill.info.name }; } catch { return { error: `The skill "${args.skill}" could not be read.` }; }
  }
  if (args.memory) {
    const file = ctx.services.knowledge.memoryRead(args.memory);
    if (!file) return { error: `No memory file ${args.memory}.` };
    return { text: `---\nname: ${JSON.stringify(file.title)}\ndescription: ${JSON.stringify(file.description ?? file.title)}\n---\n\n${file.text}\n`, name: file.title };
  }
  return { error: 'Name skill, memory or text.' };
}

const publish = defineTool<{ kind?: LibraryKind; name?: string; skill?: string; memory?: string; text?: string }>({
  name: 'library.publish',
  description: 'Shares one of my skills or notes with every Autark through the public library, free for everyone (CC0). I share what helps outside this company and holds nothing internal – no person, customer, path, account or secret; the app checks it again.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['skill', 'note'] }, name: { type: 'string', minLength: 2, maxLength: 64 },
      skill: { type: 'string', minLength: 1, maxLength: 64, description: 'My skill by name.' }, memory: { type: 'string', minLength: 1, maxLength: 512, description: 'A memory file path.' },
      text: { type: 'string', minLength: 20, maxLength: 60_000, description: 'Text, with name.' },
    },
    additionalProperties: false,
  },
  category: 'publish',
  describe: (args) => ({ summary: `Share ${args.skill ?? args.memory ?? args.name ?? 'an entry'} in the public library`, resource: libraryUrl(), reversible: false, external: true }),
  async run(args, ctx) {
    const own = ownText(ctx, args);
    if ('error' in own) return failure(own.error);
    const kind: LibraryKind = args.kind ?? (args.memory ? 'note' : 'skill');
    const name = args.name ?? own.name;
    if (!name) return failure('name: the entry\'s name in the library.');
    const result = await publishEntry({ kind, name, text: own.text }, {
      enabled: () => (ctx.services.settings.get() as { library?: { publish?: boolean } }).library?.publish !== false,
      redact: (value) => ctx.services.secrets.redact(value),
      check: helperOf(ctx.services),
      share: (entry) => shareEntry({ ...entry, voter: voterId(ctx.services.db, ctx.services.clock.now()) }),
    });
    return result.ok ? json({ ok: true, id: result.id, url: result.url }) : failure(result.text);
  },
});

const rate = defineTool<{ id: string; stars: number; note?: string }>({
  name: 'library.rate',
  description: 'Rates a public library entry I used, 1 to 5, with one line of what happened – so the next team finds the good ones. A new rating of mine replaces my last.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', minLength: 1, maxLength: 80 }, stars: { type: 'integer', minimum: 1, maximum: 5 }, note: { type: 'string', maxLength: 300, description: 'What it did for me, nothing internal.' } },
    required: ['id', 'stars'], additionalProperties: false,
  },
  category: 'publish',
  describe: (args) => ({ summary: `Rate library entry ${clip(args.id, 60)} with ${args.stars}`, resource: libraryUrl(), reversible: true, external: true }),
  async run(args, ctx) {
    const note = args.note?.trim() ?? '';
    if (note && ctx.services.secrets.redact(note) !== note) return failure('The note holds a stored secret value; I write it out.');
    try {
      return json(await rateEntry({ id: args.id.trim(), stars: args.stars, ...(note ? { note } : {}), voter: voterId(ctx.services.db, ctx.services.clock.now()) }));
    } catch (error) {
      return failure((error as Error).message);
    }
  },
});

export const libraryTools: ToolDef[] = [find, open, publish, rate];
