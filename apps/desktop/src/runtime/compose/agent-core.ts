// Composition of the agent core folders (wave 3, agent-core/*): the skill library's Main Skills roots
// (<data>/agents/<id>/skills of agents that exist), the AgentCore service on RuntimeServices, the org
// hook (SYSTEM.md before an edit is saved, a folder for each hire) and the start-up reconcile, with the
// agent core as the owner of <data>/agents on the data folder watcher (s.rootWatcher, B-044), and the image
// avatar copies in those folders (agent-core/avatar.ts, B-044). The stop step is compose/lifecycle.ts 'agent core'.
// Owns: this wiring. Never: behaviour, timers or polling.

import type { RuntimeServices } from '../contracts.ts';
import '../contracts/agent-core.ts';
import '../contracts/root.ts';
import { AgentCore } from '../agent-core/service.ts';
import { AvatarMirror } from '../agent-core/avatar.ts';
import { mainSkillRoots, mainSkillsDir } from '../agent-core/layout.ts';
import type { Org } from '../org/service.ts';
import type { SkillLibrary, SkillServiceOptions } from '../skills/service.ts';
import { KvRepo } from '../store/kv.ts';

const OWN_NS = 'agentCore.own';

/** The library options for Main Skills (before s.skills exists; the org is read lazily). */
export function mainSkillOptions(s: RuntimeServices): Pick<SkillServiceOptions, 'mainRoots' | 'mainDir' | 'chain'> {
  return {
    mainRoots: () => mainSkillRoots(s.paths.data, (agentId) => s.org?.get(agentId) !== undefined),
    mainDir: (agentId) => mainSkillsDir(s.paths.data, agentId),
    chain: (agentId) => s.org?.managers(agentId).map((boss) => boss.id) ?? [], // B-066: skill routes up the tree
  };
}

/** Creates and starts the agent core (a start failure is logged; prompts then use the agent rows). */
export function createAgentCore(s: RuntimeServices, org: Org, library: SkillLibrary): AgentCore {
  const kv = new KvRepo(s.db);
  const own = { // B-087: which SYSTEM.md is the app's own, across a restart (kv stays on this PC)
    get: (agentId: string) => kv.get<string>(OWN_NS, agentId),
    set: (agentId: string, sig: string | undefined) => { if (sig === undefined) kv.delete(OWN_NS, agentId); else kv.set(OWN_NS, agentId, sig, s.clock.now()); },
  };
  const core = new AgentCore({ dataDir: s.paths.data, org: () => s.org, skills: () => library, bus: s.bus, clock: s.clock, log: s.log, root: s.rootWatcher, paths: s.paths, own,
    language: () => s.settings.get().profile?.language }); // a hire's HUMAN.md starts in the app's language
  s.agentCore = core;
  org.setCoreFiles(core);
  try {
    core.start();
  } catch (error) {
    s.log.warn('agent folders not started', { error: String(error) });
  }
  // B-044: an image avatar's copy beside SYSTEM.md (agent-core/avatar.ts), after the folders exist.
  try {
    new AvatarMirror({ dataDir: s.paths.data, files: s.files, org: () => s.org, bus: s.bus, log: s.log }).start();
  } catch (error) {
    s.log.warn('avatar copies not started', { error: String(error) });
  }
  return core;
}
