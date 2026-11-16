// feedback.report: agents report friction, bugs and ideas about the app itself.
// Owns: the agent-facing tool. The report goes through FeedbackService.create (pattern
// redaction, author = the agent so it stays marked unverified, the run id, the same text within
// 24 h only raises a count, at most 5 new reports per agent per day – then a short refusal).
// Never: sends anything to the developers or notifies/pushes the person – the human reviews it
// under Settings › Feedback › From agents and sends or dismisses it (no hidden upload).

import type { ToolDef } from '../types.ts';
import { failure, json } from '../types.ts';
import type { FeedbackKind } from '../../../shared/model/system.ts';
import { WorkforceError } from '../../../shared/errors.ts';
import { FeedbackService } from '../../feedback/service.ts';
import { clip, defineTool, internal } from './util.ts';

const KINDS: FeedbackKind[] = ['bug', 'idea', 'change', 'praise'];

const reportFeedback = defineTool<{ kind: FeedbackKind; text: string }>({
  name: 'feedback.report',
  description: 'Tells the makers of this app what falls short for my work in it – a bug, a missing ability, an idea – or what works well. The person reviews it first; up to 5 a day, each problem once.',
  inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: KINDS }, text: { type: 'string', minLength: 5, maxLength: 8000 } }, required: ['kind', 'text'], additionalProperties: false },
  category: 'think',
  describe: (args) => internal(`Feedback (${args.kind}): ${clip(args.text, 60)}`),
  async run(args, ctx) {
    // Stateless apart from the database, so one per call is the same service the RPC uses.
    const feedback = new FeedbackService({ services: () => ctx.services });
    try {
      const report = feedback.create({ kind: args.kind, text: args.text, conversationId: ctx.conversationId, runId: ctx.runId, author: ctx.agent.id });
      return report.count && report.count > 1
        ? json({ ok: true, id: report.id, count: report.count, note: 'Already reported in the last 24 hours; counted again.' })
        : json({ ok: true, id: report.id });
    } catch (error) {
      if (error instanceof WorkforceError && error.code === 'conflict') return failure(error.message);
      throw error;
    }
  },
});

export const feedbackTools: ToolDef[] = [reportFeedback];
