// RPC voice.retranscribe (B-082, "nothing gets lost"): the person's own sent audio-only message whose hearing failed
// (meta.dictation.failed) is heard again on their word – the same hearing path as on arrival (media/dictation.ts); the
// text lands in the body and `failed` goes. Registered from handlers/app.ts. Scope 'chat'.
// Owns: the param check and whose message it may be. Never: hears anything itself or touches another author's message.

import '../../../shared/api/methods-voice-retry.ts'; // the method shape (module augmentation)
import { WorkforceError } from '../../../shared/errors.ts';
import { HUMAN_ID } from '../../../shared/ids.ts';
import { dictationOf } from '../../media/dictation.ts';
import { id, input, notFound, onlyKeys } from '../params.ts';
import type { HandlerTable } from '../table.ts';

const CHAT = { capability: 'chat' } as const;

export function register(table: HandlerTable): void {
  table.add('voice.retranscribe', async (params, ctx) => {
    const o = input(params);
    onlyKeys(o, ['messageId']);
    const messageId = id(o, 'messageId');
    const message = ctx.services.chats.message(messageId) ?? notFound('Message', { messageId });
    if (message.authorKind !== 'human' || message.authorId !== HUMAN_ID) throw new WorkforceError('forbidden', 'Only your own recordings can be heard again.', { details: { messageId } });
    if (!(message.meta?.dictation as { failed?: unknown } | undefined)?.failed) throw new WorkforceError('conflict', 'This message has no failed recording to hear again.', { details: { messageId } });
    const dictation = dictationOf(ctx.services);
    if (!dictation) throw new WorkforceError('unavailable', 'Hearing recordings is not available in this runtime.');
    if (!(await dictation.retry(message))) throw new WorkforceError('unavailable', 'This recording could not be heard this time; it stays here to try again.', { details: { messageId } });
    return { ok: true as const };
  }, CHAT);
}
