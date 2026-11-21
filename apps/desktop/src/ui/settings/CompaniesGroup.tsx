// Settings › General › Companies (owner 16.11.2026: "die Firmen nur wie Konten ... in den Einstellungen ... austreten ...
// einfach löschen, mit dann noch mehrmals Abfrage und vielleicht auch früher exportieren, kann man sie einfach irgendwo
// importieren wieder"): one fixed row per company on this PC – its name, under it its folder ("first", "company-2": two
// of the same name stay apart), "this one" or whether it runs, the role and the linked PCs – with Export… and Leave or
// Delete. Export… writes it into a chosen folder (companies.export: a backup plus its secrets readable, which
// companies.import opens elsewhere); Import… in the head makes such a folder a new company here (also the profile
// menu's "+"). Leave – a company shared with linked PCs or joined as an employee: this PC stops showing it, the others
// keep it – asks once. Delete asks twice: what goes, with "Export first…", then the company's name typed. Both are
// companies.remove: its folder goes to the recycle bin once it has stopped, and the one open here hands over to the next.
// The only company on this PC has neither. Desktop window only; the group sits last, so nothing below it moves when it
// arrives.
// Owns: these rows, the import pick and the two confirmations. Never: removes, exports or imports anything itself (the
// runtime and main do).

import { useEffect, useState } from 'preact/hooks';
import type { CompanyEntry } from '../../shared/model/companies.ts';
import { confirm, Dialog, DialogActions } from '../lib/dialog.tsx';
import { bridge, platform } from '../lib/platform.ts';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { pushToast } from '../lib/toasts.ts';
import { Button } from '../lib/ui.tsx';
import { act, Group, Row } from './controls.tsx';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The others keep it – an employee's company or one with linked PCs: Leave, else Delete. */
export const leaves = (entry: CompanyEntry): boolean => entry.role === 'employee' || (entry.linkedPcs?.length ?? 0) > 0;

/** The line under the name: the folder, "this one" or whether it runs, the role and the linked PCs. */
export function companyLine(entry: CompanyEntry): string {
  const pcs = entry.linkedPcs?.length ?? 0;
  const state = entry.current ? 'this one' : entry.running === false ? 'not running' : '';
  return [entry.folder, state, entry.role === 'employee' ? 'employee' : '', pcs ? plural(pcs, 'linked PC') : ''].filter(Boolean).join(' · ');
}

/** "+" › Import a company and the group's Import…: a picked export (or backup folder) becomes a new company here; its window opens. */
export async function importCompany(): Promise<void> {
  const pick = bridge?.files.pickFolder;
  const path = pick && await act(() => pick('restore'), 'Could not choose a folder');
  if (path) await act(() => rpc.call('companies.import', { path }), 'Could not import the company');
}

/** Export… : the company into a new folder inside a picked one. */
async function exportCompany(entry: CompanyEntry): Promise<void> {
  const pick = bridge?.files.pickFolder;
  const dir = pick && await act(() => pick('backup'), 'Could not choose a folder');
  if (!dir) return;
  const done = await act(() => rpc.call('companies.export', { id: entry.id, dir }), 'Could not export the company');
  if (done) {
    pushToast({
      title: `${entry.label} exported`, body: `${done.path} – secrets.csv holds ${plural(done.secrets, 'secret')} readable: keep the folder private`,
      action: { label: 'Show', run: () => void act(() => rpc.call('files.openPath', { path: done.path }), 'Could not open it') },
    }, 12_000);
  }
}

async function removeCompany(entry: CompanyEntry): Promise<boolean> {
  const done = await act(() => rpc.call('companies.remove', { id: entry.id }), 'Could not remove the company');
  if (done) pushToast({ title: `${entry.label} is being removed`, body: 'Its folder goes to the recycle bin once it has stopped.' });
  return !!done;
}

const handOver = (entry: CompanyEntry) => (entry.current ? ' This window closes and another company opens.' : '');

