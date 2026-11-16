// Root component: the shell, plus the few states the browser/phone build needs before the
// shell can load – a failed pairing, an unpaired device (DEV5B: "Ask this PC for access",
// pwa/AccessRequest.tsx), and the last known "For you" list (read-only; kept current by
// pwa/install.ts, from IndexedDB after a start without the PC; what is due now, then a collapsed
// "Later (n)" split when shown – F04) while the PC is unreachable – and, at any time, the PC
// refusing this phone (4401: this device is no longer paired; 4403: the phone was removed – it may ask again:
// F-52: a page opened from a person's invite (#join=) shows the join screen (pwa/JoinRequest.tsx);
// rpc.refused). Feedback 16.11.2026 F15: inside the Android app a refusal first goes to the app, which tries the
// company's next PC (pwa/native.ts reportRefusals), Pair again pairs over this company instead of forgetting it, and the
// offline sub line says that the phone keeps trying (and which PC, when the app names it).
// Owns: the pre-load fallbacks and the top-level error boundary. Never: data loading itself
// (main.tsx starts it) or any write to the PC while offline (feedback written there waits in the page's outbox).

import { useEffect, useState } from 'preact/hooks';
import type { TaskView } from '../shared/model/tasks.ts';
import { Boundary } from './blocks/Boundary.tsx';
import { fullDate, listTime, relative } from './lib/format.ts';
import { platform } from './lib/platform.ts';
import { rpc } from './lib/rpc.ts';
import { loaded } from './lib/store.ts';
import { Icon, Spinner } from './lib/ui.tsx';
import { Header } from './lib/header.tsx';
import { ContextMenuHost } from './lib/context-menu.tsx';
import { feedbackCell } from './feedback/cell.tsx';
import { FeedbackMenu } from './feedback/FeedbackMenu.tsx';
import { AccessRequest } from './pwa/AccessRequest.tsx';
import { JoinRequest } from './pwa/JoinRequest.tsx';
import { joining } from './pwa/join.ts';
import { forgetThisPhone, isAndroidApp, isPhoneApp, pairAgain, reportRefusals } from './pwa/native.ts';
import { phoneCompanies, phoneStatus, showPcs } from './pwa/phone-companies.ts';
import { hasDeviceToken, offlineSnapshot, pairingError } from './pwa/install.ts';
import type { TodoSnapshot } from './pwa/install.ts';
import { Shell } from './shell/Shell.tsx';
import { RepairScreen } from './repair/RepairScreen.tsx';
import { repairState } from './repair/repair-state.ts';
import { laterText, splitLater } from './tasks/todo-time.ts';

/** Last My day list this page knew (pwa/install.ts keeps it current; re-exported for main.tsx). */
export { offlineSnapshot };

