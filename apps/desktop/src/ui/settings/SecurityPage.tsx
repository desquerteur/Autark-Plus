// Settings › Security (owner 16.11.2026: "ein Sicherheits Tab … Einstellungen wie für Vollzugriff und weniger … global
// für alle Agents … Ich bin kein Roboter … den Text überschreiben jeder Agent gleich"): two fixed groups, both views on
// settings.json. (1) Access – settings.profile.pcAccess, Full access | Careful, the chosen level's one sentence in the
// row's reserved hint; a change goes to the Manager as the person's line first and then into the setting
// (onboarding/pc-access.ts setPcAccess), because it is an agreement each agent keeps in its own SYSTEM.md, never a lock.
// (2) For every agent – settings.profile.forEveryAgent in one fixed field, saved on leaving it: the last part of every
// agent's instructions, after its own HUMAN.md (context/prompt-stable.ts); it starts with the "I'm not a robot" line, and
// the agents change it like any setting. A session that may not change the company's settings sees both read-only.
// (3) Changes – the last few changes of these two settings with who, when and old → new (runtime/settings/security-log.ts,
// settings.securityLog); the agents may change them, so every change is written down here: who (an agent links to its
// page) on the left, the time once on the right; a change of the text opens to both full texts, and more than eight
// entries wait behind "Show all" (Mika 16.11.2026). A session that may not read the log gets no group.
// Owns: these rows. Never: holds a value of its own, edits an agent's text, or asks to confirm.

import { useEffect, useState } from 'preact/hooks';
import { MAX_HUMAN_MD } from '../../shared/model/agent-core.ts';
import type { SecurityChange } from '../../shared/model/security-log.ts';
import { fullDate, logTime } from '../lib/format.ts';
import { rpc } from '../lib/rpc.ts';
import { isPersonSession } from '../lib/people.ts';
import { canEditOwnerSettings, HTTPS_NOTE, PC_NOTE, session } from '../lib/session.ts';
import { settings, updateSettings } from '../lib/store.ts';
import type { PcAccess } from '../onboarding/first-run-model.ts';
import { ACCESS_LEVELS, setPcAccess } from '../onboarding/pc-access.ts';
import { act, ActionButton, Group, Note, Row, Segmented, Toggle } from './controls.tsx';

const LEVEL_OPTIONS = ACCESS_LEVELS.map((level) => ({ value: level.id, label: level.title }));

/** The note of a session that may not change the company's settings (as on General). */
function lockNote(): string {
  if (isPersonSession()) return 'Set by the owner of the organisation';
  const info = session.value;
  return info?.kind === 'device' && info.capabilities.includes('settings') && !info.secure ? HTTPS_NOTE : PC_NOTE;
}

function AccessGroup(props: { access: PcAccess; locked: boolean }) {
  const [pending, setPending] = useState<PcAccess | null>(null);
  const shown = pending ?? props.access;
  const choose = (to: PcAccess) => {
    if (pending || to === props.access) return;
    setPending(to);
    void act(() => setPcAccess(to), 'Could not change the access').finally(() => setPending(null));
  };
  const sentence = ACCESS_LEVELS.find((level) => level.id === shown)?.text ?? '';
  return (
    <Group title="Access" hint="An agreement with your team: the Manager hears of a change and each agent puts it in its own instructions">
      <Row label="Access to this PC" hint={props.locked ? lockNote() : sentence} reserve={2}>
        {props.locked
          ? <Note>{ACCESS_LEVELS.find((level) => level.id === props.access)?.title}</Note>
          : <Segmented label="Access to this PC" value={shown} options={LEVEL_OPTIONS} onChange={choose} />}
      </Row>
    </Group>
  );
}

function EveryAgentGroup(props: { text: string; locked: boolean }) {
  const [draft, setDraft] = useState(props.text);
  useEffect(() => setDraft(props.text), [props.text]);
  const save = () => {
    const next = draft.replace(/\r\n?/g, '\n').trim();
    if (next === props.text.trim()) return;
    void act(() => updateSettings({ profile: { forEveryAgent: next } }), 'Could not save the text');
  };
  return (
    <Group title="For every agent" hint={props.locked ? lockNote() : 'The last part of every agent\'s instructions, after what you wrote on its own page. The agents can change it too.'}>
      <Row label="" stack>
        <textarea class="set-textarea" rows={5} maxLength={MAX_HUMAN_MD} value={draft} readOnly={props.locked} aria-label="For every agent"
          placeholder="What every agent should always know from you" onInput={(event) => setDraft(event.currentTarget.value)} onBlur={save} />
      </Row>
    </Group>
  );
}

/**
 * 17.11.2026: sharing in the public library (settings.library.publish, on by default – owner 06.11.2026), the same
 * choice as the first run's tick. Off ends only the sharing; the agents still search and read the library.
 */
