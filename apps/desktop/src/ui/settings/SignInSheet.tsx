// B-091: the one sheet of a plan sign-in started from the phone (away-sign-in.ts). Codex: its one-time code, large, and
// one button "Copy code and sign in" (copies the code and opens the page in the same tap, so the phone's browser opens
// it). Claude Code: "Open sign-in" and the field for the code the page shows, with Done; a code that did not work shows
// in the footer's reserved message line. Mounted once by the model setup; the PC never opens it.
// Owns: this sheet's markup. Never: keeps or logs a code.

import { useState } from 'preact/hooks';
import { Dialog, DialogActions } from '../lib/dialog.tsx';
import { openExternal } from '../lib/platform.ts';
import { accounts } from '../lib/store.ts';
import { Button } from '../lib/ui.tsx';
import { awaySignIn, CODE_FAILED, submitCode } from './away-sign-in.ts';

export function SignInSheet() {
  const sheet = awaySignIn.value;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const label = sheet && accounts.value.find((account) => account.id === sheet.id)?.label;
  const close = () => { awaySignIn.value = null; setText(''); };
  const copyAndOpen = () => {
    if (!sheet?.code) return;
    void navigator.clipboard?.writeText(sheet.code).catch(() => undefined);
    openExternal(sheet.url);
  };
  const submit = async (event?: Event) => {
    event?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await submitCode(text.trim()); } finally { setBusy(false); setText(''); }
  };
  return (
    <Dialog open={!!sheet} onClose={close} title={label ? `Sign in to ${label}` : 'Sign in'} width={400} class="sign-in-sheet">
      {sheet?.code ? (
        <>
          <p class="sign-in-code">{sheet.code}</p>
          <p class="sign-in-hint">Device sign-in off? Turn it on once in ChatGPT › Settings › Security.</p>
          <DialogActions><Button variant="primary" class="small" onClick={copyAndOpen}>Copy code and sign in</Button></DialogActions>
        </>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <Button variant="secondary" class="sign-in-open" onClick={() => sheet && openExternal(sheet.url)}>Open sign-in</Button>
          <input class="input dialog-field" value={text} aria-label="Code from the page" placeholder="Code from the page" maxLength={4096}
            autoComplete="off" autoCapitalize="off" spellcheck={false} onInput={(event) => setText((event.currentTarget as HTMLInputElement).value)} />
          <DialogActions message={sheet?.failed ? CODE_FAILED : ''}>
            <Button variant="primary" class="small" busy={busy} disabled={!text.trim()} onClick={() => void submit()}>Done</Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
