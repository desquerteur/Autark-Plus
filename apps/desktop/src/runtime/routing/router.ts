// The router: picks model, engine, account and effort for one turn. One route, in this order:
//   category: the mode's, refined by keywords for generic modes (categories.ts), else 'chat'
//   → candidates (pool.ts: connected, not excluded, needs, the mode's tier as a preference, policy band, "never" priors)
//   → the agent's start model – unless the agent asks for its own (a request nothing meets leaves the start model in place)
//   → the agent's own model.set: the kind of model it asked for (need.ts: stronger, cheaper, faster, vision, long
//     context) or the model it named. B-079 (live 07.11.: Jonas's "Opus high for code" and Nora's "xhigh as the owner
//     asked" were set with model.set and lost to their own agent pins): a request beats the agent's start model
//   → the Settings use (settings.json Models: agents the Work model, runtime helper calls the Decisions model –
//     routing/pins.ts), then for helper calls the helper default (helper-default.ts) on its qualifying plan accounts only
//   → B-080/D3: a pin that cannot run now (unavailable, no account left, at its limit) gets a stand-in from the strongest
//     tier at most at its own list price (score.ts listPrice) – the rules below choose inside that set; none that
//     cheap → the whole pool
//   → a person's own request (a new line of a person in the chat): the strongest model the Work use allows, effort ≥ high,
//     its smarts weighed against its list price (person-turn.ts; not in the cheaper cost mode) – background turns and
//     helper calls go on below
//   → the previous model continues unless it is weak for the work (previous.ts)
//   → the deterministic score (score.ts: curated prior + tier fit + plan headroom − cost, work plan bonus for agents)
//   → effort (previous.ts startEffort), clamped to the model's efforts; account: the healthy accounts of that model.
// 13.11.2026 (owner: the chat's model choice is "einfach nur da, wird der KI so erklärt"): the person's suggestion in a
// chat (the composer chip, policies.ts chatChoice) never routes – it stands on their line (context/render.ts), and the
// AI or its subconscious set the model with model.set; a temperature comes only from such a request (TurnPlan.temperature).
// B-083: a request my subconscious set before the turn (RouteRequest.previous `by: 'subconscious'`, agents/next-route.ts)
// is the agent's own request; its reason reads "my subconscious: <why>" where model.set's reads "requested by the agent" –
// on a route it shaped only. D1: a model the agent named that cannot run now leaves its turn on the model it is on
// (RouteRequest.previous.from), else on the strongest model at least at its tier and at most its list price, else to the
// rules; the reason leads with "asked for <name> – <why>" (unfit.ts askedMiss).
// A split's turn (RouteRequest.split) has no agent pin and keeps an effort it names (split-route.ts).
// Owns: that order and the user-facing reason. Never: changes state, asks a model, or exceeds the policy band
// silently (it fails with a clear message instead).

import type { RouteRequest, Router, RuntimeServices } from '../contracts.ts';
import type { Account, ModelInfo, RouteDecision } from '../../shared/model/providers.ts';
import { WorkforceError } from '../../shared/errors.ts';
import { SYSTEM_ID } from '../../shared/ids.ts';
import { clampEffort } from '../models/efforts.ts';
import { categoryLabel, resolveCategory } from './categories.ts';
import { effectivePolicy } from './policies.ts';
import { PIN_TEXT, pinProblem, resolvePin, settingsPin } from './pins.ts';
import { BY_REQUEST, EFFORT_REQUESTED, modelAsked, returnBlocked, startEffortBy } from './previous.ts';
import { NO_MODEL_MESSAGE, askedMiss, nothingFits } from './unfit.ts';
import { buildPool, type PoolEntry } from './pool.ts';
import { helperDefault } from './helper-default.ts';
import { workPlanOf } from './preference.ts';
import { listPrice, marginalCost, scoreModel, strengthOf, tierRank, type CostMode, type Tier } from './score.ts';
import { NEED_TEXT, NO_FIT_TEXT, needChoice, raisedText, stepUpEffort } from './need.ts';
import { splitPolicy } from './split-route.ts';
import { PERSON_TEXT, personAsks, personEffort, strongestPick, topTier } from './person-turn.ts';

export { NO_MODEL_MESSAGE };
const ALTERNATIVES = 3;