function hashToken(): boolean {
  return /(?:^#|&)token=/.test(location.hash);
}

function BootNote(props: { text: string; detail?: string; repair?: boolean }) {
  return (
    <div class="boot boot-note" role="alert">
      <p>{props.text}</p>
      {props.detail && <p class="muted">{props.detail}</p>}
      {rpc.status.value === 'connecting' && <Spinner size={16} />}
      {props.repair && isAndroidApp() && <button type="button" class="button secondary" onClick={() => showPcs()}>Choose PC</button>}
      {props.repair && isPhoneApp() && <button type="button" class="button" onClick={pairAgain}>Pair again</button>}
    </div>
  );
}

/** The offline view's fixed sub line: why it is read-only, the PC the phone keeps trying (when the app names it), the list's age. */
function offlineLine(accessOff: boolean | undefined, at: number): string {
  if (accessOff) return `Not paired · ${relative(at)}`;
  const pc = phoneStatus.value?.pc ?? phoneCompanies.value.find((company) => company.current)?.pc;
  return `Offline · trying ${pc ? `${pc} ` : ''}again · ${relative(at)}`;
}

/** One read-only row; `when` replaces the due time for a "Later" row ("Snoozed until …", the ring time). */
function OfflineRow(props: { task: TaskView; when?: string }) {
  const { task } = props;
  return (
    <li class="offline-row">
      <Icon name="check-circle" size={18} />
      <div class="offline-row-text">
        <span class="offline-row-title">{task.title}</span>
        <span class="offline-row-meta">
          {task.conversationTitle}
          {props.when ? ` · ${props.when}` : task.dueAt ? <time class="tabular" dateTime={new Date(task.dueAt).toISOString()} title={fullDate(task.dueAt)}> · {listTime(task.dueAt)}</time> : null}
        </span>
      </div>
    </li>
  );
}

/**
 * Read-only copy of the last known list; answering needs the connection (or pairing this device again).
 * The snapshot keeps every to-do, so the split into due now and "Later" follows the time it is shown.
 * Its top row (lib/header.tsx) names the list and, in the fixed sub line, why it is read-only; its one cell is
 * feedback (feedback 16.11.2026, F22: the cell was missing here) – a report waits in this page's outbox
 * (feedback/outbox.ts) until the PC is reachable, so the cell is there whatever the PC allowed last.
 */
function OfflineTodos(props: { snapshot: TodoSnapshot; accessOff?: boolean }) {
  const { snapshot } = props;
  const [laterOpen, setLaterOpen] = useState(false);
  const now = Date.now();
  const split = splitLater(snapshot.items, now);
  return (
    <div class="offline-view">
      <Header class="offline-header" title="My day" twoLine cells={[feedbackCell(true)]}
        sub={<span class="offline-badge" role="status">{offlineLine(props.accessOff, snapshot.at)}</span>} />
      <FeedbackMenu />
      {props.accessOff && <p class="offline-note">{accessOffDetail()}</p>}
      <div class="offline-body">
        {split.now.length
          ? <ul class="offline-list">{split.now.map((task) => <OfflineRow key={task.id} task={task} />)}</ul>
          : <p class="empty-state offline-empty">Nothing needs you right now.</p>}
        {split.later.length > 0 && (
          <div class="offline-later">
            <button type="button" class="offline-later-toggle" aria-expanded={laterOpen} aria-controls="offline-later" onClick={() => setLaterOpen(!laterOpen)}>
              <Icon name={laterOpen ? 'caret-down' : 'caret-right'} size={14} />
              <span class="tabular">Later ({split.later.length})</span>
            </button>
            {laterOpen && (
              <ul class="offline-list" id="offline-later" aria-label="Later">
                {split.later.map((task) => <OfflineRow key={task.id} task={task} when={laterText(task, now)} />)}
              </ul>
            )}
          </div>
        )}
      </div>
      {isPhoneApp() && ( // 10.11.2026: the Android app showed "Not paired" with no way back (the row was iPhone-only)
        <div class="offline-actions">
          {isAndroidApp() && <button type="button" class="button secondary" onClick={() => showPcs()}>Choose PC</button>}
          <button type="button" class={props.accessOff ? 'button' : 'button secondary'} onClick={props.accessOff ? pairAgain : forgetThisPhone}>{props.accessOff ? 'Pair again' : 'Forget this phone'}</button>
        </div>
      )}
    </div>
  );
}

/**
 * Set once the first connection attempt failed. The client retries with backoff and flips
 * between 'connecting' and 'closed' on every attempt; keying the fallbacks on this flag (not
 * on the momentary status) keeps them on screen instead of flickering with each retry.
 */
let unreachable = false;

// 10.11.2026: the Android app keeps every PC of the company – another one may still accept it, so Choose PC comes before
// Pair again. 16.11.2026 (F15): the app has already tried the company's other online PCs (pwa/native.ts reportRefusals).
const accessOffDetail = (): string => `This PC no longer accepts this phone. ${isAndroidApp() ? 'Choose another PC, or tap' : 'Tap'} Pair again, enter the PC's Remote ID, then accept on the PC.`;

function Root() {
  // 23.10.: the runtime runs in repair mode (broken upgrade, crash loop) – the repair screen replaces the app.
  const repair = repairState.value;
  if (repair?.active) return <RepairScreen state={repair} />;
  // The runtime refusing this phone (rpc.refused) replaces even a loaded shell: nothing in it
  // would work any more.
  const refused = platform === 'desktop' ? null : rpc.refused.value;
  if (platform === 'pwa' && joining.value) return <JoinRequest />; // F-52: a person joining an organisation from an invite
  if (platform !== 'desktop' && (!loaded.value || refused)) {
    const status = rpc.status.value;
    if (status === 'closed') unreachable = true;
    const away = (unreachable && status !== 'open') || refused !== null;
    if (pairingError.value) return <BootNote text="Pairing failed." detail={pairingError.value} />;
    if (away && platform === 'pwa' && !hasDeviceToken() && !hashToken()) return <AccessRequest />;
    if (refused === 4403) return <AccessRequest removed />;
    if (away && offlineSnapshot.value) return <OfflineTodos snapshot={offlineSnapshot.value} accessOff={refused === 4401} />;
    if (refused === 4401) return <BootNote text="This device is no longer paired." detail={accessOffDetail()} repair />;
  }
  return <Shell />;
}

export function App() {
  useEffect(() => reportRefusals(rpc), []); // the Android app tries the company's next PC on a refusal (F15)
  return (
    <Boundary fallback={(reset) => (
      <div class="boot boot-note" role="alert">
        <p>Something went wrong.</p>
        <button type="button" class="button secondary" onClick={reset}>Reload view</button>
      </div>
    )}>
      <Root />
      <ContextMenuHost />
    </Boundary>
  );
}
