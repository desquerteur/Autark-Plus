// The one finder and the one opener, offered in every mode (tools/registry.ts EVERY_MODE):
//  - knowledge.find lists candidates – skills (by words, and by meaning where a person chose an embedding model), memory notes (all of the tree or
//    the `in` folders), the person's or a colleague's references, the home project's entries (the public library is its own search, library.find)
//    and the secrets catalog's entries (F19: kind 'secret' of the same find, with their handles, never a value) – with id, kind,
//    score and why, never their text. Without a query: my main skills and my mode's. `in` with an absolute folder on this PC lists the skills written there (any provider).
//  - knowledge.open opens one by its id (or a skill by its bare name: my route resolves it) page by page; `home:<name>`
//    opens a home project skill (with `file` one file of its folder), `folder:<path>/<name>` a skill of a folder on this PC.
// Owns: the tool wording, argument shapes and the dispatch by id. Never: ranking (runtime/find/*).

import path from 'node:path';
import type { FindKind } from '../../../shared/model/find.ts';
import { findService, publicCandidate } from '../../find/service.ts';
import { LEGEND, candidateLine, openedText } from '../../find/render.ts';
import type { ToolContext, ToolDef } from '../types.ts';
import { failure, text } from '../types.ts';
import { clip, defineTool, internal, readChat } from './util.ts';
import { threadKey } from '../../../shared/model/origin.ts';
import { loadHomeSkill } from '../../agent-core/home-read.ts';
import { foreignSkillBody, foreignSkillsText, listedSkills, listedSkillLine } from './skills-find.ts';
import { PERSON, subjectOf } from './references.ts';
import '../../contracts/agent-core.ts';

const KINDS: FindKind[] = ['main-skill', 'product-skill', 'note', 'reference', 'document', 'secret'];
const MEMORY = /^memory(?:\/|$)/;

const caller = (ctx: ToolContext) => ({ agent: ctx.agent, conversationId: readChat(ctx), thread: threadKey(ctx), mode: ctx.mode, via: 'agent' as const });

/** Without a query: my main skills and my mode's, as lines. */
function mainSkillsText(ctx: ToolContext): string {
  const skills = listedSkills(ctx.services, ctx.agent, ctx.services.modes.get(ctx.mode));
  return skills.length ? `My skills (knowledge.open <name> loads one):\n${skills.map(listedSkillLine).join('\n')}` : 'No skills for this mode.';
}

const find = defineTool<{ query?: string; kinds?: FindKind[]; in?: string[]; person?: string; limit?: number }>({
  name: 'knowledge.find',
  description: 'Finds skills, memory notes, references, home-project files and secrets (names with their handles) for a job. Best fit first, each with id, kind and why; without query, my main skills. I open one with knowledge.open. What other teams share publicly: library.find.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 1000 },
      kinds: { type: 'array', items: { type: 'string', enum: KINDS }, maxItems: KINDS.length },
      in: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 1024 }, description: 'Memory folders ("memory/company/customers"), or an absolute folder on this PC whose skills written outside this app it lists.' },
      person: { ...PERSON, description: "Whose references: a colleague's name or per_… id; default the person." },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
    additionalProperties: false,
  },
  category: 'read',
  describe: (args) => internal(args.query ? `Find "${clip(args.query, 60)}"` : args.in?.length ? `Look in ${clip(args.in.join(', '), 60)}` : 'List my skills'),
  async run(args, ctx) {
    const places = (args.in ?? []).map((place) => place.trim()).filter(Boolean);
    const outside = places.find((place) => !MEMORY.test(place));
    if (outside && !path.isAbsolute(outside)) return failure(`in: "${clip(outside, 80)}" is neither a memory folder ("memory/…") nor an absolute folder on this PC.`);
    if (outside && places.length > 1) return failure('in: memory folders or one absolute folder, not both.');
    if (outside) return text(foreignSkillsText(outside, ctx.services.paths.workspace, args.query, args.limit));
    const query = args.query?.trim();
    if (!query && (places.length || args.person)) return failure('Searching memory folders or a person\'s references takes a query.');
    if (!query) return text(mainSkillsText(ctx));
    let subject: string | undefined;
    try { subject = args.person ? subjectOf(ctx.services, args.person) : undefined; } catch (error) { return failure((error as Error).message); }
    const folders = places.map((place) => place.replace(MEMORY, '').replace(/\/$/, ''));
    const found = await findService(ctx.services).find(caller(ctx), {
      query, kinds: args.kinds, limit: args.limit ?? 8, signal: ctx.signal, ...(folders.length ? { folders } : {}), ...(subject ? { subject } : {}),
    });
    const none = subject ? 'No reference of theirs fits: I do not know how they would decide here – I say so or ask them.' : 'Nothing fits. I search differently or use another tool.';
    if (!found.length) return text(none);
    return text([`Candidates for "${clip(query, 80)}" (text not included):`, LEGEND, ...found.map((candidate) => candidateLine(publicCandidate(candidate)))].join('\n'));
  },
});

/** A skill outside the find service: of my home project (home:<name>) or of a folder on this PC (folder:<path>/<name>). */
function openOutside(ctx: ToolContext, id: string, file: string | undefined) {
  if (id.startsWith('home:')) {
    const homes = ctx.services.agentCore?.homes;
    if (!homes) return failure('Home projects are not available in this runtime.');
    const read = loadHomeSkill(homes, ctx.agent.id, id.slice(5), file);
    return 'error' in read ? failure(read.error) : text(read.text);
  }
  const given = id.slice(7);
  const read = foreignSkillBody(path.basename(given), path.dirname(given), ctx.services.paths.workspace);
  return 'error' in read ? failure(read.error) : text(read.text);
}

const open = defineTool<{ id: string; file?: string; version?: string; page?: number }>({
  name: 'knowledge.open',
  description: "Opens a skill, note, reference or home-project file by its id or a skill's name, page by page. Opening a skill loads it.",
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 1200, description: 'An id from knowledge.find, or a skill\'s name.' },
      file: { type: 'string', minLength: 1, maxLength: 512, description: 'One file of a home:<name> skill\'s folder.' },
      version: { type: 'string', maxLength: 40, description: 'The one I saw; a newer one is said.' },
      page: { type: 'integer', minimum: 1, maximum: 1000 },
    },
    required: ['id'], additionalProperties: false,
  },
  category: 'read',
  describe: (args) => internal(`Open ${clip(args.id, 60)}${args.file ? ` (${clip(args.file, 40)})` : ''}`, args.id),
  async run(args, ctx) {
    const id = args.id.trim();
    if (id.startsWith('home:') || id.startsWith('folder:')) return openOutside(ctx, id, args.file);
    try {
      const opened = await findService(ctx.services).open(caller(ctx), { id: id.includes(':') ? id : `skill:${id}`, version: args.version, page: args.page });
      return text(openedText({ ...opened, candidate: publicCandidate(opened.candidate), follow: opened.follow.map(publicCandidate) }));
    } catch (error) {
      return failure((error as Error).message);
    }
  },
});

export const findTools: ToolDef[] = [find, open];