function LibraryGroup(props: { share: boolean; locked: boolean }) {
  const [pending, setPending] = useState<boolean | null>(null);
  const shown = pending ?? props.share;
  const change = (to: boolean) => {
    if (pending !== null || to === props.share) return;
    setPending(to);
    void act(() => updateSettings({ library: { publish: to } }), 'Could not change the sharing').finally(() => setPending(null));
  };
  return (
    <Group title="Public library" hint="Skills and notes your agents find worth sharing go to library.openautark.com for everyone (public, CC0)">
      <Row label="Share in the public library" hint={props.locked ? lockNote() : 'Each text is checked for secrets, paths, e-mail addresses and internal names first; what fails a check stays here. Off: nothing is shared, the agents still read the library.'} reserve={2}>
        {props.locked ? <Note>{props.share ? 'On' : 'Off'}</Note> : <Toggle label="Share in the public library" checked={shown} onChange={change} />}
      </Row>
    </Group>
  );
}

const SHOWN_CHANGES = 8;
const FIELD_NAME = { pcAccess: 'Access to this PC', forEveryAgent: 'For every agent', libraryPublish: 'Share in the public library' } as const;
const ON_OFF = (value: string): string => (value === 'off' ? 'Off' : 'On');
const QUOTE = (text: string): string => `"${text.replace(/\s+/g, ' ').trim()}"`;

function levelName(id: string): string {
  return ACCESS_LEVELS.find((level) => level.id === id)?.title ?? id;
}

/** "Access to this PC: Full access → Careful" / "For every agent: "old" → "new"". */
export function changeLine(change: SecurityChange): string {
  const [from, to] = change.field === 'pcAccess' ? [levelName(change.from), levelName(change.to)]
    : change.field === 'libraryPublish' ? [ON_OFF(change.from), ON_OFF(change.to)]
    : [QUOTE(change.from), QUOTE(change.to)];
  return `${FIELD_NAME[change.field]}: ${from} → ${to}`;
}

/** Who changed it – the most important part of the row: an agent by name, linked to its page. */
function Who(props: { by: SecurityChange['by'] }) {
  const { by } = props;
  return by.kind === 'agent' && by.id?.startsWith('ag_') ? <a class="sec-change-who" href={`#/team/${by.id}`}>{by.name}</a> : <>{by.name}</>;
}

/**
 * One change: who on the left, the time once on the right, the change in one clipped line. A change of the text opens
 * (click or Enter) to both full texts, one under the other; the access level never needs to.
 */
function ChangeRow(props: { change: SecurityChange }) {
  const { change } = props;
  const [open, setOpen] = useState(false);
  const when = <Note><span title={fullDate(change.at)}>{logTime(change.at)}</span></Note>;
  const line = changeLine(change);
  if (change.field !== 'forEveryAgent') return <Row label={<Who by={change.by} />} hint={line} reserve>{when}</Row>;
  const toggle = <button type="button" class="sec-change-line" aria-expanded={open} title={open ? undefined : line} onClick={() => setOpen(!open)}>{open ? FIELD_NAME.forEveryAgent : line}</button>;
  return open
    ? (
      <Row label={<Who by={change.by} />} hint={<>{toggle}<span class="sec-change-cap">Before</span><span class="sec-change-text">{change.from || '(empty)'}</span><span class="sec-change-cap">After</span><span class="sec-change-text">{change.to || '(empty)'}</span></>}>
        {when}
      </Row>
    )
    : <Row label={<Who by={change.by} />} hint={toggle} reserve>{when}</Row>;
}

function ChangesGroup(props: { token: string }) {
  const [changes, setChanges] = useState<SecurityChange[] | null | undefined>(undefined);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    rpc.call('settings.securityLog').then((list) => { if (live) setChanges(list); }, () => { if (live) setChanges(null); });
    return () => { live = false; };
  }, [props.token]);
  if (changes === null) return null; // this session may not read the log
  const list = changes ?? [];
  const shown = all ? list : list.slice(0, SHOWN_CHANGES);
  return (
    <Group title="Changes" hint="Who changed these settings, when, and what it said before – the agents may change them like any setting. An agent's name is the one it gives itself; quick changes in a row can show as one.">
      {shown.length === 0
        ? <Row label="" stack><Note>{changes ? 'No changes yet.' : ''}</Note></Row>
        : shown.map((change) => <ChangeRow key={`${change.at}-${change.field}`} change={change} />)}
      {list.length > shown.length && <Row label="" stack><ActionButton variant="ghost" label={`Show all ${list.length}`} onClick={() => setAll(true)} /></Row>}
    </Group>
  );
}

export function SecurityPage() {
  const profile = settings.value?.profile;
  if (!profile) return null;
  const locked = !canEditOwnerSettings();
  const share = settings.value?.library?.publish !== false;
  return (
    <>
      <AccessGroup access={profile.pcAccess ?? 'whole'} locked={locked} />
      <EveryAgentGroup text={profile.forEveryAgent ?? ''} locked={locked} />
      <LibraryGroup share={share} locked={locked} />
      <ChangesGroup token={`${profile.pcAccess ?? ''}|${profile.forEveryAgent ?? ''}|${share}`} />
    </>
  );
}
