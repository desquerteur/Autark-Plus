// Media library tools: media.search (find stored images, recordings, videos and documents by
// name, description, tags, kind and chat), media.describe (save what a file shows) and
// media.transcribe (the transcript of a recording or video – the cached one or one speech-to-
// text run through RuntimeServices.stt; addition MM1). With them in `mediaTools`: media.look
// (MM4, media-look.ts: keyframes of a video with timestamps and a transcript excerpt), media.listen
// (MM10, media-listen.ts: a listening model's answer about music, sounds and voices; B-058 G9: any
// recording or video, and without a listening model a local hearing report with sound tags), media.view
// (see a stored image) and the generation tools (media-generate.ts). Shared helpers live in media-common.ts.
// The tool descriptions are the prompt fragment that asks agents to describe media they
// inspect – there is no automatic description; vision-capable agents write it when they look.
// Owns: argument handling of search, describe and transcribe, and the list of media tools.
// B-080: a file without a chat is shown, described or transcribed by its exact id (my own screenshots and outputs);
// media.search lists such a file only once it is described or tagged (media/repo.ts AGENT_SCOPE).
// Never: shows, describes or transcribes media of chats the agent is not a member of, or presents
// names/descriptions/transcripts as instructions (they are data from file contents).

import { WorkforceError } from '../../../shared/errors.ts';
import type { MediaKind } from '../../../shared/model/media.ts';
import type { SpeechToText } from '../../contracts.ts';
import { MEDIA_LIMITS, MediaLibrary } from '../../media/library.ts';
import type { ToolDef } from '../types.ts';
import { failure, json } from '../types.ts';
import { DATA_NOTE, MEDIA_DESCRIBE_HINT, mediaFileId, readableMedia, TRANSCRIPT_NOTE, untilStopped, view } from './media-common.ts';
import { generationTools } from './media-generate.ts';
import { hearsHere, savedText } from './media-hearing.ts'; // B-058 G9: the one format/length gate (media/hear-any.ts)
import { listen } from './media-listen.ts';
import { look } from './media-look.ts';
import { mediaView } from './media-view.ts'; // B-058 G10 (T4): media.view – see a stored or workspace image
import { mediaSegmentTools } from './media-segments.ts'; // media.segments: marked parts of a file, in a memory note
import { clip, defineTool, internal, readChat, resolveChat } from './util.ts';
import { FILE_ID_PROPERTY } from '../types.ts';

export { MEDIA_DESCRIBE_HINT, mediaFileId } from './media-common.ts';

const KINDS: MediaKind[] = ['image', 'audio', 'video', 'document', 'other'];
const TRANSCRIPT_CHARS = 20_000;
const search = defineTool<{ query?: string; kind?: MediaKind; chatId?: string; limit?: number }>({
  name: 'media.search',
  description: 'Finds stored images, recordings, videos and documents by name, description or tags.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', maxLength: 200 }, kind: { type: 'string', enum: KINDS }, chatId: { type: 'string', description: 'One chat; default all of mine.' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    additionalProperties: false,
  },
  category: 'read',
  describe: (args) => internal(`Search media${args.query ? ` "${clip(args.query, 60)}"` : ''}`, args.chatId),
  async run(args, ctx) {
    const conversationId = args.chatId ? resolveChat(ctx, args.chatId, { read: true }) : undefined;
    const items = new MediaLibrary(ctx.services).list(
      { text: args.query?.trim() || undefined, kind: args.kind, conversationId, limit: args.limit ?? 20 },
      { kind: 'agent', agentId: ctx.agent.id });
    return json({ note: DATA_NOTE, count: items.length, items: items.map(view) });
  },
});

const describeMedia = defineTool<{ fileId: string; description: string; tags?: string[] }>({
  name: 'media.describe',
  description: 'Saves a description and tags for a stored file. What I describe when I see it – a picture, a screenshot, a recording – media.search finds later.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: FILE_ID_PROPERTY,
      description: { type: 'string', minLength: 1, maxLength: MEDIA_LIMITS.description, description: 'What it shows, visible text, style, purpose; people by role.' },
      tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: MEDIA_LIMITS.tag }, maxItems: MEDIA_LIMITS.tags },
    },
    required: ['fileId', 'description'], additionalProperties: false,
  },
  category: 'write_local',
  describe: (args) => internal(`Describe media ${clip(mediaFileId(args.fileId) ?? args.fileId, 70)}`, mediaFileId(args.fileId)),
  async run(args, ctx) {
    const found = readableMedia(ctx, args.fileId, 'describe');
    if ('refused' in found) return found.refused;
    if (!args.description.trim()) return failure('Write a description.');
    const next = found.media.describe(found.info.fileId, { description: args.description, ...(args.tags ? { tags: args.tags } : {}) }, ctx.agent.id);
    return json({ ok: true, media: view(next) });
  },
});

const transcribe = defineTool<{ fileId: string }>({
  name: 'media.transcribe',
  description: 'Returns the transcript of a stored recording or video, made now if none is saved. New attachments arrive with theirs already.',
  inputSchema: {
    type: 'object',
    properties: { fileId: FILE_ID_PROPERTY },
    required: ['fileId'], additionalProperties: false,
  },
  category: 'read',
  describe: (args) => internal(`Transcribe media ${clip(mediaFileId(args.fileId) ?? args.fileId, 70)}`, mediaFileId(args.fileId)),
  async run(args, ctx) {
    const found = readableMedia(ctx, args.fileId, 'transcribe');
    if ('refused' in found) return found.refused;
    const { info } = found;
    if (info.kind !== 'audio' && info.kind !== 'video') return failure('Only recordings and videos have a transcript.');
    const gate = hearsHere(ctx, info, true); // any format the host decodes or the transcription service takes
    if (!gate.ok && !savedText(ctx, info.fileId)) return failure(gate.reason);
    const stt: SpeechToText | undefined = ctx.services.stt;
    if (!stt) return failure('Speech to text is not available in this runtime.');
    if (ctx.signal.aborted) return failure('Stopped before the transcript was ready.');
    let transcript: string | undefined;
    try {
      transcript = await untilStopped(stt.transcript(info.fileId), ctx.signal);
    } catch (error) {
      return failure(error instanceof WorkforceError ? error.message : 'The transcription failed.');
    }
    if (transcript === undefined) return failure('Stopped before the transcript was ready.');
    const truncated = transcript.length > TRANSCRIPT_CHARS;
    const out: Record<string, unknown> = { note: TRANSCRIPT_NOTE, media: view(info), transcript: truncated ? transcript.slice(0, TRANSCRIPT_CHARS) : transcript };
    if (truncated) out.truncated = true;
    if (gate.ok && gate.note) out.transcriptNote = `Possibly incomplete: ${gate.note} when speech to text runs on this PC.`; // never a silent cut
    return json(out);
  },
});

export const mediaTools: ToolDef[] = [search, describeMedia, transcribe, look, mediaView, listen, ...mediaSegmentTools, ...generationTools];
