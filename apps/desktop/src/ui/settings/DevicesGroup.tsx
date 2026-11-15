// Settings › Devices – the one connect surface, the same on the PC and – B-084 (D6) – on my phone (its secure tunnel
// reaches remote.* / devices.* / phone.pairLink / people.invite; every row is gated by can(), never by the platform),
// three groups with few rows:
// "This phone" (a phone or a person's browser only): this browser's install (not inside a phone app), notifications
// (pwa.pushConfig / pwa.pushSubscribe – a person has their own variants; inside the Android app one line that the app
// shows them itself), inside the iPhone web app the honest line that iOS lets no app use other apps, and inside a phone
// app "Forget this phone" (native.ts forgetThisPhone – the app asks first).
// "Add a device": a PC or a phone asking here with its code (Accept / Decline) first; the PC's Remote ID (Copy);
// "Connect a phone" with its QR code in a fixed box – for me (B-078, D5: the QR carries only the PC's Remote ID as the
// pair link, phone.pairLink; the Android app scans or types it, both screens show the same code) or for an employee
// (that person's invite: people.invite, its 6-digit code in the hint – a person-scoped join, whoever opened it); the PCs
// on the PC's network with Connect; "Connect my other device" by Remote ID or address – B-078: my own devices carry no
// role; joining a company as an employee lives in the company menu's "+" (those rows are connect-rows.tsx, shared with
// the first run's Connect card).
// "Devices": one row per device with a right-click / long-press menu (Rename, Remove); on touch a visible Remove in the
// row's fixed slot. Under it the connection rows (devices-connection.tsx), on the PC and my phone alike.
// Owns: the groups, the phone and device rows. Never: shows keys or a link's secret as text (the 6-digit codes are meant to be typed).

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Device } from '../../shared/model/devices.ts';
import type { Person } from '../../shared/model/people.ts';
import type { RelayState } from '../../shared/model/relay.ts';
import type { RemoteState } from '../../shared/model/remote.ts';
import { confirm } from '../lib/dialog.tsx';
import { listTime } from '../lib/format.ts';
import { isPersonSession } from '../lib/people.ts';
import { isMobile, platform } from '../lib/platform.ts';
import { errorText, rpc } from '../lib/rpc.ts';
import { can, holds } from '../lib/session.ts';
import { pushToast } from '../lib/toasts.ts';
import { groupCode } from '../team/people-model.ts';
import { disablePush, enablePush, installAvailable, isStandalone, promptInstall, pushStatus } from '../pwa/install.ts';
import { act, Group, Row, Toggle, useAsync, useBusy } from './controls.tsx';
import { forgetThisPhone, inHostedApp, isAndroidApp, isPhoneApp } from '../pwa/native.ts';
import { IOS_PHONE_USE } from '../pwa/hosted.ts';
import { deviceHint, FORGET_HINT, groupDigits, phoneDot, phoneQrHint, pushHint } from './connect-text.ts';
import { ConnectRow, IncomingRow, NearbyRows, PersonSelect, RemoteIdRow, useConnectState, usePeople } from './connect-rows.tsx';
import { ConnectionGroup } from './devices-connection.tsx';

function useDevices() {
  const list = useAsync(() => (can('devices.list') ? rpc.call('devices.list') : Promise.resolve<Device[]>([])), []);
  useEffect(() => {
    const offUp = rpc.on('device.upserted', (device) => {
      const current = list.data ?? [];
      list.set(current.some((entry) => entry.id === device.id) ? current.map((entry) => (entry.id === device.id ? device : entry)) : [...current, device]);
    });
    const offRemoved = rpc.on('device.removed', ({ id }) => list.set((list.data ?? []).filter((entry) => entry.id !== id)));
    return () => { offUp(); offRemoved(); };
  }, [list.data]);
  return list;
}

// ------------------------------------------------------------------ phones

/** `code`: the 6 digits an employee types under "I was invited"; for me the QR carries only this PC's Remote ID. */
type Qr = { qrDataUrl: string; expiresAt?: number; code?: string };
/** As a person's invite says it with `reachable: false`. */
const UNREACHABLE = 'Phones can’t reach this PC yet – ask the AI to open it to the same network or to set up Tailscale (skill phone-access).';

