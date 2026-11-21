// Feedback as a GitHub issue (Autark-Plus): a report becomes an issue in the release repository
// (feedback.githubRepo, default desquerteur/Autark-Plus) so "I notice something in the app" ends as an issue that is
// fixed and released there.
// Owns: the issue's title, body and labels built from an already redacted report plus only what the person ticked
// (view, log excerpt), the prefilled github.com/new-issue link, and the calls through the connected GitHub app
// (app.<id>.search_issues / issue_write / add_issue_comment / issue_read): an open issue with the same title gets a
// comment instead of a copy.
// Never: sends chat contents, names, e-mails, paths or secrets (the report text was redacted by FeedbackService and
// the body is redacted again by the caller), uploads a screenshot (the issue page takes it by drag and drop), or reads
// a token – the connected app holds the sign-in.

import { SYSTEM_ID } from '../../shared/ids.ts';
import type { Agent } from '../../shared/model/org.ts';
import type { FeedbackIssue, FeedbackKind, FeedbackReport } from '../../shared/model/system.ts';
import type { RuntimeServices } from '../contracts.ts';
import type { ToolOutput } from '../tools/types.ts';

export const DEFAULT_ISSUE_REPO = 'desquerteur/Autark-Plus';
export const FROM_APP_LABEL = 'from-app';
const TITLE_MAX = 90;
/** Longest prefilled body in a new-issue link (GitHub refuses very long URLs). */
const URL_BODY_MAX = 6000;
const CALL_TIMEOUT_MS = 30_000;
const REPO_PATTERN = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

/** What the person ticked in the preview; everything else stays on the PC. */
export interface IssueInclude {
  /** The page the report was made on (e.g. "chat", "settings/feedback"). */
  view?: boolean;
  /** The redacted tail of warnings and errors from the runtime log. */
  log?: boolean;
}

export interface IssueDraft {
  repo: string;
  title: string;
  body: string;
  labels: string[];
  /** The prefilled github.com new-issue page (works without any sign-in in the app). */
  url: string;
}

/** A valid "owner/name", else the default repository. */
export function issueRepo(value: unknown): string {
  return typeof value === 'string' && REPO_PATTERN.test(value.trim()) ? value.trim() : DEFAULT_ISSUE_REPO;
}

/** bug → bug, everything else → enhancement (GitHub's default labels), plus from-app. */
export function issueLabels(kind: FeedbackKind): string[] {
  return [FROM_APP_LABEL, kind === 'bug' ? 'bug' : 'enhancement'];
}