interface Ranked { model: ModelInfo; accounts: Account[]; score: number }

export class RouterImpl implements Router {
  private readonly deps: { services: () => RuntimeServices };

  constructor(deps: { services: () => RuntimeServices }) {
    this.deps = deps;
  }

  async route(request: RouteRequest): Promise<RouteDecision> {
    const s = this.deps.services();
    let models = s.catalog.list();
    if (!models.some((model) => model.available)) {
      // Fresh install / first start: the catalog may not have been built yet (coalesced, throttled).
      await s.catalog.refresh().catch(() => undefined);
      models = s.catalog.list();
    }
    if (!models.some((model) => model.available)) throw new WorkforceError('unavailable', NO_MODEL_MESSAGE);

    const now = s.clock.now();
    const settings = s.settings.get().routing;
    const runtime = request.agent.id === SYSTEM_ID;
    const person = !runtime && personAsks(s, request); // a person's own request (step 4)
    const policy = splitPolicy(effectivePolicy(s, request.agent), request);
    const category = resolveCategory(request.mode.category, request.text);
    const costMode: CostMode = policy.costMode ?? settings.costMode ?? 'balanced';
    const workPlan = runtime ? undefined : workPlanOf(s); // agent work prefers that plan; helpers stay on the helper default
    const minTier = tierRank(request.needs?.tier) > tierRank(request.mode.minTier) ? request.needs?.tier : request.mode.minTier;

    const candidates = buildPool({ s, models, category, policy, needs: request.needs, minTier, exclude: new Set(request.exclude ?? []) });
    const { accountsFor, unusable, inBand } = candidates;
    let pool = candidates.entries;
    const prefer = new Set(policy.prefer);
    const rank = (entries: readonly PoolEntry[], mode: CostMode): Ranked[] => entries
      .map((entry) => ({ ...entry, score: scoreModel({ model: entry.model, account: entry.accounts[0], category, costMode: mode, preferred: prefer.has(entry.model.id), now, workPlan }) }))
      .sort((a, b) => b.score - a.score || a.model.id.localeCompare(b.model.id));
    let ranked = rank(pool, costMode);
    /** B-080/D1/D3: who stands in for a model that cannot run now – at most its list price (at least `tier`), the strongest tier of those. */
    const standIns = (price: number, tier?: Tier): PoolEntry[] =>
      topTier(pool.filter((entry) => listPrice(entry.model) <= price + 1e-9 && tierRank(entry.model.tier) >= tierRank(tier)));

    let leadNote: string | undefined; // what I asked for that nothing meets or that cannot run – it leads every reason
    const mine = subconsciousText(request.previous); // B-083: my subconscious's request names itself
    const decide = (chosen: { model: ModelInfo; accounts: Account[] }, by: RouteDecision['by'], reason: string, keptPrevious: boolean): RouteDecision => {
      // B-089: the origin of the effort rides on the decision (effortBy), so a run's stored route says where it came from
      const start = startEffortBy(policy, request.previous, category, keptPrevious);
      const notes = [...(leadNote ? [leadNote] : []), reason];
      // my subconscious names itself where its request shaped this route: its effort, or a temperature on the model kept
      // (a model or need it asked for that does not run here was not its choice)
      const own = start.requested ? mine ?? EFFORT_REQUESTED : mine && !modelAsked(request.previous) && !request.previous?.need ? mine : undefined;
      if (own && by !== BY_REQUEST) notes.push(own);
      return {
        modelId: chosen.model.id, engine: chosen.model.engine, accountId: chosen.accounts[0].id, effort: clampEffort(start.effort, chosen.model.efforts), category,
        reason: notes.join(' · '), by: start.requested ? BY_REQUEST : by, effortBy: start.by,
        alternatives: ranked.filter((entry) => entry.model.id !== chosen.model.id).slice(0, ALTERNATIVES).map((entry) => entry.model.id),
      };
    };

    // 1. The start model runs when usable and the agent asks for nothing itself. It may leave the policy band and cost
    //    preferences; default pins stay inside the agent's band.
    //    `only`: the accounts that may run this pin (the helper default's plan logins); none left → undefined, no note.
    let fallbackReason: string | undefined;
    let failedPrice: number | undefined; // B-080: the list price of the first pin that cannot run now
    const tryPin = (pin: { modelId: string; source: keyof typeof PIN_TEXT }, banded: boolean, only?: ReadonlySet<string>): RouteDecision | undefined => {
      const pinned = resolvePin(models, pin.modelId);
      let why = pinned ? unusable(pinned) : 'unavailable';
      if (!why && banded && pinned && !inBand(pinned)) why = 'policy';
      const accounts = pinned && !why ? accountsFor(pinned).filter((account) => !only || only.has(account.id)) : [];
      if (pinned && accounts.length) {
        const reason = [fallbackReason, `${PIN_TEXT[pin.source]} · ${categoryLabel(category)}`].filter(Boolean).join(' · ');
        return decide({ model: pinned, accounts }, fallbackReason ? 'fallback' : 'pin', reason, request.previous?.modelId === pinned.id);
      }
      if (only) return undefined;
      const unsuitable = why && why !== 'unavailable' ? why : undefined;
      if (pinned && !unsuitable) failedPrice ??= listPrice(pinned); // B-080: it cannot run now (not: unfit for this work)
      fallbackReason ??= unsuitable ? `pinned model unsuitable (${pinProblem(unsuitable, category)})` : 'pinned model unavailable';
      return undefined;
    };
    const asking = !runtime && (request.previous?.need !== undefined || modelAsked(request.previous));
    const startPin = () => (policy.pin ? tryPin(policy.pin, false) : undefined);
    const pinned = !asking ? startPin() : undefined; // B-079: it yields to the agent's request
    if (pinned) return pinned;

    // 2. The agent's own model.set: the kind of model it asked for, else the model it named.
    const need = runtime ? undefined : request.previous?.need;
    if (need) {
      const from = need.from ? models.find((model) => model.id === need.from) : undefined;
      const choice = needChoice({
        need: need.kind, from, category, cost: (entry: PoolEntry) => marginalCost(entry.model, entry.accounts[0], now),
        scope: pool, rank, costMode, named: request.previous?.modelId,
      });
      const entry = choice.named ?? choice.raised ?? choice.ranked[0];
      if (entry) {
        const lead = choice.raised ? raisedText(need.kind) : NEED_TEXT[need.kind];
        const decision = decide(entry, BY_REQUEST, [fallbackReason, `${lead} · ${categoryLabel(category)}`].filter(Boolean).join(' · '), entry.model.id === need.from);
        // stronger without a stronger model: one effort step up – unless the agent fixed its effort or asked for one.
        const lift = choice.raised && policy.agentEffort === undefined && request.previous?.asked === 'model';
        return lift ? { ...decision, effort: stepUpEffort(decision.effort, entry.model.efforts) } : decision;
      }
      leadNote = NO_FIT_TEXT[need.kind];
    }
    const named = !need && modelAsked(request.previous) ? resolvePin(models, request.previous!.modelId) : undefined; // D5: older id forms too
    const asked = named ? ranked.find((entry) => entry.model.id === named.id) : undefined;
    if (asked) return decide(asked, BY_REQUEST, [fallbackReason, `${mine ?? 'requested by the agent'} · ${categoryLabel(category)}`].filter(Boolean).join(' · '), true);
    // D1: a model I named that cannot run now – my turn stays on the model it is on (its session and cache), else the strongest
    // model at least at its tier and at most its list price, else the rules below. The reason says first what I asked for and
    // why it cannot run; a task's request stays stored for its next turns (agents/next-route.ts).
    if (!need && !runtime && modelAsked(request.previous)) {
      leadNote = askedMiss({ s, request, pool: candidates, named, category, now });
      const on = request.previous!.from ? ranked.find((entry) => entry.model.id === request.previous!.from) : undefined;
      if (on) return decide(on, 'previous', `continues on the previous model · ${categoryLabel(category)}`, true);
      const like = named ? rank(standIns(listPrice(named), named.tier), 'best')[0] : undefined;
      if (like) return decide(like, BY_REQUEST, `${categoryLabel(category)} · strongest stand-in`, false);
    }
    // B-083: a request nothing meets leaves the start model in place.
    const started = asking ? startPin() : undefined;
    if (started) return started;

    // 3. The Settings use: agents the Work model (it stays inside the agent's band), runtime helper calls the Decisions
    //    model (it may leave the helper band); then helper calls take the helper default on its plan logins only.
    const usePin = settingsPin(settings, request);
    const byUse = usePin ? tryPin(usePin, !runtime) : undefined;
    if (byUse) return byUse;
    const helper = runtime ? helperDefault(s, request, candidates, models) : undefined;
    const byHelper = helper ? tryPin(helper, true, helper.accountIds) : undefined;
    if (helper && byHelper) return { ...byHelper, effort: clampEffort(helper.effort, resolvePin(models, helper.modelId)?.efforts ?? []) };

    // B-080/D3: a pin that cannot run now gets a stand-in from the strongest tier at most at its own list price (live
    // 07.11.: Sol at its limit → Opus max for hours; 08.11.: Luna or an unprofiled nano for an Opus or Terra pin in economy).
    // The cost mode, the person rule, the previous model and the score all choose inside that set; the agent's own
    // model.set and the Settings Work model above choose freely. Nothing that cheap connected → the whole pool runs.
    if (failedPrice !== undefined) {
      const within = standIns(failedPrice);
      if (within.length) { pool = within; ranked = rank(within, costMode); }
    }

    if (!ranked.length) throw nothingFits({ ...candidates, s, request, category, now });

    // 4. A person's own request (person-turn.ts): the strongest model the Work use allows, at effort high or above –
    //    unless the person chose the cheaper cost mode. Background turns and helper calls go on below.
    if (person && costMode !== 'economy') {
      const pick = strongestPick(rank(topTier(pool), 'best'), category, request.previous?.modelId);
      if (pick) {
        const weak = !pick.left ? undefined : pick.why === 'value' // B-078: as capable for less
          ? `${pick.entry.model.name} does this as well for less than ${pick.left.model.name}`
          : pick.why === 'stronger' // B-078: clearly more capable at the same or a higher price
            ? `${pick.entry.model.name} is stronger at ${categoryLabel(category)} than ${pick.left.model.name}`
            : `${pick.left.model.name} is weak at ${categoryLabel(category)}`; // like returnBlocked
        const decision = decide(pick.entry, 'rules', [fallbackReason, weak, `${categoryLabel(category)} · ${PERSON_TEXT}`].filter(Boolean).join(' · '), pick.kept);
        const fixed = policy.agentEffort !== undefined || decision.by === BY_REQUEST;
        return fixed ? decision : { ...decision, effort: clampEffort(personEffort(decision.effort), pick.entry.model.efforts) };
      }
    }

    // 5. The previous model continues unless it is weak for this work (or, after a change of work, far from the best).
    const previous = request.previous ? ranked.find((entry) => entry.model.id === request.previous!.modelId) : undefined;
    let switchNote: string | undefined;
    if (previous) {
      switchNote = returnBlocked({ previous, best: ranked[0], category, from: request.previous?.category });
      if (!switchNote) return decide(previous, fallbackReason ? 'fallback' : 'previous', [fallbackReason, `continues on the previous model · ${categoryLabel(category)}`].filter(Boolean).join(' · '), true);
    }

    // 6. The best score.
    const chosen = ranked[0];
    if (chosen.model.id === previous?.model.id) switchNote = undefined; // weak, but nothing better is allowed
    const reason = [fallbackReason, switchNote, `${categoryLabel(category)} · ${ruleReason(chosen, category, costMode)}`].filter(Boolean).join(' · ');
    return decide(chosen, fallbackReason ? 'fallback' : 'rules', reason, request.previous?.modelId === chosen.model.id);
  }
}

/** B-083: "my subconscious: <why>" when the request in force is my subconscious's (agents/next-route.ts returnChoice), else undefined. */
function subconsciousText(previous: RouteRequest['previous']): string | undefined {
  if (previous?.by !== 'subconscious') return undefined;
  const why = previous.why?.replace(/\s+/g, ' ').trim() ?? '';
  return why ? `my subconscious: ${why}` : 'my subconscious';
}

function ruleReason(entry: Ranked, category: string, costMode: CostMode): string {
  if (strengthOf(entry.model, category) >= 0.5) return 'strongest fit';
  if (costMode === 'economy') return 'best value';
  if (costMode === 'best' && entry.model.tier === 'frontier') return 'top tier';
  return 'best fit';
}
