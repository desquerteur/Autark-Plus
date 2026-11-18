// Settings › Devices › Connection › "Your own meeting server" (18.11.2026, owner: "eigenen Server zum Treffen …
// einrichten … wenn man da Software braucht, soll man sie im Dashboard bekommen"): a dialog with the two ways to run the
// meeting server that ships with this app – this PC with the app's own program (the line to copy and the file to show),
// or a container built from the public source – and where its address goes. Nothing runs from here; the person (or the
// AI) starts it, then types its address into the Meeting server row.
// Owns: this dialog. Never: starts a process or changes settings.

import { useState } from 'preact/hooks';
import type { RelayState } from '../../shared/model/relay.ts';
import { openPath } from '../blocks/host.ts';
import { Dialog, DialogActions } from '../lib/dialog.tsx';
import { pushToast, toastError } from '../lib/toasts.ts';
import { Button } from '../lib/ui.tsx';
import { OWN_SERVER_DOCKER, ownServerCommand } from './connect-text.ts';
import { ActionButton } from './controls.tsx';

function Command(props: { text: string }) {
  const copy = () => navigator.clipboard.writeText(props.text).then(() => pushToast({ title: 'Copied' }), (cause: unknown) => toastError(cause, 'Could not copy'));
  return (
    <div class="own-server-command">
      <code>{props.text}</code>
      <ActionButton label="Copy" variant="ghost" onClick={() => void copy()} />
    </div>
  );
}

export function OwnServerButton(props: { relay?: RelayState }) {
  const [open, setOpen] = useState(false);
  const meet = props.relay?.meet;
  return (
    <>
      <ActionButton label="Set up" onClick={() => setOpen(true)} />
      <Dialog open={open} onClose={() => setOpen(false)} title="Your own meeting server" width={560} class="own-server">
        <p>The meeting server only passes addresses between your devices, and their encrypted traffic when no direct path works. Run it yourself and nothing of it goes through ours.</p>
        <h4>On a PC or server you run</h4>
        {meet
          ? <>
            <p>The server ships with Autark. This line starts it on this PC, on port 8787:</p>
            <Command text={ownServerCommand(meet)} />
            <p class="own-server-file">File: {meet.file} <a href="#" onClick={(event) => { event.preventDefault(); void openPath(meet.file, true).catch((cause: unknown) => toastError(cause, 'Could not show the file')); }}>Show</a></p>
          </>
          : <p>Install Autark on that machine; the server ships with it as <code>meet.mjs</code>.</p>}
        <h4>Or as a container</h4>
        <Command text={OWN_SERVER_DOCKER} />
        <h4>Then</h4>
        <p>On your own network, enter <code>ws://</code> and the PC’s address with port 8787 as the meeting server on every device. Over the internet, put a TLS proxy such as Caddy in front of it and enter its <code>wss://</code> address. A phone keeps the server it was paired over: pair it again after the change.</p>
        <DialogActions><Button variant="primary" class="small" onClick={() => setOpen(false)}>Done</Button></DialogActions>
      </Dialog>
    </>
  );
}
