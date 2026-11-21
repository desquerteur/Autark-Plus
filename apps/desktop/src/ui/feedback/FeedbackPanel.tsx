// B-055 Q4: the feedback form – since feedback 16.11.2026 (F11, F15) the slim dock at the bottom of the snapshot
// overlay (FeedbackOverlay.tsx), three rows of fixed height: the attachments (the overlay's screenshot box and paint
// tools, "Recording", an attached crash report – FeedbackRows.tsx –, the always reserved message slot (role=alert), the
// team's Inbox), then the close arrow (the draft stays), one field with the mic inside it that grows with its text (tap
// to toggle, hold to talk – it keeps adding text) and one action: Send where this build can send, else Save
// (delivery.ts), and the privacy note. The report carries one image: the screenshot with its marks
// flattened into one JPEG at Send (paint-image.ts flatten – never the raw shot of a painted draft). The draft lives in
// draft.ts, so closing keeps it; a sent report clears it. After a Save or an unconfirmed Send the dock says what
// happened in one line; when the send was not confirmed, the action cell of that line reads "Send again" (not Close)
// and sends the same saved report.
// Feedback 16.11.2026: Send first puts the report into this page's outbox (outbox.ts: written before any upload,
// with a clientId, so a lost answer never makes a second report), then delivers it. A confirmed send closes the
// form at once and the status line says "Feedback sent · No. …" for 4 s (F11); a report the PC could not be reached
// for waits in this page and goes on the next connect (the line says so); only a failure keeps the form open with
// "Send again". The report carries its kind (AF-003, below), the device it was written on
// (client.ts), the dictation's recordings while "Recording" is on and an attached Android crash report
// (FeedbackRows.tsx); a recording or a crash report alone is enough to send.
// Owns: the dock's form and submitting it. Never: starts an app change, requests a login, opens a browser or discards
// a failed submission.
// AF-003 (Autark-Plus): the report has a kind after all – "Bug | Idea" at the start of the attachments row (one radio
// group; the field's placeholder follows it), sent as feedback.create `kind` (outbox.ts); the sent toast has Copy for
// the report number (delivery.ts announceSent). Autark-Plus: a report saved on the PC that did not go to the team
// offers the GitHub issue under the result line (IssuePreview.tsx: preview, ticks, Create issue / Open on GitHub).

