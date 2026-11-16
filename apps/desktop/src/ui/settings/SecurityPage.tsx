// Settings › Security (owner 16.11.2026: "ein Sicherheits Tab … Einstellungen wie für Vollzugriff und weniger … global
// für alle Agents … Ich bin kein Roboter … den Text überschreiben jeder Agent gleich"): two fixed groups, both views on
// settings.json. (1) Access – settings.profile.pcAccess, Full access | Careful, the chosen level's one sentence in the
// row's reserved hint; a change goes to the Manager as the person's line first and then into the setting
// (onboarding/pc-access.ts setPcAccess), because it is an agreement each agent keeps in its own SYSTEM.md, never a lock.
// (2) For every agent – settings.profile.forEveryAgent in one fixed field, saved on leaving it: the last part of every
// agent's instructions, after its own HUMAN.md (context/prompt-stable.ts); it starts with the "I'm not a robot" line, and
// the agents change it like any setting. A session that may not change the company's settings sees both read-only.
// Owns: these rows. Never: holds a value of its own, edits an agent's text, or asks to confirm.

import { useEffect, useState } from 'preact/hooks';
import { MAX_HUMAN_MD } from '../../shared/model/agent-core.ts';
import { isPersonSession } from '../lib/people.ts';
import { canEditOwnerSettings, HTTPS_NOTE, PC_NOTE, session } from '../lib/session.ts';
import { settings, updateSettings } from '../lib/store.ts';
import type { PcAccess } from '../onboarding/first-run-model.ts';
import { ACCESS_LEVELS, setPcAccess } from '../onboarding/pc-access.ts';
import { act, Group, Note, Row, Segmented } from './controls.tsx';

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

export function SecurityPage() {
  const profile = settings.value?.profile;
  if (!profile) return null;
  const locked = !canEditOwnerSettings();
  return (
    <>
      <AccessGroup access={profile.pcAccess ?? 'whole'} locked={locked} />
      <EveryAgentGroup text={profile.forEveryAgent ?? ''} locked={locked} />
    </>
  );
}
