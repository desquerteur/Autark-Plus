// The runtime side of the first-run layer (ui/onboarding/FirstRun.tsx). The layer shows while
// settings.onboarding.step is not 'done'; its cards make their own choices through the existing methods
// (accounts, settings). start() ends the layer: step 'done' and completed, the Manager's first chat
// (shared/text/manager-chat.ts; when there is none, the owner's default 1:1 with it, chat/direct.ts) and its two opening
// lines (brief.ts) in one transaction: F07 (owner 15.11.2026: "Standardprompt direkt gesendet … und dann direkt diese
// Antwort drauf") the start line as the person's own, delivered to nobody, then the Manager's first message as the
// Manager's own line right below it. B-090 (owner 13.11.2026: "ein gestellter erster Aufbau", "der User kann sich dann
// auch entscheiden, dass die KI nicht direkt anfängt"): the app writes both lines, so no model runs and no agent wakes
// at Start; the person's answer is an ordinary message and the Manager's first turn (one 'message' wake, the route of a
// person's request), which reads all three lines. reset() ("Set up again", owner): not completed, step 'profile' – the
// setup assistant (AF-002) returns from its first step until the next start().
// B-085: start() first makes the Manager's PC line in its SYSTEM.md "What I have here" follow the person's choice
// (settings.profile.pcAccess): careful swaps the whole-PC line for the careful one, whole swaps a careful line from an
// earlier run back; both rendered from the SYSTEM.md template (resources/prompts/system-md.md, so the wording lives there
// only); agents hired later get it at hire.
// Owns: these state changes, posting those two lines and that one line swap. Never: writes as the person anything but
// the start line, writes as the Manager anything but its first message, wakes anyone, invents profile facts, changes
// accounts or any other part of a SYSTEM.md.

import type { RuntimeServices } from '../contracts.ts';
import '../../shared/model/onboarding.ts'; // the first-run methods (module augmentation)
import { HUMAN_ID } from '../../shared/ids.ts';
import type { Agent } from '../../shared/model/org.ts';
import { managerAgent, managerFirstChat } from '../../shared/text/manager-chat.ts';
import { findOrCreateDirect } from '../chat/direct.ts';
import { renderTemplate } from '../context/templates.ts';
import { splitAtHave, systemMdValues } from '../org/hire.ts';
import { splitStandard } from '../org/standard.ts';
import { WorkforceError } from '../../shared/errors.ts';
import { setupLines } from './brief.ts';

export interface OnboardingDeps {
  services: () => RuntimeServices;
}

/** Stands for the person's name while matching the whole-PC line (the Manager was hired before the name was typed). */
const NAME_MARK = '\u0001';
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The first bullet under "## What I have here" of the template rendered with `values` ('' when it has none). */
function havingLine(template: string, values: Readonly<Record<string, string>>): string {
  return splitAtHave(renderTemplate(template, values)).tail.split('\n').map((line) => line.trim()).find((line) => line.startsWith('- ')) ?? '';
}

/**
 * B-085: `instructions` with the template's PC line of the other choice (for any name) swapped for the line of `careful`
 * rendered with `values`; the text itself when that line is there already; null when there is nothing to swap (the
 * template has no careful variant, or the agent wrote a line of its own).
 */
export function withPcLine(instructions: string, template: string, values: Readonly<Record<string, string>>, careful: boolean): string | null {
  if (!template.includes('{{#careful}}')) return null;
  const flag = (yes: boolean) => (yes ? 'yes' : '');
  const wanted = havingLine(template, { ...values, careful: flag(careful) });
  const other = havingLine(template, { ...values, careful: flag(!careful), owner: NAME_MARK, user_name: NAME_MARK });
  if (wanted && instructions.includes(wanted)) return instructions;
  if (!wanted || !other) return null;
  const pattern = new RegExp(`^${other.split(NAME_MARK).map(escaped).join('.+?')}$`);
  const lines = instructions.split('\n');
  const at = lines.findIndex((line) => pattern.test(line.trim()));
  if (at < 0) return null;
  lines[at] = wanted;
  return lines.join('\n');
}

export class Onboarding {
  private readonly deps: OnboardingDeps;

  constructor(deps: OnboardingDeps) {
    this.deps = deps;
  }

  /** "Set up again" (Settings › General, Team › Add, the palette): the setup assistant from its first step. */
  reset(): void {
    this.deps.services().settings.update({ onboarding: { completed: false, step: 'profile' } });
  }

  /**
   * The layer is through: onboarding done, the Manager's first chat and its two opening lines there – the start line as
   * the person's, the Manager's first message below it (once, also when asked twice: the chat ends with that message
   * already); nobody wakes.
   */
  start(): { conversationId: string } {
    const s = this.deps.services();
    const manager = managerAgent(s.org.list());
    if (!manager) throw new WorkforceError('not_found', 'There is no Manager on the team.');
    this.pcLine(s, manager);
    const conversationId = managerFirstChat(s.chats.list(), manager.id)?.id ?? findOrCreateDirect(s, HUMAN_ID, manager.id, { createdBy: HUMAN_ID });
    const { start, answer } = setupLines(s);
    const last = s.chats.messages(conversationId, { limit: 1 }).at(-1);
    if (answer && !(last?.authorId === manager.id && last.body === answer)) {
      // one transaction: a crash between the two never leaves the start line as an unanswered request (chat/delivery-recovery.ts)
      s.db.tx(() => {
        if (start) s.chats.send({ conversationId, body: start, authorId: HUMAN_ID, authorKind: 'human', deliver: false });
        s.chats.send({ conversationId, body: answer, authorId: manager.id, authorKind: 'agent' });
      });
    }
    s.settings.update({ onboarding: { completed: true, step: 'done' } });
    s.log.info('first run done', { managerId: manager.id, conversationId });
    return { conversationId };
  }

  /**
   * B-085: the Manager's PC line follows the choice before its first turn – careful swaps in the careful line, whole
   * swaps a careful line from an earlier run back ("Set up team again"). A failure never stops the start.
   */
  private pcLine(s: RuntimeServices, manager: Agent): void {
    const settings = s.settings.get();
    const careful = settings.profile.pcAccess === 'careful';
    try {
      const template = s.prompts?.text('standard-manager') ?? '';
      const own = splitStandard(manager.instructions).own; // the standard comment below follows by itself (org/standard.ts)
      const next = template ? withPcLine(own, template, systemMdValues(settings), careful) : null;
      if (next === null && careful) s.log.info('careful PC line not found in the Manager\'s SYSTEM.md', { managerId: manager.id });
      if (next === null || next === own) return;
      s.org.update(manager.id, { instructions: next }, { by: HUMAN_ID, reason: `The person chose ${careful ? 'careful' : 'whole'} PC access at the first run.` });
    } catch (error) {
      s.log.warn('PC line not written', { managerId: manager.id, error: String(error) });
    }
  }
}