/** Delete's two questions: what goes (with Export first…), then the name typed. */
function DeleteDialog(props: { entry: CompanyEntry | null; onClose: () => void; onDone: () => void }) {
  const { entry } = props;
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStep(1); setTyped(''); setBusy(false); }, [entry]);
  const named = !!entry && typed.trim().toLowerCase() === entry.label.trim().toLowerCase();
  const run = async (work: () => Promise<unknown>) => { setBusy(true); try { await work(); } finally { setBusy(false); } };
  const remove = () => run(async () => { if (entry && named && await removeCompany(entry)) props.onDone(); });
  return (
    <Dialog open={!!entry} onClose={props.onClose} title={entry ? `Delete ${entry.label}?` : undefined} width={440}>
      {entry && step === 1 && (
        <>
          <p class="dialog-text">
            {`Its agents, chats, tasks, files and settings on this PC go to the recycle bin${entry.id === null ? '; its workspace folder in your user folder stays' : ''}. `}
            {`Export it first to open it again in Autark elsewhere.${handOver(entry)}`}
          </p>
          <DialogActions>
            <button type="button" class="button secondary" onClick={props.onClose}>Cancel</button>
            <Button variant="secondary" busy={busy} onClick={() => void run(() => exportCompany(entry))}>Export first…</Button>
            <button type="button" class="button danger-fill" disabled={busy} onClick={() => setStep(2)}>Continue</button>
          </DialogActions>
        </>
      )}
      {entry && step === 2 && (
        <form onSubmit={(event) => { event.preventDefault(); void remove(); }}>
          <p class="dialog-text">{`Second question: type the company's name. Only the recycle bin brings ${entry.label} back.`}</p>
          <input class="input dialog-field" value={typed} aria-label="Company name" placeholder={entry.label} maxLength={120} autoFocus
            onInput={(event) => setTyped((event.currentTarget as HTMLInputElement).value)} />
          <DialogActions>
            <button type="button" class="button secondary" onClick={props.onClose}>Cancel</button>
            <Button variant="danger" class="danger-fill" busy={busy} disabled={!named} onClick={() => void remove()}>Delete</Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}

export function CompaniesGroup() {
  const [list, setList] = useState<CompanyEntry[]>([]);
  const [deleting, setDeleting] = useState<CompanyEntry | null>(null);
  const shown = platform === 'desktop' && can('companies.list');
  const load = () => rpc.call('companies.list', { facts: true }).then((result) => setList(result.companies), () => { /* the last list stays */ });
  useEffect(() => {
    if (!shown) return;
    void load();
    return rpc.onOpen(() => { void load(); });
  }, [shown]);
  if (!shown || !list.length) return null;
  const only = list.length === 1;
  const remove = async (entry: CompanyEntry) => {
    if (!leaves(entry)) { setDeleting(entry); return; }
    const others = entry.role === 'employee' ? 'The firm keeps it' : 'Your linked PCs keep it';
    if (!(await confirm({ title: `Leave ${entry.label}?`, body: `This PC stops showing it, and its folder here goes to the recycle bin. ${others}.${handOver(entry)}`, confirmLabel: 'Leave', danger: true }))) return;
    if (await removeCompany(entry)) void load();
  };
  return (
    <Group title="Companies" id="settings-companies" actions={bridge?.files.pickFolder && <Button variant="ghost" class="small" onClick={() => void importCompany()}>Import…</Button>}>
      {list.map((entry) => (
        <Row key={entry.folder} label={entry.label} hint={only ? `${companyLine(entry)} · the only company on this PC` : companyLine(entry)} reserve>
          {bridge?.files.pickFolder && <Button variant="ghost" class="small" onClick={() => void exportCompany(entry)} disabled={!entry.current && entry.running === false}>Export…</Button>}
          <Button variant="ghost" class="small" disabled={only} onClick={() => void remove(entry)}>{leaves(entry) ? 'Leave' : 'Delete'}</Button>
        </Row>
      ))}
      <DeleteDialog entry={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); void load(); }} />
    </Group>
  );
}