/** The first line of the report, shortened to a title. */
export function issueTitle(report: Pick<FeedbackReport, 'kind' | 'text'>): string {
  const first = report.text.split('\n').map((line) => line.trim()).find(Boolean) ?? report.kind ?? '';
  const clean = first.replace(/\s+/g, ' ').replace(/^[#>*\-\s]+/, '');
  const title = clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…` : clean;
  return title || 'Report from the app';
}

const KIND_TEXT: Record<FeedbackKind, string> = { bug: 'Bug', idea: 'Idea', change: 'Change request', praise: 'Praise' };

/**
 * The issue body in the fields of the repository's issue templates (.github/ISSUE_TEMPLATE: Kind, What happened,
 * App version, OS, View, Log excerpt). `log` is the already redacted log tail; it is only used when ticked.
 */
export function issueBody(report: FeedbackReport, include: IssueInclude = {}, log?: string): string {
  const lines = [
    `### Kind`, KIND_TEXT[report.kind ?? 'bug'], '',
    `### What happened`, report.text.trim(), '',
    `### App version`, report.context.version, '',
    `### OS`, report.context.os, '',
  ];
  if (include.view && report.context.view) lines.push('### View', report.context.view, '');
  if (include.log && log) lines.push('### Log excerpt', '```', log.trim(), '```', '');
  if (report.screenshotFileId || report.annotationFileId) lines.push('_A screenshot was taken in the app; it is not uploaded automatically._', '');
  lines.push(`<sub>Filed from inside Autark-Plus (${report.author === 'human' ? 'by the person' : 'by an agent'}) · report ${report.id}</sub>`);
  return lines.join('\n');
}

/** github.com/<repo>/issues/new with title, body and labels filled in (labels only stick for people with triage rights). */
export function newIssueUrl(repo: string, title: string, body: string, labels: readonly string[]): string {
  const shortBody = body.length > URL_BODY_MAX ? `${body.slice(0, URL_BODY_MAX)}\n\n…(shortened)` : body;
  const query = new URLSearchParams({ title, body: shortBody, labels: labels.join(',') });
  return `https://github.com/${repo}/issues/new?${query.toString()}`;
}

export function issueDraft(report: FeedbackReport, repo: string, include: IssueInclude = {}, log?: string): IssueDraft {
  const title = issueTitle(report);
  const body = issueBody(report, include, log);
  const labels = issueLabels(report.kind ?? 'bug'); // a report without a kind (an older client) files as a bug
  return { repo, title, body, labels, url: newIssueUrl(repo, title, body, labels) };
}

/** Comparison key for "the same issue": case, whitespace and a trailing ellipsis do not matter. */
export function sameTitle(a: string, b: string): boolean {
  const key = (value: string) => value.toLowerCase().replace(/…$/, '').replace(/\s+/g, ' ').trim();
  return key(a) === key(b);
}

// ------------------------------------------------------------------ the connected GitHub app

export interface IssueRef { number: number; url: string; state: 'open' | 'closed'; title: string }

/** What the feedback service needs from GitHub; the connected app implements it (tests hand in a fake). */
export interface IssueClient {
  /** Open issues in `repo` whose title matches `title`. */
  findOpen(repo: string, title: string): Promise<IssueRef | undefined>;
  create(repo: string, draft: Pick<IssueDraft, 'title' | 'body' | 'labels'>): Promise<IssueRef>;
  comment(repo: string, issue: IssueRef, body: string): Promise<IssueRef>;
  get(repo: string, number: number): Promise<IssueRef>;
}

type ToolRun = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

/** The app id whose `issue_write` tool is registered (the connected GitHub app – "github" first), else undefined. */
export function githubAppId(s: Pick<RuntimeServices, 'tools'>): string | undefined {
  if (s.tools?.get?.('app.github.issue_write')) return 'github';
  const all = (s.tools as { all?: () => Array<{ name: string }> } | undefined)?.all?.() ?? [];
  for (const tool of all) {
    const match = /^app\.([^.]+)\.issue_write$/.exec(tool.name);
    if (match) return match[1];
  }
  return undefined;
}

/** The JSON the GitHub MCP server answers with (its first text block); a failed call throws its text. */
function parseOutput(output: ToolOutput): unknown {
  const textPart = output.content.find((part) => part.type === 'text') as { type: 'text'; text: string } | undefined;
  const value = textPart?.text ?? '';
  if (output.isError) throw new Error(value.slice(0, 300) || 'GitHub refused the call');
  return parseReply(value);
}

/** The JSON in an app reply; the runtime puts an "[untrusted content from app …]" line before it. */
export function parseReply(value: string): unknown {
  try { return JSON.parse(value); } catch { /* a note line before the JSON */ }
  const lines = value.split('\n');
  for (let i = 1; i < lines.length; i++) {
    try { return JSON.parse(lines.slice(i).join('\n')); } catch { /* next line */ }
  }
  return value;
}

/** The issues in a list or search reply: a bare array, `{issues}` (list_issues) or `{items}` (search). */
function replyItems(reply: unknown): unknown[] {
  if (Array.isArray(reply)) return reply;
  const o = (reply && typeof reply === 'object' ? reply : {}) as Record<string, unknown>;
  return Array.isArray(o.issues) ? o.issues : Array.isArray(o.items) ? o.items : [];
}

/** An issue in a reply; `repo` builds its page address when the reply leaves it out (list_issues fields). */
function issueRef(value: unknown, repo?: string): IssueRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  const number = typeof o.number === 'number' ? o.number : undefined;
  const url = typeof o.html_url === 'string' ? o.html_url : typeof o.url === 'string' && o.url.includes('github.com/') && !o.url.includes('api.github.com') ? o.url
    : repo && number !== undefined ? `https://github.com/${repo}/issues/${number}` : undefined;
  if (number === undefined || !url) return undefined;
  const state = String(o.state ?? 'open').toLowerCase() === 'closed' ? 'closed' : 'open';
  return { number, url, state, title: typeof o.title === 'string' ? o.title : '' };
}