import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { FeedbackReport } from '../../shared/model/system.ts';
import { Icon } from '../lib/icons.tsx';
import { errorText, rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { bridge } from '../lib/platform.ts';
import { isMobile, settings } from '../lib/store.ts';
import { isPhoneApp } from '../pwa/native.ts';
import { useDictation } from './bridge.ts';
import { currentClient } from './client.ts';
import { appendDraftText, canSubmit, clearDraft, DRAFT_KINDS, draftKind, feedbackDraft, reportText, sentDraft, shownDraft, updateDraft } from './draft.ts';
import type { DraftKind, FeedbackDraft } from './draft.ts';
import { announceSent, canSendAgain, closesAtOnce, doneText, heldText, notSentLine, sendAgainLabel, sendLabel, sendReport, useFeedbackSending } from './delivery.ts';
import { talkError, talkState } from './FeedbackButton.tsx';
import { FeedbackInboxEntry } from './FeedbackInbox.tsx';
import { FeedbackPrivacyNote } from './FeedbackPrivacy.tsx';
import { IssuePreview } from './IssuePreview.tsx';
import { CrashRow, RecordingRow } from './FeedbackRows.tsx';
import { announce, draftOf, feedbackOutbox, newClientId } from './outbox.ts';
import type { OutboxEntry, Outcome, ReportLine } from './outbox.ts';
import { flatten } from './paint-image.ts';
import { here, snapshotSettled } from './popover-state.ts';

/** How long the form waits for the PC before it says the report waits in this page (the delivery goes on). */
const FORM_WAIT_MS = 15_000;

/** The report's one image as a JPEG data URL: the screenshot with its marks flattened in (none: re-encoded as it is). */
async function imageOf(draft: FeedbackDraft): Promise<string | undefined> {
  return draft.withShot && draft.shot ? flatten(draft.shot, draft.marks) : undefined;
}

/** The outbox entry of what the draft holds now (only what the checkboxes let go). */
async function entryOf(draft: FeedbackDraft, send: boolean): Promise<OutboxEntry> {
  const image = await imageOf(draft);
  return {
    clientId: newClientId(), at: Date.now(), send, text: reportText(draft),
    kind: draftKind(draft), // AF-003
    where: draft.where.view ? draft.where : here(),
    client: currentClient(settings.peek()?.profile.language),
    ...(image ? { image } : {}),
    audio: draft.withAudio ? [...draft.audio] : [],
    ...(draft.withDiagnostics && draft.diagnostics ? { clientDiagnostics: draft.diagnostics } : {}),
  };
}

/** AF-003: Bug | Idea – one radio group (arrow keys move the choice, one tab stop). */
function KindChoice(props: { kind: DraftKind; disabled: boolean }) {
  const pick = (kind: DraftKind, focus?: HTMLElement | null) => { updateDraft({ kind }); focus?.focus(); };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = (DRAFT_KINDS.findIndex((option) => option.kind === props.kind) + step + DRAFT_KINDS.length) % DRAFT_KINDS.length;
    const group = (event.currentTarget as HTMLElement | null);
    pick(DRAFT_KINDS[index].kind, group?.querySelectorAll<HTMLElement>('[role=radio]')[index]);
  };
  return (
    <div class="segmented feedback-kind" role="radiogroup" aria-label="Kind of feedback" onKeyDown={onKeyDown}>
      {DRAFT_KINDS.map((option) => {
        const checked = option.kind === props.kind;
        return (
          <button key={option.kind} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1}
            class={checked ? 'selected' : ''} disabled={props.disabled} onClick={() => pick(option.kind)}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Autark-Plus: the GitHub issue offer under the result line. The outcome carries only the report's line, so the full
 *  report (its context and screenshot) is read from feedback.list when the line is not one already. */
function IssueOffer(props: { line: ReportLine; onFiled: (report: FeedbackReport) => void }) {
  const full = (line: ReportLine): FeedbackReport | null => ('context' in line ? line as FeedbackReport : null);
  const [report, setReport] = useState<FeedbackReport | null>(() => full(props.line));
  useEffect(() => {
    const known = full(props.line);
    if (known) { setReport(known); return; }
    let live = true;
    rpc.call('feedback.list').then((list) => { if (live) setReport(list.find((entry) => entry.id === props.line.id) ?? null); }, () => undefined);
    return () => { live = false; };
  }, [props.line]);
  return report ? <IssuePreview report={report} onFiled={props.onFiled} /> : null;
}

/** Where a held report waits (heldText). */
const waitsIn = (): 'window' | 'phone' | 'browser' => (bridge ? 'window' : isPhoneApp() || isMobile.peek() ? 'phone' : 'browser');

/** Focus back on the feedback button after the form closed by itself (when the closed overlay left it nowhere). */
function focusBack(): void {
  requestAnimationFrame(() => {
    if (document.activeElement === document.body || !document.activeElement?.isConnected) document.querySelector<HTMLElement>('.feedback-toggle')?.focus({ preventScroll: true });
  });
}

/** The field grows with its text (one line to start; feedback.css caps it, then it scrolls). */
function fitField(area: HTMLTextAreaElement | null): void {
  if (!area) return;
  area.style.height = '';
  if (!area.scrollHeight) return; // not laid out yet (the overlay opens after the form): the stylesheet's height holds
  area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`;
}

/**
 * The dock. `tools`: the overlay's screenshot box and paint tools (the first cells of the attachments row); `note`: a
 * message of theirs for the message slot; `onInbox`: the team's inbox opens (the overlay closes).
 */
export function FeedbackForm(props: { onClose: () => void; onInbox: () => void; tools?: ComponentChildren; note?: string | null }) {
  const draft = shownDraft(); // while a send is on its way: the draft as sent (17.11.2026)
  const sending = useFeedbackSending(); // undefined until known: "Save" (never sends) meanwhile
  const [submittingNow, setBusy] = useState(false);
  const busy = submittingNow || sentDraft.value !== null; // a form opened again during a send shows it, disabled
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ReportLine | null>(null);
  const [held, setHeld] = useState(false); // the PC was not reached: the report waits in this page (outbox.ts)
  const [tried, setTried] = useState(false); // a feedback.send went out for the done report (else it was only saved)
  const submitting = useRef(false);
  const mounted = useRef(true);
  const field = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation(appendDraftText, settings.value?.profile.language);

  useEffect(() => {
    // The computer types at once; a phone keeps its keyboard down until the field is tapped (the frozen screen stays whole).
    const frame = isMobile.peek() ? 0 : requestAnimationFrame(() => {
      const area = field.current;
      if (!area) return;
      area.focus({ preventScroll: true });
      area.setSelectionRange(area.value.length, area.value.length);
    });
    return () => { cancelAnimationFrame(frame); mounted.current = false; };
  }, []);
  useLayoutEffect(() => fitField(field.current), [draft.text, held, done]);

  /** A delivery's outcome in the form – or, once the form is gone, in the status line. */
  const show = (outcome: Outcome, entry: OutboxEntry) => {
    if (!mounted.current) { announce(outcome, entry); return; }
    if (outcome.kind === 'sent' && closesAtOnce(outcome.report, null)) { // F11: read in a glance, the form goes at once
      props.onClose();
      announceSent(outcome.report);
      focusBack();
      return;
    }
    if (outcome.kind === 'held') { setHeld(true); return; }
    if (outcome.kind === 'refused') { feedbackDraft.value = draftOf(entry); setError(errorText(outcome.error)); return; }
    setDone(outcome.report); // saved on the PC; the line says so, the error says why it did not go
    if (outcome.error !== undefined) setError(notSentLine(outcome.error));
  };

  const submit = async () => {
    if (submitting.current || !canSubmit(feedbackDraft.peek())) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const send = sending === true; // what the button said: "Save" (unknown or not set up) never sends
      await snapshotSettled(); // a new snapshot on its way: the report carries it (bounded)
      const entry = await entryOf(feedbackDraft.peek(), send);
      await feedbackOutbox.put(entry); // kept before anything goes out
      sentDraft.value = feedbackDraft.peek(); // shown, disabled, until the outcome: what the person sent
      clearDraft(); // the outbox holds it now; the next press takes a fresh screenshot
      setTried(send);
      const delivery = feedbackOutbox.deliver(entry);
      const outcome = await Promise.race([delivery, new Promise<null>((resolve) => setTimeout(() => resolve(null), FORM_WAIT_MS))]);
      if (outcome) show(outcome, entry);
      else { void delivery.then((late) => announce(late, entry)); show({ kind: 'held' }, entry); }
    } catch (err) {
      setError(errorText(err)); // nothing left the page (the image could not be prepared): the draft is still here
    } finally {
      sentDraft.value = null;
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  // Not confirmed (only saved on the PC) where sending works: the same saved report goes out again, in the Close cell.
  const again = async (id: string) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    setTried(true);
    try {
      const report = await sendReport(id);
      if (closesAtOnce(report, null)) { props.onClose(); announceSent(report); focusBack(); return; }
      setDone(report);
    } catch (err) {
      setError(notSentLine(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  // After Send: one line of what happened and one action, in the dock's place (the report left the draft).
  if (held || done) {
    const report = done;
    const issue = (report as Partial<FeedbackReport> | null)?.issue;
    return (
      <div class="feedback-dock done" role="group" aria-label="Feedback">
        {report && (report.status !== 'sent' || issue) && can('feedback.fileIssue') && <IssueOffer line={report} onFiled={setDone} />}
        <div class="feedback-dock-main">
          <p class="feedback-done">{issue ? 'Filed on GitHub.' : report ? doneText(report, tried || (sending === false ? false : undefined)) : heldText(waitsIn())}</p>
          <p class="feedback-message" role="alert" title={error ?? undefined}>{error}</p>
          {report && canSendAgain(report.status, sending)
            ? <button type="button" class="button primary feedback-send feedback-again" disabled={busy} onClick={() => void again(report.id)}>{sendAgainLabel(busy)}</button>
            : <button type="button" class="button primary feedback-send" onClick={props.onClose}>Close</button>}
        </div>
      </div>
    );
  }

  const listening = dictation.state === 'listening';
  const transcribing = dictation.state === 'transcribing' || talkState.value === 'transcribing';
  const message = error ?? dictation.error ?? talkError.value ?? props.note ?? null;
  const phone = isMobile.value;
  const kind = draftKind(draft); // AF-003
  return (
    <div class="feedback-dock" role="group" aria-label="Feedback">
      <div class="feedback-dock-row">
        <KindChoice kind={kind} disabled={busy} />
        {props.tools}
        {(dictation.available || draft.audio.length > 0) && <RecordingRow draft={draft} disabled={busy} />}
        <CrashRow draft={draft} disabled={busy} />
        {!phone && <p class="feedback-message" role="alert" title={message ?? undefined}>{message}</p>}
        <FeedbackInboxEntry shown onOpen={props.onInbox} />
      </div>
      <div class="feedback-dock-main">
        <button type="button" class="icon-button feedback-close" aria-label="Close – your draft stays" title="Close (Esc) – your draft stays" onClick={props.onClose}>
          <Icon name="arrow-down" size={18} />
        </button>
        <div class="feedback-input">
          <textarea
            ref={field}
            class="set-textarea"
            rows={1}
            aria-label="Your feedback"
            placeholder={DRAFT_KINDS.find((option) => option.kind === kind)?.placeholder}
            value={draft.text} disabled={busy}
            onInput={(event) => updateDraft({ text: (event.currentTarget as HTMLTextAreaElement).value })}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit(); }}
          />
          {dictation.available && (
            <button type="button" class={`icon-button mic${listening ? ' active' : ''}`}
              aria-label={listening ? 'Stop dictation' : 'Dictate'} aria-pressed={listening}
              title={listening ? 'Stop dictation' : 'Dictate – tap, or hold to talk'}
              disabled={transcribing || busy} {...dictation.handlers}>
              <Icon name={transcribing ? 'circle-notch' : listening ? 'stop' : 'microphone'} size={18} />
            </button>
          )}
        </div>
        <button type="button" class="button primary feedback-send" disabled={busy || !canSubmit(draft)} onClick={() => void submit()}>
          {sendLabel(sending, busy)}
        </button>
      </div>
      {phone && message // the phone's narrow row has no room for it: a message takes the note's line while it stands
        ? <p class="feedback-message feedback-message-foot" role="alert" title={message}>{message}</p>
        : <FeedbackPrivacyNote sending={sending === true} />}
    </div>
  );
}
