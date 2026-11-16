// Team › People › Edit (F-52): name, title, who they report to (nobody, the owner,
// another person or an agent – one org chart) and what they may do (whether they work with the agents,
// start chats, give tasks to agents) → people.save. Spaces stay system data (B-044 §1.12): "Works with
// your agents" sets every space or none; a list of single spaces set elsewhere stays until it is changed.
// F13: a new person is added on the Add person page (PersonNew.tsx), not here. A person whose access was removed keeps
// name, title and manager editable; what they may do comes back with "Invite again" (the runtime refuses
// scopes for them, so the dialog neither shows nor sends them).
// F13: the owner sets the role here too – a CEO works with everything, so their permissions show all checked and fixed
// (the same rows, nothing moves); making someone CEO puts them at the top unless the owner picks a manager again.
// Owns: this dialog. Never: adds, invites or removes people itself.

import { useEffect, useState } from 'preact/hooks';
import type { Person, PersonRole, PersonScopes } from '../../shared/model/people.ts';
import { CEO_SCOPES, DEFAULT_PERSON_SCOPES } from '../../shared/model/people.ts';
import { Button, Dialog, Select } from '../lib/ui.tsx';
import { rpc } from '../lib/rpc.ts';
import { isOwner } from '../lib/session.ts';
import { agents, settings } from '../lib/store.ts';
import { people, upsertPerson } from '../lib/people.ts';
import { toastError } from '../lib/toasts.ts';
import { withSelf } from '../lib/self-identity.ts';
import { managerOptions, ROLE_OPTIONS, roleHint } from './people-model.ts';

export function PersonDialog(props: { open: boolean; person?: Person; onClose: () => void }) {
  const current = props.person;
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [manager, setManager] = useState('');
  const [scopes, setScopes] = useState<PersonScopes>(DEFAULT_PERSON_SCOPES);
  const [role, setRole] = useState<PersonRole>('member');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setName(current?.name ?? '');
    setTitle(current?.title ?? '');
    setManager(current?.managerId ?? (current?.owner ? '' : 'human'));
    setScopes(current?.scopes ?? DEFAULT_PERSON_SCOPES);
    setRole(current?.role === 'ceo' ? 'ceo' : 'member');
  }, [props.open, current?.id]);

  const owner = current?.owner === true;
  const revoked = current?.status === 'revoked';
  const roles = isOwner() && !owner; // F13: the owner gives and takes the CEO role
  const ceo = role === 'ceo';
  const shown = ceo ? CEO_SCOPES : scopes;
  const canSave = !busy && (owner || name.trim().length > 0);
  const withAgents = shown.spaces === 'all' || shown.spaces.length > 0;
  const pickRole = (next: PersonRole) => {
    if (next === 'ceo' && role !== 'ceo') setManager(''); // a CEO sits at the top
    setRole(next);
  };

  const save = async () => {
    if (!canSave || !current) return;
    setBusy(true);
    try {
      const saved = await rpc.call('people.save', {
        id: current.id, ...(owner ? {} : { name: name.trim() }), title: title.trim(),
        ...(owner ? {} : { managerId: manager || null, ...(revoked || ceo ? {} : { scopes }) }),
        ...(roles && role !== (current.role === 'ceo' ? 'ceo' : 'member') ? { role } : {}),
      });
      upsertPerson(saved);
      props.onClose();
    } catch (error) {
      toastError(error, 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open && current !== undefined} onClose={props.onClose} title={owner ? 'You' : `Edit ${current?.name ?? ''}`} width={460} class="person-dialog">
      {!owner && (
        <>
          <label class="field-label" for="person-name">Name</label>
          <input id="person-name" class="input" type="text" value={name} maxLength={80} required autoFocus
            onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)} />
        </>
      )}
      <label class="field-label" for="person-title">Title</label>
      <input id="person-title" class="input" type="text" value={title} maxLength={80} placeholder="Optional"
        onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)}
        onKeyDown={(event) => { if (event.key === 'Enter') void save(); }} />
      {roles && (
        <>
          <label class="field-label" for="person-role">Role</label>
          <Select id="person-role" class="person-manager" label="Role" value={role} onChange={pickRole} options={ROLE_OPTIONS} />
          <small class="person-role-hint">{roleHint(role)}</small>
        </>
      )}
      {!owner && (
        <>
          <label class="field-label" for="person-manager">Reports to</label>
          <Select id="person-manager" class="person-manager" label="Reports to" value={manager} onChange={setManager}
            options={managerOptions(current?.id, withSelf(people.value, settings.value?.profile), agents.value)} />
          {!revoked && <fieldset class="person-scopes">
            <legend class="field-label">Permissions</legend>
            <label class="check-row">
              <input type="checkbox" checked={withAgents} disabled={ceo} onChange={(event) => setScopes({ ...scopes, spaces: (event.currentTarget as HTMLInputElement).checked ? 'all' : [] })} />
              <span>Works with your agents</span>
            </label>
            <label class="check-row">
              <input type="checkbox" checked={shown.startChats} disabled={ceo} onChange={(event) => setScopes({ ...scopes, startChats: (event.currentTarget as HTMLInputElement).checked })} />
              <span>Starts chats and groups</span>
            </label>
            <label class="check-row">
              <input type="checkbox" checked={shown.assignAgents} disabled={ceo} onChange={(event) => setScopes({ ...scopes, assignAgents: (event.currentTarget as HTMLInputElement).checked })} />
              <span>Gives tasks to agents</span>
            </label>
          </fieldset>}
        </>
      )}
      <div class="dialog-actions">
        <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={!canSave} onClick={() => void save()}>Save</Button>
      </div>
    </Dialog>
  );
}
