// Team › People › Invite (F-52): a new invite for one person (people.invite) – its QR code and link
// (one use, 72 hours; Copy) or, after "Show code", the 6-digit code to type on this PC's address
// (10 minutes). Their device then waits until you allow it in My day. When only this PC's own
// address exists the card says so in plain words (their phone connects through Add person / Settings › Devices instead).
// "Withdraw invite" ends it (people.closeInvite) – F14: for someone who never joined it removes them (people.remove),
// so a person stays in the team only once they joined. The invite is never shown again after closing.
// Owns: this dialog. Never: keeps the link or code after it closes.

import { useEffect, useState } from 'preact/hooks';
import { hasJoined, type Person, type PersonInvite as Invite } from '../../shared/model/people.ts';
import { Button, Dialog, Spinner } from '../lib/ui.tsx';
import { dropPerson } from '../lib/people.ts';
import { errorText, rpc } from '../lib/rpc.ts';
import { navigate, route } from '../lib/router.ts';
import { pushToast, toastError } from '../lib/toasts.ts';
import { groupCode } from './people-model.ts';

export function PersonInvite(props: { person: Person | null; onClose: () => void }) {
  const person = props.person;
  const [invite, setInvite] = useState<Invite | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    setInvite(null);
    setProblem(null);
    setShowCode(false);
    if (!person) return;
    let alive = true;
    rpc.call('people.invite', { id: person.id }).then((made) => { if (alive) setInvite(made); }, (error: unknown) => { if (alive) setProblem(errorText(error)); });
    return () => { alive = false; setInvite(null); };
  }, [person?.id]);

  const copy = () => {
    if (!invite) return;
    navigator.clipboard.writeText(invite.url).then(() => pushToast({ title: 'Link copied' }), (error: unknown) => toastError(error, 'Could not copy'));
  };
  const withdraw = async () => {
    if (!person) return;
    try {
      if (hasJoined(person)) await rpc.call('people.closeInvite', { id: person.id });
      else { // F14: never joined – they leave the team with the invite
        await rpc.call('people.remove', { id: person.id });
        dropPerson(person.id);
        const current = route.value;
        if (current.view === 'team' && current.personId === person.id) navigate({ view: 'team' }, { replace: true });
      }
      props.onClose();
    } catch (error) { toastError(error, 'Could not withdraw the invite'); }
  };

  return (
    <Dialog open={person !== null} onClose={props.onClose} title={person ? `Invite ${person.name}` : 'Invite'} width={440} class="person-invite">
      {problem && <p class="bridge-problem" role="alert">{problem}</p>}
      {!invite && !problem && <Spinner size={18} label="Making the invite" />}
      {invite && (
        <div class="remote-invite">
          {showCode ? (
            <div class="remote-invite-code">
              <span class="pair-code" aria-label={`Code ${invite.code.split('').join(' ')}`}>{groupCode(invite.code)}</span>
              <span class="muted">Open {invite.url.split('/#')[0].replace(/^https?:\/\//, '')} on their phone or computer, then choose Enter code. Valid for 10 minutes.</span>
            </div>
          ) : <img class="qr" src={invite.qrDataUrl} alt={`QR code to invite ${person?.name ?? 'this person'}`} width={160} height={160} />}
          <div class="set-stack">
            <button type="button" class="button ghost small" aria-pressed={showCode} onClick={() => setShowCode(!showCode)}>{showCode ? 'Show QR code' : 'Show code'}</button>
            <button type="button" class="button ghost small" onClick={copy}>Copy link</button>
          </div>
        </div>
      )}
      {invite && (
        <p class="muted person-invite-note">
          {invite.reachable
            ? 'The link opens once, for 72 hours, in a browser on this network. You allow their device in My day.'
            : 'This PC has no address on the network yet, so the link opens only on this PC. Their phone or PC connects with the code in Settings › Devices instead.'}
        </p>
      )}
      <div class="dialog-actions">
        {invite && <Button variant="ghost" onClick={() => void withdraw()}>Withdraw invite</Button>}
        <Button variant="primary" onClick={props.onClose}>Done</Button>
      </div>
    </Dialog>
  );
}
