// Settings › Skills & memory: the memory tree (MemoryTree.tsx) and every copy of every skill with its route and description
// (skills.list; the file is what counts, the AI and the person edit it). A click opens a memory or a skill's SKILL.md in the
// pane's file tab; a right click offers the system's own app, the skill's folder and, for the only copy of a skill that is
// not built in, Delete. Where the session reads no files but has the named skill API (a Settings device), a row opens the
// exact-copy editor instead (SkillEditor.tsx, upstream). New skill and the modes: skills-extra.tsx; "Add from link" and the
// skills from links (AF-007): skill-links.tsx.
// Owns: rows and editor selection. Never: resolves a skill by name for editing, or writes a memory (the file tab does).

import { useEffect, useState } from 'preact/hooks';
import type { SkillInfo } from '../../shared/model/knowledge.ts';
import { SKILL_EDITOR_WRITE_UNAVAILABLE } from '../../shared/api/methods-skills.ts';
import { useContextMenu } from '../lib/context-menu.tsx';
import { rpc } from '../lib/rpc.ts';
import { can } from '../lib/session.ts';
import { agentName, agents } from '../lib/store.ts';
import { skillTitle } from '../team/agent-core-model.ts';
import { openFileTab, openWithSystem, pathMenu } from '../workspace/file-tabs.ts';
import { confirm } from '../lib/ui.tsx';
import { act, Group, Note, Row, useAsync } from './controls.tsx';
import { MemoryTree } from './MemoryTree.tsx';
import { joined, openInTab } from './open-file.ts';
import { skillRoute, skillRows } from './skill-route.ts';
import { ModesGroup, NewSkill } from './skills-extra.tsx';
import { AddFromLink, LinkedSkills } from './skill-links.tsx';
import { SkillEditor } from './SkillEditor.tsx';

const isManager = (agentId: string): boolean => agents.value.some((agent) => agent.managerId === agentId);

/** One skill; where the session may read files a click opens its SKILL.md in the file tab. */
function SkillRow(props: { skill: SkillInfo; open: boolean; onEdit?: () => void; onDelete?: () => void }) {
  const { skill, open } = props;
  const file = joined(skill.path, 'SKILL.md');
  const hint = `${skillRoute(skill, agentName, isManager)} · ${skill.description}`;
  const menu = () => [...pathMenu(file), { items: [{ label: 'Open folder', onSelect: () => openWithSystem(skill.path) }] }, ...(props.onDelete ? [{ items: [{ label: 'Delete', danger: true, onSelect: props.onDelete }] }] : [])];
  const context = useContextMenu(menu);
  if (!open && !props.onEdit) return <Row label={skillTitle(skill.name)} hint={hint} reserve={2} />;
  return (
    <button type="button" class="set-row reserve file-open-row" title={file} {...(open ? context : {})} onClick={() => props.onEdit ? props.onEdit() : openFileTab(file)}>
      <div class="set-row-text">
        <div class="set-row-label">{skillTitle(skill.name)}</div>
        <div class="set-row-hint reserved two">{hint}</div>
      </div>
    </button>
  );
}

export function SkillsPage() {
  const open = can('files.readPath');
  // Preserve the established desktop file-tab workflow.
  const editor = !open && can('skills.catalog') && can('skills.open');
  const [selected, setSelected] = useState<SkillInfo>();
  const list = useAsync(() => editor ? rpc.call('skills.catalog') : rpc.call('skills.list', { every: open }), [open, editor]);
  const [memory, setMemory] = useState('');
  const [linkedVersion, setLinkedVersion] = useState(0); // AF-007: an install from a link reloads "From links" too
  const installed = () => { void list.reload(); setLinkedVersion((version) => version + 1); };
  useEffect(() => { if (open) void rpc.call('system.root').then((root) => setMemory(joined(root.path, 'memory'))).catch(() => undefined); }, [open]);
  useEffect(() => rpc.on('skills.changed', () => void list.reload()), [list.reload]);
  const skills = skillRows(list.data ?? []);
  const remove = async (skill: SkillInfo) => {
    if (await confirm({ title: `Delete ${skillTitle(skill.name)}?`, body: 'Its folder is deleted.', confirmLabel: 'Delete', danger: true })) await act(() => rpc.call('skills.delete', { name: skill.name }), 'Could not delete');
    void list.reload();
  };
  // skills.delete goes by name: offered only where the name means this one copy; ~/.claude and ~/.codex skills are read-only here (skills/service.ts)
  const deletable = (skill: SkillInfo) => open && skill.source !== 'builtin' && !/[\\/]\.(?:claude|codex)[\\/]skills[\\/]/.test(skill.path) && can('skills.delete') && skills.filter((entry) => entry.name === skill.name).length === 1;
  return (
    <>
      {open && (
        <Group title="Memory" id="settings-memory" hint="What the company, its branches and each agent know, one Markdown file per entry"
          actions={<button type="button" class="button ghost small" onClick={() => void openInTab('memory')}>Open folder</button>}>
          {memory && <MemoryTree root={memory} />}
        </Group>
      )}
      <Group title="Skills" id="settings-skills" tour="skills" hint={skills.length ? `${skills.length} skills` : undefined}
        actions={<>{can('skills.save') && <NewSkill onCreated={() => { void list.reload(); }} />}{open && can('skills.installLink') && <AddFromLink onInstalled={installed} />}{open && <button type="button" class="button ghost small" onClick={() => void openInTab('skills', 'workspace')}>Open folder</button>}</>}>
        {editor && <><Row label="Read-only" /><p class="dialog-text">{SKILL_EDITOR_WRITE_UNAVAILABLE}</p></>}
        {list.error && <Row label="Unavailable" hint={list.error} reserve />}
        {list.loading && !list.data && !list.error && <Row label={<Note>Loading…</Note>} reserve />}
        {skills.map((skill) => <SkillRow key={skill.path} skill={skill} open={open} onEdit={editor && skill.id ? () => setSelected(skill) : undefined} {...(deletable(skill) ? { onDelete: () => void remove(skill) } : {})} />)}
      </Group>
      {can('skills.linked') && <LinkedSkills version={linkedVersion} onChanged={() => void list.reload()} />}
      {can('modes.list') && <ModesGroup />}
      {selected && <SkillEditor key={selected.id} skill={selected} onClose={() => setSelected(undefined)} onSaved={() => void list.reload()} />}
    </>
  );
}
