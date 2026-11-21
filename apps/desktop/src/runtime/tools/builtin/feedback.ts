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

interface IssueArgs { kind: FeedbackKind; text: string; preview?: boolean; includeLog?: boolean }

// Autark-Plus: what the person says in a chat ("this is broken …") becomes an issue in the release repository.
const fileIssueTool = defineTool<IssueArgs>({
  name: 'feedback.issue',
  description: 'Autark-Plus: file a bug or idea about this app as a GitHub issue in the release repository (Settings feedback.githubRepo, default desquerteur/Autark-Plus), labelled from-app + bug/enhancement; an open issue with the same title gets a comment instead of a copy. Secrets, e-mails, names in paths are stripped. Call with preview: true first and show the person the title and body; file (preview false) only after they agreed. Without a connected GitHub app it returns a prefilled github.com link for the person to open. Only for the app itself, never for the person’s own projects.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: KINDS },
      text: { type: 'string', minLength: 5, maxLength: 8000, description: 'First line = the issue title; then what happened, what was expected, steps.' },
      preview: { type: 'boolean', description: 'true: only return what would be sent (default true).' },
      includeLog: { type: 'boolean', description: 'Attach the redacted tail of the app log (warnings and errors).' },
    },
    required: ['kind', 'text'],
    additionalProperties: false,
  },
  category: 'write_system',
  describe: (args) => ({ summary: `GitHub issue${args.preview === false ? '' : ' (preview)'}: ${clip(args.text, 60)}`, external: args.preview === false }),
  async run(args, ctx) {
    const feedback = new FeedbackService({ services: () => ctx.services });
    try {
      const report = feedback.create({ kind: args.kind, text: args.text, conversationId: ctx.conversationId, runId: ctx.runId, author: ctx.agent.id });
      const include = { log: args.includeLog === true };
      if (args.preview !== false) {
        const draft = feedback.issuePreview(report.id, include);
        return json({ preview: true, reportId: report.id, repo: draft.repo, title: draft.title, labels: draft.labels, body: draft.body, connected: draft.connected, next: 'Show this to the person; call again with preview: false once they agree.' });
      }
      const result = await feedback.fileIssue(report.id, include);
      return result.filed
        ? json({ ok: true, url: result.url, number: result.report.issue?.number, commented: Boolean(result.report.issue?.commented) })
        : json({ ok: false, url: result.url, note: 'No GitHub app is connected: give the person this link – it opens the filled-in issue form.' });
    } catch (error) {
      if (error instanceof WorkforceError && (error.code === 'conflict' || error.code === 'unavailable')) return failure(error.message);
      throw error;
    }
  },
});

export const feedbackTools: ToolDef[] = [reportFeedback, fileIssueTool];
