// The model routing takes now for an agent while the picker in front of the person has nothing chosen
// (routing.preview with ignorePin: router rules only, no model call). B-083 (owner 08.11.: the Auto system was
// missing) replaces B-072's "never a mode word": the "nothing chosen" option is "Auto" – nothing is suggested, the AI
// decides – and names that model beside it ("Opus 5.5 now", the composer's model chip). A chat's own suggestion never
// routes (13.11.2026: information for the AI on the person's line), so in a chat this is what runs; its runs continue.
// Owns: that one call as a hook and the words of the "nothing chosen" option. Never: picks, stores or guesses a model.

import { useEffect, useState } from 'preact/hooks';
import type { RouteDecision } from '../../shared/model/providers.ts';
import { rpc } from './rpc.ts';
import { can } from './session.ts';

/** The "nothing chosen" option: nothing is suggested, the AI decides each turn. */
export const AUTO = 'Auto';

/**
 * The route for `agentId` with nothing chosen in the picker (`conversationId`: in that chat). Undefined until it
 * answers, when it fails and where this connection may not ask. `again`: values on whose change it asks anew.
 */
export function useRoutePreview(agentId: string | null | undefined, conversationId: string | undefined, again: readonly unknown[] = []): RouteDecision | undefined {
  const key = agentId ? `${agentId} ${conversationId ?? ''}` : '';
  const allowed = can('routing.preview');
  const [answer, setAnswer] = useState<{ key: string; route: RouteDecision } | undefined>();
  useEffect(() => {
    if (!agentId || !allowed) return;
    let alive = true;
    rpc.call('routing.preview', { agentId, ...(conversationId ? { conversationId } : {}), ignorePin: true })
      .then((route) => { if (alive) setAnswer({ key, route }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [key, allowed, ...again]);
  // an answer for another agent or chat is never shown
  return answer?.key === key ? answer.route : undefined;
}
