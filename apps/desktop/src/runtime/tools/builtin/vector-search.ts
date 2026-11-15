// vector.search: grep over meaning in embedded files and folders. Embeds only the query and compares it with what is
// already embedded under the places; `hops` (vectors/hops.ts) let the best hits search on. Notes and the knowledge catalog
// are knowledge.find's. Both vector tools are offered only while a chosen embedding model can serve (requires 'embeddings').
// Owns: the tool's wording, argument shape and result text. Never: embeds files itself (a model does, with vector.embed).

import path from 'node:path';
import type { VectorHit } from '../../../shared/model/vectors.ts';
import type { ToolDef } from '../types.ts';
import { failure, text } from '../types.ts';
import { clip, defineTool } from './util.ts';
import { MAX_K } from '../../vectors/service.ts';
import { MAX_HOPS } from '../../vectors/hops.ts';
import { placePath, vectorEmbed } from './vector-embed.ts';
import '../../contracts/vectors.ts';

function line(hit: VectorHit): string {
  const where = hit.lines ? `${hit.path}:${hit.lines[0]}-${hit.lines[1]}` : `${hit.path} #${hit.chunk}`;
  return `${hit.score.toFixed(2)} ${where}${hit.via ? ` (via ${hit.via})` : ''}\n  ${clip(hit.snippet.replace(/\s+/g, ' ').trim(), 240)}`;
}

export const vectorSearch: ToolDef = defineTool<{ query: string; in: string[]; limit?: number; hops?: number }>({
  name: 'vector.search',
  description: 'Searches embedded files and folders by meaning, like grep for ideas. The words a matching text holds find it best, a question blurs it; exact words are files.search.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 2000 },
      in: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 1024 }, description: 'Files and folders.' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_K },
      hops: { type: 'integer', minimum: 0, maximum: MAX_HOPS, description: '1–2: the best hits search on.' },
    },
    required: ['query', 'in'], additionalProperties: false,
  },
  category: 'read',
  anyMode: true,
  requires: 'embeddings',
  describe: (args) => ({ summary: `Search by meaning for "${clip(args.query, 80)}" in ${clip(args.in.join(', '), 80)}`, resource: args.in[0], reversible: true, external: false }),
  async run(args, ctx) {
    if (ctx.fromPc !== undefined) return failure('vector.search runs only for agents of this PC.');
    const query = args.query.trim();
    if (!query) return failure('Say what to search for.');
    const places = await Promise.all(args.in.map((given) => placePath(ctx, given)));
    const result = await ctx.services.vectors.search({ query, in: places, ...(args.limit ? { k: args.limit } : {}), ...(args.hops ? { hops: args.hops } : {}) });
    const lines: string[] = [];
    if (result.note) lines.push(result.note);
    lines.push(`${result.hits.length} hits.`);
    lines.push(...result.hits.map(line));
    if (result.hits.some((hit) => hit.path.startsWith('memory/'))) lines.push(`memory/ is ${path.join(ctx.services.paths.data, 'memory')}`);
    return text(lines.join('\n'));
  },
});

export const vectorTools: ToolDef[] = [vectorEmbed, vectorSearch];