/**
 * "Connect a phone": for me the QR of this PC's pair link (phone.pairLink – only the Remote ID; the Remote ID itself
 * first in the hint, so typing works as well), for an employee their invite with its 6-digit code, renewed at expiry.
 */
function PhoneQr(props: { remote?: RemoteState; people: Person[] }) {
  const [person, setPerson] = useState('');
  const [qr, setQr] = useState<Qr | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const seq = useRef(0);
  const issue = async () => {
    const mine = ++seq.current;
    try {
      const next: Qr | null = person
        ? await rpc.call('people.invite', { id: person }).then((invite) => {
          if (!invite.reachable) throw new Error(UNREACHABLE);
          return { qrDataUrl: invite.qrDataUrl, expiresAt: invite.codeExpiresAt, code: invite.code };
        })
        : can('phone.pairLink') ? await rpc.call('phone.pairLink').then((link) => ({ qrDataUrl: link.qrDataUrl })) : null;
      if (mine === seq.current) { setQr(next); setError(undefined); }
    } catch (cause) {
      if (mine === seq.current) { setQr(null); setError(errorText(cause)); }
    }
  };
  useEffect(() => { void issue(); }, [person, props.remote?.self.remoteId]);
  useEffect(() => {
    if (!qr?.expiresAt) return undefined;
    const timer = setTimeout(() => void issue(), Math.max(0, qr.expiresAt - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [qr]);
  const remoteId = props.remote?.self.remoteId;
  const text = error ?? phoneQrHint(Boolean(person));
  const digits = !error ? (person ? qr?.code ?? '' : remoteId ?? '') : '';
  const code = digits && <><span class="remote-slot-code" aria-label={`${person ? 'Code' : 'Remote ID'} ${digits.split('').join(' ')}`}>{person ? groupCode(digits) : groupDigits(digits)}</span> · </>;
  const hint = <span title={digits ? `${digits} · ${text}` : text}>{code}{text}</span>;
  return (
    <Row class="remote-phone-row" label="Connect a phone" hint={hint}>
      {props.people.length > 0 && <PersonSelect people={props.people} value={person} onChange={setPerson} label="Phone for" me="For me" />}
      <div class={`remote-qr${qr || error || !remoteId ? '' : ' loading'}`} aria-busy={(!qr && !error) || undefined}>
        {qr && <img class="remote-qr-code" src={qr.qrDataUrl} alt="QR code to connect a phone" width={96} height={96} />}
      </div>
    </Row>
  );
}

// ------------------------------------------------------------------ the device list

function DeviceRow(props: { device: Device; people: Person[] }) {
  const { device } = props;
  const [renaming, setRenaming] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (renaming) field.current?.select(); }, [renaming]);
  const finish = (name: string) => {
    setRenaming(false);
    if (name.trim() && name.trim() !== device.name) void act(() => rpc.call('devices.rename', { id: device.id, name: name.trim() }), 'Could not rename');
  };
  const remove = async () => {
    const body = device.kind === 'pc' ? 'The two PCs stop connecting; connecting again needs a new request.' : 'It signs out on all your PCs; connecting again needs a new request from it.';
    if (await confirm({ title: `Remove ${device.name}?`, body, confirmLabel: 'Remove', danger: true })) await act(() => rpc.call('devices.revoke', { id: device.id }), 'Could not remove');
  };
  const dot = device.kind === 'pc' ? device.status : phoneDot(device);
  const personName = (id: string) => props.people.find((person) => person.id === id)?.name;
  const removable = !device.self && can('devices.revoke');
  const label = renaming
    ? <input ref={field} class="set-input" aria-label="Device name" maxLength={60} defaultValue={device.name}
      onBlur={(event) => finish(event.currentTarget.value)}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = device.name; event.currentTarget.blur(); } }} />
    : <><span class={`dot ${dot}`} aria-hidden="true" /> {device.name}</>;
  // B-084: on touch Remove is a visible button – always there on a removable row, so nothing shifts; Rename stays in the long-press menu
  return (
    <Row class="device-row" label={label} hint={deviceHint(device, personName, listTime)} reserve
      menu={() => [{ items: [
        ...(can('devices.rename') ? [{ label: 'Rename', onSelect: () => setRenaming(true) }] : []),
        ...(removable ? [{ label: 'Remove', danger: true, onSelect: () => void remove() }] : []),
      ] }]}>
      {isMobile.value && removable ? <button type="button" class="button ghost small danger" onClick={() => void remove()}>Remove</button> : undefined}
    </Row>
  );
}

