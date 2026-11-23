// B-057 S10 – how a split's turn routes (router.ts applies it for RouteRequest.split). The part's own choice
// (agents/split-turn.ts turns 'cheap' | 'strong' | a model id – or none named – into RouteRequest.previous, needs.tier and
// split.fresh) beats the agent's pin, and – when it names an effort – the agent's fixed effort.
// Owns: that adjustment. Never: picks a model, changes state, or touches a route that is not a split's.

import type { RouteRequest } from '../contracts.ts';
import type { EffectivePolicy } from './policies.ts';

/** The policy of a split's route: no agent pin (the Work use still applies, router.ts), no fixed effort when the split names one. */
export function splitPolicy(policy: EffectivePolicy, request: Pick<RouteRequest, 'split' | 'previous'>): EffectivePolicy {
  if (!request.split) return policy;
  const effortNamed = request.previous?.explicit === true && request.previous.asked !== 'model';
  return {
    ...policy,
    pin: undefined,
    ...(effortNamed ? { agentEffort: undefined } : {}),
  };
}
