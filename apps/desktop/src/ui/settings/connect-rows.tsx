// The rows that connect PCs, shared by Settings › Devices (DevicesGroup.tsx) and the first run's Connect card
// (onboarding/ConnectCard.tsx): this PC's Remote ID (Copy; the hint says whether the meeting server lets PCs in other
// networks find it), the PCs on this network (remote.nearby) with Connect, "Connect my other device" by Remote ID or
// address (B-078: my own devices carry no role – the same company on both; the wire role stays 'ceo'), or "Join a company"
// as an employee when the company menu asked for that (its one fixed line: this PC's request with the code, or why it
// failed), and a PC or my phone (B-078) asking here with its code (Accept – an employee's PC with the person it belongs
// to, a phone with whose phone it is: Me or one of the people (F1) – / Decline); plus
// the live-state hooks they read.
// F09: the PCs on this network grouped by PC – a PC with several companies is one label row with a row per company under
// it; the slot stays one fixed row while the network is asked or nobody answers (with Refresh), so the rows below never
// jump. F17: a request waiting on another of my PCs shows here too and names it (Accept is decided there). F13: the person
// picker offers "New person…" (a name in the same fixed cell; Accept makes the person as the device links), and
// IncomingRow takes `newPerson` – the person already named elsewhere (Team › Add person) – instead of the picker.
// Owns: these rows and hooks. Never: shows keys, or accepts without the person's click.

