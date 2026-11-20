// Autark-Plus "Report issue": a saved report as a GitHub issue in the release repository. Shows exactly what goes
// out (title, labels, body – already redacted by the runtime), two ticks for the only extras that may go along (the
// page it happened on, the redacted log excerpt) and one action: "Create issue" through the connected GitHub app, or
// "Open on GitHub" (the prefilled new-issue page) where no GitHub app is connected. A filed report shows its issue
// (#number, open/closed) with Open.
// Owns: the preview, the ticks and that one action. Never: files without a click, or sends chat contents, names,
// e-mails or paths (the runtime strips them; nothing else is added here).

import { useEffect, useState } from 'preact/hooks';
import type { FeedbackIssueInclude, FeedbackIssuePreview } from '../../shared/model/feedback-delivery.ts';
import type { FeedbackIssue, FeedbackReport } from '../../shared/model/system.ts';
import { openExternal } from '../lib/platform.ts';
import { errorText, rpc } from '../lib/rpc.ts';

/** "#42 · open" / "#42 · closed" – "added to #7" when the report went in as a comment. */
export function issueLabel(issue: Pick<FeedbackIssue, 'number' | 'state' | 'commented'>): string {
  return `${issue.commented ? 'Added to ' : ''}#${issue.number} · ${issue.state === 'closed' ? 'closed' : 'open'}`;
}

/** The one action's label: what a click really does. */
export function issueActionLabel(connected: boolean | undefined, busy: boolean): string {
  if (busy) return 'Creating…';
  return connected ? 'Create issue' : 'Open on GitHub';
}

export function IssueFiled(props: { issue: FeedbackIssue }) {
  const { issue } = props;
  return (
    <p class="feedback-issue-filed">
      <span class={`feedback-issue-state ${issue.state}`}>{issueLabel(issue)}</span>
      <span class="feedback-issue-repo">{issue.repo}</span>
      <button type="button" class="button ghost small" onClick={() => openExternal(issue.url)}>Open</button>
    </p>
  );
}

export function IssuePreview(props: { report: FeedbackReport; onFiled?: (report: FeedbackReport) => void }) {
  const { report } = props;
  const [include, setInclude] = useState<FeedbackIssueInclude>({ view: false, log: false });
  const [preview, setPreview] = useState<FeedbackIssuePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (report.issue) return;
    let live = true;
    rpc.call('feedback.issuePreview', { id: report.id, include })
      .then((next) => { if (live) { setPreview(next); setError(null); } }, (err: unknown) => { if (live) setError(errorText(err)); });
    return () => { live = false; };
  }, [report.id, report.issue, include.view, include.log]);

  if (report.issue) return <IssueFiled issue={report.issue} />;

  const file = async () => {
    if (busy || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call('feedback.fileIssue', { id: report.id, include });
      if (!result.filed) openExternal(result.url); // no GitHub app: the filled-in form opens in the browser
      else props.onFiled?.(result.report);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const tick = (key: keyof FeedbackIssueInclude) => (event: Event) => setInclude({ ...include, [key]: (event.currentTarget as HTMLInputElement).checked });
  return (
    <section class="feedback-issue" aria-label="GitHub issue">
      <header class="feedback-issue-head">
        <span class="feedback-issue-title">{preview?.title ?? '…'}</span>
        <span class="feedback-issue-repo">{preview?.repo}</span>
      </header>
      {preview && <p class="feedback-issue-labels">{preview.labels.map((label) => <span key={label} class="feedback-issue-label">{label}</span>)}</p>}
      <pre class="feedback-issue-body" tabIndex={0} aria-label="What goes out">{preview?.body ?? ''}</pre>
      <div class="feedback-issue-ticks">
        <label class="feedback-check">
          <input type="checkbox" checked={include.view === true} disabled={busy || !report.context.view} onChange={tick('view')} />
          Page it happened on
        </label>
        <label class="feedback-check">
          <input type="checkbox" checked={include.log === true} disabled={busy} onChange={tick('log')} />
          Log excerpt (warnings, redacted)
        </label>
      </div>
      <p class="feedback-issue-hint">
        {preview?.connected === false
          ? 'No GitHub app is connected: the filled-in issue opens in your browser.'
          : 'Secrets, e-mails and names in paths are removed. Chats are never sent.'}
        {(report.screenshotFileId || report.annotationFileId) ? ' Drag the screenshot into the issue page if it helps.' : ''}
      </p>
      <div class="feedback-actions">
        <p class="feedback-message" role="alert" title={error ?? undefined}>{error}</p>
        <button type="button" class="button primary feedback-issue-create" disabled={busy || !preview} onClick={() => void file()}>
          {issueActionLabel(preview?.connected, busy)}
        </button>
      </div>
    </section>
  );
}
