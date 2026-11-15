// The quiet switch line of one turn (RT5; B-083: with the agent's name and the turn's temperature), for agents/turn.ts announceSwitch.
// 14.11.2026 (Unterbewusstsein v1 routes nearly every turn; owner: a stable UI where nothing shifts, the status in the status line): the
// chat gets a line for a switch someone asked for – my own request (model.set, or my task's from its delegator: a route by request
// without my subconscious's why), my own temperature, or the start model set since the chat's last turn began (ModelPolicy.pinBy.at)
// that this turn runs on. A switch routing made – my subconscious's call before the turn, the router's rules, the return after a
// request – leaves no line: the live bar shows what the turn runs on (ui/chat/LiveBar.tsx: model · effort · temperature) and the
// run's route says why (the agent's log, ui/team/AgentLog.tsx).
//   "<Agent> → <model> · <effort>[ · temperature T] – <why>" (switch-line.ts)
// postRunLine posts one quiet line of a run in its chat (the agent's own, meta.fromRun) – turn.ts, and turn-attempt.ts for
// a switch inside the running turn (B-083).
// Owns: which switch gets a line and posting a run's line. Never: routes or reads state.

import type { RuntimeServices } from '../contracts.ts';
import type { Effort, RouteDecision } from '../../shared/model/providers.ts';
import type { StatusLine } from '../../shared/model/chat.ts';
import { PIN_TEXT } from '../routing/pins.ts';
import { BY_REQUEST } from '../routing/previous.ts';
import { REQUESTED_WHY, reasonParts, subconsciousWhy, switchText, switchWhy } from './switch-line.ts';

export interface RouteLine { text: string; details: Record<string, unknown> }

/** What the chat's last turn ran on (turn.ts switchedFrom; B-083: with its temperature), and when it began. */
export interface SwitchFrom { modelId: string; effort: Effort; temperature?: number; at?: number }

/** Whose line it is, how the turn's temperature reaches its model (sent), whether that temperature is my own request, and when my start model was set (ModelPolicy.pinBy.at). */
export interface LineOf { agent: string; sent?: boolean; ownTemperature?: boolean; pinAt?: number }

/** The line of this route when it is a switch someone asked for; `from` = what the chat's last turn ran on (none: a first turn, no switch). */
export function routeLine(route: RouteDecision, modelName: string, from: SwitchFrom | undefined, of: LineOf): RouteLine | undefined {
  if (!from) return undefined;
  const moved = from.modelId !== route.modelId || from.effort !== route.effort;
  const mine = route.by === BY_REQUEST && !subconsciousWhy(route.reason);
  const started = of.pinAt !== undefined && from.at !== undefined && of.pinAt > from.at && reasonParts(route.reason).includes(PIN_TEXT.agent);
  const asked = moved && (mine || started);
  const warmth = of.ownTemperature === true && from.temperature !== route.temperature;
  if (!asked && !warmth) return undefined;
  const to = { modelName, effort: route.effort, temperature: route.temperature, sent: of.sent };
  return {
    text: switchText(of.agent, to, asked ? switchWhy(route, from) : REQUESTED_WHY),
    details: {
      from: from.modelId, to: route.modelId, effort: route.effort, reason: route.reason, by: route.by,
      ...(route.temperature !== undefined ? { temperature: route.temperature, temperatureSent: of.sent === true } : {}),
    },
  };
}

/** A quiet line of a run in its chat (meta.fromRun: the UI may fold it into the run's steps); none without a chat. Never throws. */
export function postRunLine(services: Pick<RuntimeServices, 'chats' | 'log'>, run: { agentId: string; runId: string; conversationId?: string; taskId?: string }, type: StatusLine['type'], text: string, details: Record<string, unknown>): void {
  if (!run.conversationId) return;
  try { services.chats.status(run.conversationId, { type, text, details }, { authorId: run.agentId, taskId: run.taskId, fromRun: run.runId }); } catch (error) {
    services.log.warn('status line failed', { error: String(error) });
  }
}