import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Person } from '../../shared/model/people.ts';
import type { RelayState } from '../../shared/model/relay.ts';
import type { JoinRole, NearbyPc, NewPerson, RemoteIncoming, RemoteState } from '../../shared/model/remote.ts';
import { people as everyone } from '../lib/people.ts';
import { errorText, rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { pushToast, toastError } from '../lib/toasts.ts';
import { Button } from '../lib/ui.tsx';
import { act, Row, useAsync, useBusy } from './controls.tsx';
import { connectLine, groupDigits, incomingText, nearbyGroups, nearbyHint, remoteIdHint, typedTarget } from './connect-text.ts';

/** A value kept current by an event (`on` returns its unsubscribe). */
export function useLive<T>(readable: boolean, load: () => Promise<T>, on?: (set: (next: T) => void) => () => void) {
  const state = useAsync(() => (readable ? load() : Promise.resolve(undefined)), [readable]);
  useEffect(() => (readable && on ? on((next) => state.set(next)) : undefined), [readable]);
  return state;
}

/** This PC's connect state (remote.state) and the meeting server's (remote.relay), both kept current. */
export function useConnectState() {
  const remote = useLive(can('remote.state'), () => rpc.call('remote.state'), (set) => rpc.on('remote.updated', set));
  const relay = useLive<RelayState>(can('remote.relay'), () => rpc.call('remote.relay'), (set) => rpc.on('relay.updated', set));
  return { remote, relay };
}

/** The people an employee's device can belong to (the owner and removed people left out; live – a new person shows at once). */
export function usePeople(): Person[] {
  return everyone.value.filter((person) => person.id !== 'human' && person.status !== 'revoked');
}

/** F13: the picker's value for "New person…" (person ids are 'per_…'). */
export const NEW_PERSON = 'new';

/** One of the people (`me`: a first option for no person); `newPerson` adds "New person…" (value NEW_PERSON). */
export function PersonSelect(props: { people: Person[]; value: string; onChange: (id: string) => void; label: string; me?: string; newPerson?: boolean }) {
  return (
    <select class="set-input remote-role" aria-label={props.label} value={props.value} onChange={(event) => props.onChange((event.currentTarget as HTMLSelectElement).value)}>
      {props.me !== undefined && <option value="">{props.me}</option>}
      {props.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      {props.newPerson && <option value={NEW_PERSON}>New person…</option>}
    </select>
  );
}

/** This PC's Remote ID with Copy; the hint: through the meeting server, or only on this network. */
export function RemoteIdRow(props: { remote?: RemoteState; relay?: RelayState }) {
  const id = props.remote?.self.remoteId;
  const copy = () => {
    if (id) navigator.clipboard.writeText(groupDigits(id)).then(() => pushToast({ title: 'Remote ID copied' }), (cause: unknown) => toastError(cause, 'Could not copy'));
  };
  return (
    <Row label="Remote ID" hint={remoteIdHint(props.relay, props.remote?.self.findable)} reserve>
      <span class="remote-id">{id ? groupDigits(id) : ''}</span>
      <button type="button" class="button ghost small" disabled={!id} onClick={copy}>Copy</button>
    </Row>
  );
}

/**
 * The PCs on this network that accept requests, each with Connect (as the chosen role) – F09: one group per PC, a PC with
 * several companies as a label row with one row per company. While asking, or when nobody answers, one fixed row with
 * Refresh holds the place.
 */
export function NearbyRows(props: { role: JoinRole; onError: (text: string | null) => void }) {
  const nearby = useAsync(() => (can('remote.nearby') ? rpc.call('remote.nearby', {}) : Promise.resolve<NearbyPc[]>([])), []);
  const [busy, run] = useBusy();
  const [asking, setAsking] = useState(false);
  const refresh = () => {
    setAsking(true);
    void rpc.call('remote.nearby', { refresh: true }).then(nearby.set, () => undefined).finally(() => setAsking(false));
  };
  const connect = (pc: NearbyPc) => void run(async () => {
    props.onError(null);
    try { await rpc.call('remote.connect', { target: pc.remoteId, role: props.role }); } catch (cause) { props.onError(errorText(cause)); }
  });
  const menu = () => [{ items: [{ label: 'Refresh list', onSelect: refresh }] }];
  const button = (pc: NearbyPc) => (
    <Button variant="ghost" class="small" disabled={busy || pc.state === 'waiting'} onClick={() => connect(pc)}>{pc.state === 'waiting' ? 'Waiting…' : 'Connect'}</Button>
  );
  const groups = nearbyGroups((nearby.data ?? []).filter((pc) => pc.state !== 'linked'));
  const looking = nearby.loading || asking;
  if (!groups.length) {
    return (
      <Row label="PCs on this network" hint={looking ? 'Looking…' : 'None accepts connection requests right now'} reserve>
        <Button variant="ghost" class="small" busy={looking} onClick={refresh}>Refresh</Button>
      </Row>
    );
  }
  return (
    <>
      {groups.map((group) => group.pcs.length === 1
        ? <Row key={group.key} label={group.name} hint={nearbyHint(group.pcs[0], false)} reserve menu={menu}>{button(group.pcs[0])}</Row>
        : (
          <Fragment key={group.key}>
            <Row label={group.name} hint="On this network" reserve menu={menu} />
            {group.pcs.map((pc) => (
              <Row key={`${pc.deviceId}:${pc.fingerprint}`} class="remote-company-row" label={pc.company ?? pc.name} hint={nearbyHint(pc, true)} reserve menu={menu}>{button(pc)}</Row>
            ))}
          </Fragment>
        ))}
    </>
  );
}

/**
 * "Connect my other device" (role 'ceo' on the wire: the same company on both, no role to pick) or, from the company
 * menu's "Join a company as employee", "Join a company": a Remote ID or address and the line with this PC's request
 * (its code, Cancel) or the last error.
 */
export function ConnectRow(props: { remote?: RemoteState; role: JoinRole; error: string | null; onError: (text: string | null) => void }) {
  const [target, setTarget] = useState('');
  const [busy, run] = useBusy();
  const line = connectLine(props.remote?.outgoing, props.error);
  const connect = () => void run(async () => {
    props.onError(null);
    try { await rpc.call('remote.connect', { target: target.trim(), role: props.role }); setTarget(''); } catch (cause) { props.onError(errorText(cause)); }
  });
  const end = () => void rpc.call('remote.cancel').catch((cause) => toastError(cause, 'Could not cancel'));
  return (
    <div class="set-row remote-connect-row">
      <div class="set-row-text">
        <div class="set-row-label">{props.role === 'employee' ? 'Join a company' : 'Connect my other device'}</div>
        <div class="set-row-hint remote-slot" role="status">
          <span class="remote-slot-line">
            <span class={`remote-slot-title${line.tone ? ` ${line.tone}` : ''}`} title={line.text}>{line.text}</span>
            {line.code && <span class="remote-slot-code" aria-label={`Code ${line.code.split('').join(' ')}`}>code {line.code}</span>}
            {line.action && <button type="button" class="text-button" onClick={end}>{line.action === 'cancel' ? 'Cancel' : 'Close'}</button>}
          </span>
        </div>
      </div>
      <div class="set-row-control">
        <div class="set-inline">
          <input class="set-input" aria-label="Remote ID or address of the other PC" placeholder="Remote ID or address" value={target} autoComplete="off"
            onInput={(event) => { setTarget(typedTarget((event.currentTarget as HTMLInputElement).value)); props.onError(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter' && target.trim()) connect(); }} />
          <Button variant="ghost" class="small" busy={busy} disabled={!target.trim() || props.remote?.outgoing?.status === 'waiting'} onClick={connect}>Connect</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * A PC or a phone asking here – or (F17, `via`) on another of my PCs, which then decides it: its code to compare, Accept /
 * Decline; `onDecided` after the answer went in. An employee's PC is accepted with its person; a phone (F1) with whose
 * phone it is – Me (full access) first, or one of the people, whose access it then gets; F13: "New person…" turns the
 * cell into a name field (Escape goes back), and Accept makes that person as the device links. `newPerson` (Team › Add
 * person) names the person already: no picker, and a request as my own PC cannot be accepted there. The hint (two fixed
 * lines) says what the device becomes; the cell is always there for a phone or an employee's PC, so nothing moves when
 * people load or another one is picked.
 */
export function IncomingRow(props: { request: RemoteIncoming; people: Person[]; newPerson?: NewPerson; onDecided?: (accepted: boolean) => void }) {
  const { request, newPerson: given } = props;
  const [picked, setPerson] = useState(''); // '' = Me for a phone, the first person (or a new one) for an employee's PC
  const [name, setName] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const [busy, run] = useBusy();
  const employee = request.role === 'employee';
  const phone = request.role === 'phone';
  const person = employee ? picked || props.people[0]?.id || NEW_PERSON : picked;
  const typing = !given && (employee || phone) && person === NEW_PERSON;
  useEffect(() => { if (typing && picked === NEW_PERSON) field.current?.focus(); }, [typing, picked]);
  const fresh: NewPerson | undefined = given ?? (typing && name.trim() ? { name: name.trim() } : undefined);
  const chosen = person && person !== NEW_PERSON ? props.people.find((entry) => entry.id === person)?.name : undefined;
  const owner = fresh?.name ?? (typing ? undefined : chosen);
  const mine = !employee && !phone; // my own PC: never a person's
  const blocked = mine && Boolean(given);
  const who = mine ? {} : fresh ? { newPerson: fresh } : !typing && person ? { personId: person } : {};
  const ready = !blocked && (mine || (given ? Boolean(given.name.trim()) : typing ? Boolean(fresh) : !employee || Boolean(person)));
  const answer = (accept: boolean) => void run(async () => {
    const done = await act(() => rpc.call('remote.decide', { id: request.id, accept, ...(accept ? who : {}) }), accept ? 'Could not accept' : 'Could not decline');
    if (done) props.onDecided?.(accept);
  });
  const words = incomingText(request);
  const becomes = phone
    ? owner ? `Becomes ${owner}'s phone with ${owner}'s access` : typing ? 'Becomes the new person’s phone with their access' : 'Becomes your own phone with full access'
    : employee ? owner ? `Becomes ${owner}'s PC` : 'Becomes the new person’s PC' : blocked ? `Asks to join as your own PC, not as ${given!.name}'s` : '';
  const hint = becomes ? `${becomes} · ${words.hint}` : words.hint;
  return (
    <Row label={<><span class="dot pairing" aria-hidden="true" /> {words.label}</>}
      hint={mine && !blocked ? hint : <span class="set-row-hint reserved two" title={hint}>{hint}</span>}>
      <span class="remote-slot-code" aria-label={`Code ${request.code.split('').join(' ')}`}>{request.code}</span>
      {typing && (
        <input ref={field} class="set-input remote-role" aria-label="Name of the new person" placeholder="Name" maxLength={80} value={name} autoComplete="off"
          onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && (phone || props.people.length)) { setPerson(''); setName(''); }
            if (event.key === 'Enter' && ready && !busy) answer(true);
          }} />
      )}
      {!typing && !given && employee && <PersonSelect people={props.people} value={person} onChange={setPerson} label="This PC belongs to" newPerson />}
      {!typing && !given && phone && <PersonSelect people={props.people} value={person} onChange={setPerson} label="This phone belongs to" me="Me" newPerson />}
      <Button variant="primary" class="small" disabled={busy || !ready} onClick={() => answer(true)}>Accept</Button>
      <Button variant="ghost" class="small" disabled={busy} onClick={() => answer(false)}>Decline</Button>
    </Row>
  );
}