/** An issue in a reply: the reply itself, `{issue}` or – for a created issue's short answer – `{url}` with its number. */
function refFrom(value: unknown, fallbackTitle = ''): IssueRef | undefined {
  const direct = issueRef(value);
  if (direct) return direct;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const nested = issueRef(o.issue);
    if (nested) return nested;
    const url = typeof o.url === 'string' ? o.url : typeof o.html_url === 'string' ? o.html_url : undefined;
    const match = url ? /github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/.exec(url) : null;
    if (url && match) return { number: Number(match[1]), url, state: 'open', title: fallbackTitle };
  }
  return undefined;
}

function split(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/');
  return { owner, repo: name };
}

/** The client over the connected GitHub app's tools; `run` calls one tool by its MCP name. */
export function appIssueClient(run: ToolRun): IssueClient {
  return {
    async findOpen(repo, title) {
      // Best effort: the open issues by list (no query syntax to trip over), the search as fallback. A failed
      // look-up never stops the report – then it goes in as a new issue (0.3.10 live test: the search tool refused the title).
      const lookups: Array<() => Promise<unknown>> = [
        () => run('list_issues', { ...split(repo), state: 'OPEN', perPage: 100, orderBy: 'UPDATED_AT', direction: 'DESC', fields: ['number', 'title', 'state'] }),
        () => run('search_issues', { query: searchWords(title), ...split(repo), perPage: 10, fields: ['number', 'title', 'state', 'html_url'] }),
      ];
      for (const lookup of lookups) {
        let reply: unknown;
        try { reply = await lookup(); } catch { continue; }
        for (const item of replyItems(reply)) {
          const ref = issueRef(item, repo);
          if (ref && ref.state === 'open' && sameTitle(ref.title, title)) return ref;
        }
        return undefined;
      }
      return undefined;
    },
    async create(repo, draft) {
      const where = split(repo);
      let reply: unknown;
      try {
        reply = await run('issue_write', { method: 'create', ...where, title: draft.title, body: draft.body, labels: draft.labels });
      } catch {
        // Labels need triage rights on the repository: without them the issue still goes in, unlabelled.
        reply = await run('issue_write', { method: 'create', ...where, title: draft.title, body: draft.body });
      }
      const ref = refFrom(reply, draft.title);
      if (!ref) throw new Error('GitHub did not return the new issue');
      return ref;
    },
    async comment(repo, issue, body) {
      await run('add_issue_comment', { ...split(repo), issue_number: issue.number, body });
      return issue;
    },
    async get(repo, number) {
      const reply = await run('issue_read', { method: 'get', ...split(repo), issue_number: number });
      const ref = refFrom(reply);
      if (!ref) throw new Error('GitHub did not return the issue');
      return ref;
    },
  };
}

/** The client over this PC's connected GitHub app, else undefined (then the new-issue link is the way). */
export function connectedIssueClient(s: RuntimeServices): IssueClient | undefined {
  const appId = githubAppId(s);
  if (!appId) return undefined;
  const agent = { id: SYSTEM_ID, name: 'Autark' } as Agent;
  return appIssueClient(async (tool, args) => {
    const def = s.tools.get(`app.${appId}.${tool}`);
    if (!def) throw new Error(`The GitHub app has no ${tool} tool`);
    const output = await def.run(args, {
      agent, runId: 'feedback-issue', mode: 'general', services: s,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS), status: () => undefined,
    });
    return parseOutput(output);
  });
}

/** File the draft: an open issue with the same title gets a comment, else a new issue. */
export async function fileIssue(client: IssueClient, draft: IssueDraft, now: number): Promise<FeedbackIssue> {
  const existing = await client.findOpen(draft.repo, draft.title);
  if (existing) {
    await client.comment(draft.repo, existing, `Reported again from the app:\n\n${draft.body}`);
    return { repo: draft.repo, number: existing.number, url: existing.url, state: existing.state, commented: true, checkedAt: now };
  }
  const created = await client.create(draft.repo, draft);
  return { repo: draft.repo, number: created.number, url: created.url, state: created.state, checkedAt: now };
}

/** A title as plain search words: GitHub's search refuses brackets, quotes and qualifiers it cannot parse (an unclosed "(" in a clipped title → 422). */
export function searchWords(title: string): string {
  return title.replace(/…$/, '').replace(/[()[\]{}"'`:\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}