// ------------------------------------------------------------------ on a phone

/** This browser's install and notifications ("On" = the PC holds its subscription), Forget inside a phone app. */
function BrowserRows() {
  const [busy, run] = useBusy();
  const androidApp = isAndroidApp(); // the app shows notifications itself: no web push switch there
  const status = useAsync(() => (androidApp ? Promise.resolve(undefined) : pushStatus()), []);
  const change = (on: boolean) => void run(async () => {
    const result = await (on ? enablePush() : disablePush());
    pushToast({ title: result.message, tone: result.ok ? 'info' : 'error' });
    status.set(await pushStatus().catch(() => 'off' as const));
  });
  const current = status.data;
  const iosTab = (inHostedApp() || /iPhone|iPad|iPod/.test(navigator.userAgent)) && !isStandalone();
  const hint = pushHint(current, { person: isPersonSession(), chat: holds('chat'), iosTab, androidApp });
  return (
    <Group title={isMobile.value || isPhoneApp() ? 'This phone' : 'This browser'} id="settings-this-phone">
      {!isStandalone() && !isPhoneApp() && (
        <Row label="Install app" hint={installAvailable.value ? undefined : 'Use “Add to Home Screen” in the browser menu'}>
          {installAvailable.value && <button type="button" class="button ghost small" onClick={() => void promptInstall()}>Install</button>}
        </Row>
      )}
      <Row label="Notifications" hint={status.error ?? hint}>
        {current === 'on' && <Toggle label="Notifications" checked disabled={busy} onChange={() => change(false)} />}
        {(current === 'off' || current === 'blocked') && <button type="button" class="button ghost small" disabled={busy} onClick={() => change(true)}>Turn on</button>}
      </Row>
      {inHostedApp() && <Row label="Phone use" hint={IOS_PHONE_USE} />}
      {isPhoneApp() && (
        <Row label="Forget this phone" hint={FORGET_HINT}>
          <button type="button" class="button ghost small danger" onClick={forgetThisPhone}>Forget</button>
        </Row>
      )}
    </Group>
  );
}

/** "Add a device": requests waiting here first, then the PC's Remote ID, the phone QR, PCs nearby and Connect by ID. */
function AddRows(props: { people: Person[]; remote?: RemoteState; relay?: RelayState }) {
  const [error, setError] = useState<string | null>(null);
  const incoming = props.remote?.incoming ?? [];
  if (!incoming.length && !can('remote.state') && !can('remote.nearby') && !can('remote.connect')) return null;
  return (
    <Group title="Add a device" id="settings-add-device">
      {incoming.map((request) => <IncomingRow key={request.id} request={request} people={props.people} />)}
      {can('remote.state') && <RemoteIdRow remote={props.remote} relay={props.relay} />}
      {can('remote.state') && <PhoneQr remote={props.remote} people={props.people} />}
      {can('remote.nearby') && <NearbyRows role="ceo" onError={setError} />}
      {can('remote.connect') && <ConnectRow remote={props.remote} role="ceo" error={error} onError={setError} />}
    </Group>
  );
}

// ------------------------------------------------------------------ the group

export function DevicesGroup() {
  const devices = useDevices();
  const people = usePeople();
  const { remote, relay } = useConnectState();
  const list = (devices.data ?? []).filter((device) => device.status !== 'revoked' && device.status !== 'pairing')
    .sort((a, b) => Number(b.self) - Number(a.self) || Number(b.kind === 'pc') - Number(a.kind === 'pc') || a.name.localeCompare(b.name));
  return (
    <>
      {platform !== 'desktop' && <BrowserRows />}
      <AddRows people={people} remote={remote.data} relay={relay.data} />
      {can('devices.list') && (
        <Group title="Devices" id="settings-devices" hint={devices.error ?? undefined}>
          {list.map((device) => <DeviceRow key={device.id} device={device} people={people} />)}
        </Group>
      )}
      {/* my phone too: a secure 'settings' device writes the 'devices' section (handlers/system.ts) – remote.relay needs that transport */}
      {can('settings.update') && can('remote.relay') && <ConnectionGroup relay={relay.data} findable={remote.data?.self.findable} />}
    </>
  );
}
