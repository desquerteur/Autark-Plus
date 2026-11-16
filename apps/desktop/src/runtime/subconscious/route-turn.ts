// Unterbewusstsein v1 (14.11.2026, owner 13.11.: "wie schwierig ist diese Anfrage … ein gutes Modell für den ersten Turn … vordenken"): the
// look before a turn is one call, not a run. The cheap model reads who the agent is, the person's standing words about models and work
// (the start model with its effort and who set it, "What I have here" of its SYSTEM.md – review 14.11.: the person's word outweighs the
// call's weighing only when the call sees it), what wakes the turn (the person's message, a colleague's, else its task), the chat before
// it, what a switch costs right now and the models the turn can run on now – the router's own pool, per tier, with their strong and weak
// kinds of work (offeredModels, modelLines; the main AI's own models line stays as it is, for its cache) –, and sets the coming turn's
// model and effort – never 'none': thinking stays on (owner 09.11.) – as the subconscious's one-step request (agents/next-route.ts, by
// 'subconscious') – the router takes it before the person rule, a chat's suggestion or the previous model (router.ts
// step 2). A turn runs on one model, so the choice by its hardest part, before it starts, is the thinking ahead.
// E3 (.local/unterbewusstsein-20261113/e3-routing): on person turns too-weak picks 11 → 1 of 60; E4 (live): a switch on a warm cache cost more
// than it saved – so the switch cost is computed here from the last turn (CACHE_WARM_MS, CACHE_COLD_MS) and given as a fact, never assumed.
// The caller's signal is the turn's stop and its wait (service.ts ROUTE_WAIT_MS): an answer that comes after it sets nothing, so
// it never shapes a later turn. requestHolds runs first on every turn: a step this call set for an earlier message ends (a turn that
// never reached its engine leaves it stored), and a request of the agent itself (model.set) or of its task holds the turn's model and
// effort whole (review 14.11.: the call replaced such a request with its temperature) – the call then leaves out the route.
// v2 (owner 15.11.2026: "Es gibt nur das Unterbewusstsein", one call with its own system prompt; 13:27: the three-hits rule goes, the
// model condenses, no hand-off to a bigger model): the call the turn waits for also reads the word search's hits for what wakes the
// turn and opens the ones it chooses as the main AI's own calls (look.ts); one system prompt, ROUTE_SYSTEM, also explains the context.
// Beside it, on the same model and system prompt, condenseTurn reads the biggest items still whole in the agent's context and
// condenses those whose job is done – it does not hide (measured 15.11.: every value and critical item it lost beyond code's was a
// hide). Two calls at once, not one: with the items in it the call the turn waits for took 17–22 s instead of 7 (12 items) or
// 13 s (5), past the wait; the marks only reach the session at the next rebuild, so nothing needs them before the turn. The switch
// line also says whether another effort keeps the cache on the engine and model the agent ran on (effortKeepsCache, with its sources).
// Owns: these two calls, their prompts (turnFacts, standingWords, switchLine, offeredModels + modelLines) and the request. Never: waits longer than
// the caller allows, offers a model the router would not run for the turn, sets the effort 'none', or replaces a request of the agent's
// own or of its task.

import type { RouteRequest, RuntimeServices } from '../contracts.ts';
import type { Agent } from '../../shared/model/org.ts';
import type { Account, Effort, ModelInfo } from '../../shared/model/providers.ts';
import type { StructuredRunner } from '../decision/types.ts';
import { EFFORT_ORDER } from '../models/efforts.ts';
import { catalogModel, pendingRoute, setNextRoute, takeNextRoute, type NextRoute } from '../agents/next-route.ts';
import { CACHE_COLD_MS } from '../agents/rebuild.ts';
import { coreInstructions } from '../agent-core/prompt.ts';
import { splitAtHave } from '../org/hire.ts';
import { priceText, sourceOf, specialistKinds, strengthOverview } from '../routing/model-facts.ts';
import { chatChoice, effectivePolicy } from '../routing/policies.ts';
import { suggestionNow } from '../chat/suggestion-fresh.ts';
import { buildPool } from '../routing/pool.ts';
import { resolvePin, settingsPin } from '../routing/pins.ts';
import { resolveCategory } from '../routing/categories.ts';
import { isPaid, tierRank } from '../routing/score.ts';
import { dayText } from '../knowledge/age.ts';
import { profileZone } from '../context/time.ts';
import { languageName } from '../context/environment.ts';
import { askContext } from './exchange.ts';
import { contextItems, hitLines, itemLines, markItems, openHits, searchHits } from './look.ts';
import { MAIN_THREAD } from '../../shared/model/origin.ts';
import type { TraceCall } from '../../shared/model/subconscious.ts';

export const ROUTE_SYSTEM = `I am the main AI's subconscious. Before its coming turn I set the model and effort it runs on, open what it will need from its knowledge and keep its context lean. A turn runs on one model from what wakes it – the person's message, a colleague's or its task – to its reply, so I choose before it starts, by the hardest part the turn will meet: the work it sets going, not its length. The first reply often settles which reading and which path the next turns follow, so a weak start costs more than a strong model.

The model follows the kind of work:
- Small: something checkable against what is given, with nothing hanging on meaning or tone – navigating a mailbox, opening or clicking what is named, a status, a receipt or hand-over to take note of, a fact or a sum, going on after someone did their part, writing down an instruction for later.
- Middle: a long chain of careful steps on a way already set – going on with prepared work, working through a list, searching sources against given criteria, sorting by rules already given, a question of fact that needs looking up.
- Strongest: judgment – what the person meant when it can be read more than one way, a path nobody gave, a decision, a text people will read or keep, money or something that cannot be undone, code that has to work, a correction of the main AI's own mistake.

The effort follows what is still open: low for what can be checked against what is given; medium for a clear step on a set way whose result shows at once; high – the normal for real work – wherever meaning, tone or a choice matters; xhigh for code across several parts, a bug of unknown cause, a design choice, edge cases that must hold, or a result the person was unhappy with; max where xhigh fell short. One level up when the message can be misread, a miss would be seen or cost real money, or several things must fit together; one down when it is one of many identical steps or its result is checked right away.

What the person said about models or how to work – in this chat, in the agent's standing facts and agreements, or with the start model and effort they set – outweighs my weighing. A model the person picked in this chat for their newest message is what they want now: my start, which I leave only for a clear reason. One they suggested earlier and left standing is a hint from before – the work decides.
Staying on the model the agent runs on is my default, and the effort is what I turn first: another model first reads the whole context uncached at its own input price. What that costs right now is stated below – on a cold cache any model reads uncached, so the choice is free; on a warm one a switch is worth it only for a stretch of work that clearly needs another kind of model: real judgment coming after routine, or the reverse – a strong model about to carry on with plenty of routine that does not need it, which I move back down. One turn's nuance is no reason. A turn takes about 6 model calls, so the model's price counts six times over.

A word search ran over the agent's knowledge – its memory, skills, references, documents and the secrets catalog (names and handles, never values) – with the words of what wakes the turn; its hits stand below with how each begins. An entry I open reaches the main AI before it starts and stays in its context, paid again on every later call. So I open an entry only when I can say what it changes in this turn – a rule it has to follow, a fact it has to use, a way of working it would otherwise get wrong, the login or key it will sign in or work with – and I say that with it. A hit on the same topic that changes nothing in what the turn does stays closed; most messages need none, and the main AI can still search for itself.

Everything in the main AI's context is paid again on every later model call and dilutes its attention, so I keep it lean; the biggest items still whole in it stand below. An item is still needed while the coming work will read it again or act on something that stands only there. Its job is over once what it was for went into what came after – the main AI's answer, a file it wrote, a later status that replaced it, a step that is done –, however long the task it belongs to still runs: that its topic is still open does not tell. Such an item I condense: in its place stays my note of what still matters from it – a result, a decision, an open point, in a few words –, code adds every id, path, file name and link in it, and a stamp brings the original back, so nothing I set aside loses what later work may look up. A skill or instruction the coming work still follows stays. What I leave, code condenses once its work is finished.

I answer with the JSON asked for: the hardest part in a few words, whether it can be misread, whether a path must be chosen, the model (its name exactly as listed), the effort, and why in one short sentence in the language the person writes in; then the hits I open, each with what it changes, and the items I condense, each with my note – by their ids, empty where nothing fits.`;

const PROMPT_CHARS = 4000;
const WHY_CHARS = 200;
/** At most this much of "What I have here" (the largest of the 6 live parts 14.11.2026: 15,183 characters – each is read whole). */
const STANDING_CHARS = 16_000;
/** The efforts the call sets: every one with thinking (owner 09.11.: thinking is never turned off). */
const EFFORTS: readonly Effort[] = EFFORT_ORDER.filter((effort) => effort !== 'none');
/** What wakes the turn, as the prompt names it. */
const WAKE_LABEL = { person: "The person's new message:", colleague: "The colleague's message that wakes the main AI:", task: 'The task that wakes the main AI:' } as const;
/** The agent's newest runs the prompt's lines read for its last turn. */
const RECENT_RUNS = 50;
/** Within this time after the last call a provider's prompt cache is still there (Anthropic's default life 5 min, OpenAI's in-memory cache 5–10 min); up to CACHE_COLD_MS it may be (review 14.11.). */
const CACHE_WARM_MS = 5 * 60_000;

/** At most this many models per tier in the call's list (the smartest of each), so the strongest, middle and small kinds all show. */
const PER_TIER = 4;

/** What the call reads to choose: the turn's mode, the text that wakes it (its kind of work), whether it shows an image, its chat. */
export interface TurnWork { mode?: string; text: string; vision?: boolean; conversationId?: string }

/** A model the call can name, with the account the router runs it on (how a turn is paid). */
export interface Offer { model: ModelInfo; account: Account }

/**
 * The models the call can name: the router's own pool for this turn (routing/pool.ts buildPool – connected and healthy now, its needs
 * met, inside the policy's bounds and the mode's tier, a paying key only where the router spills over to one), so each name it gives is
 * one the turn runs (re-review 14.11.: a name from a wider list – a cooling key's twin, a paid one – left the turn where it was). One
 * model per name, a plan's before a paying key's; per tier the PER_TIER smartest, the strongest tier first – and always the models the
 * person or the work already stand on: `start`, what the router runs with no request (the agent's start model, even outside the band,
 * router.ts step 1; else the Work model of Settings, step 3), the chat's suggestion and the model of my last turn (review 14.11.: past
 * the cap the call had to name another and overrode the person's start model) – a last turn on an older version offers its family's
 * newest instead (owner 14.11.: never Fable 5.1 while 5.2 runs; routing/pool.ts entryFor).
 */
export function offeredModels(services: RuntimeServices, agent: Agent, work: TurnWork): { offers: Offer[]; start?: ModelInfo } {
  try {
    let mode: ReturnType<RuntimeServices['modes']['get']> | undefined;
    try { mode = work.mode ? services.modes.get(work.mode) : undefined; } catch { mode = undefined; } // an unknown mode: no tier, its kind from the text
    const models = services.catalog.list();
    const category = resolveCategory(mode?.category, work.text);
    const policy = effectivePolicy(services, agent);
    const pool = buildPool({ s: services, models, category, policy, ...(work.vision ? { needs: { vision: true } } : {}), ...(mode?.minTier ? { minTier: mode.minTier } : {}) });
    const entries = pool.entries.filter((entry) => !specialistKinds(entry.model));
    /** `newest`: an older version offers its family's newest (my last turn on it); the person's chip offers its own model. */
    const inPool = (id: string | undefined, newest = false): Offer | undefined => {
      const named = id ? resolvePin(models, id) : undefined;
      if (!named || specialistKinds(named)) return undefined;
      const entry = newest ? pool.entryFor(named) : entries.find((item) => item.model.id === named.id);
      const account = entry ? entry.accounts[0] : !newest && !pool.unusable(named) && pool.inBand(named) ? pool.accountsFor(named)[0] : undefined;
      return account ? { model: entry?.model ?? named, account } : undefined;
    };
    // The router runs the start model as tryPin does – usable and with an account, the band aside; the Work model inside the band.
    const pinned = policy.pin ? resolvePin(models, policy.pin.modelId) : undefined;
    const pinAccount = pinned && !pool.unusable(pinned) ? pool.accountsFor(pinned)[0] : undefined;
    const startOffer = pinned && pinAccount ? { model: pinned, account: pinAccount } : !policy.pin ? inPool(settingsPin(services.settings.get().routing, { agent } as RouteRequest)?.modelId) : undefined;
    const chip = (() => { try { return chatChoice(services, work.conversationId, agent.id).pin; } catch { return undefined; } })();
    const last = (() => { try { return services.runs.list(agent.id, RECENT_RUNS).find((run) => !run.splitId && run.model)?.model; } catch { return undefined; } })();
    const anchors = [startOffer, inPool(chip), inPool(last, true)].filter((offer): offer is Offer => offer !== undefined);
    const ranked = entries.map((entry) => ({ model: entry.model, account: entry.accounts[0] }))
      .sort((a, b) => Number(isPaid(a.account)) - Number(isPaid(b.account)) || tierRank(b.model.tier) - tierRank(a.model.tier) || (b.model.smarts ?? -1) - (a.model.smarts ?? -1));
    const names = new Set<string>();
    const perTier = new Map<string, number>();
    const kept: Offer[] = [];
    for (const offer of anchors) {
      if (names.has(offer.model.name)) continue;
      names.add(offer.model.name);
      kept.push(offer);
    }
    for (const offer of ranked) {
      if (names.has(offer.model.name) || (perTier.get(offer.model.tier) ?? 0) >= PER_TIER) continue;
      names.add(offer.model.name);
      perTier.set(offer.model.tier, (perTier.get(offer.model.tier) ?? 0) + 1);
      kept.push(offer);
    }
    const offers = kept.sort((a, b) => tierRank(b.model.tier) - tierRank(a.model.tier) || (b.model.smarts ?? -1) - (a.model.smarts ?? -1));
    return { offers, ...(startOffer ? { start: startOffer.model } : {}) };
  } catch {
    return { offers: [] };
  }
}

/**
 * The call's list of the models it can name – one line each with tier, price, smarts, how a turn is paid on the account the router runs
 * it on and what it is strong and weak at (routing/model-facts.ts: the main AI's own models line stays as it is, for its cache).
 */
export function modelLines(offers: readonly Offer[]): string {
  if (!offers.length) return '';
  const lines = offers.map(({ model, account }) => `- ${[model.name, model.tier, priceText(model), model.smarts !== undefined ? `smarts ${model.smarts}` : undefined, sourceOf(model, account), strengthOverview(model)].filter(Boolean).join(' · ')}`);
  return ['The models the turn can run on now (tier · $ in/out per 1M tokens · smarts 0–100 · how a turn is paid · fit -1…+1 per kind of work); a plan costs nothing per turn while its quota lasts, an API key pays every token:', ...lines].join('\n');
}

/**
 * The person's standing words as the agent keeps them: its own facts – "What I have here" of its SYSTEM.md to the end, as the app splits
 * it (org/hire.ts splitAtHave), with the parts and subheadings each agent sorts them into (agreements, ways of working, model wishes,
 * not by day); whole, as the main AI reads it every turn (reviews 14.11.: a cut by position or at the next heading lost live model
 * lines), within STANDING_CHARS; '' without that part.
 */
export function standingWords(services: RuntimeServices, agent: Agent): string {
  try {
    const { tail } = splitAtHave(coreInstructions(services, agent).replace(/\r\n?/g, '\n'));
    const part = tail.split('\n').slice(1).map((line) => line.trimEnd()).filter((line) => line.trim()).join('\n'); // without its heading
    const text = part.length > STANDING_CHARS ? `${part.slice(0, STANDING_CHARS)} …` : part;
    try { return services.secrets.redact(text); } catch { return text; }
  } catch {
    return '';
  }
}

/** A task's request ends with the task (done, dropped or gone), as planTurn reads it. */
const finished = (services: RuntimeServices) => (taskId: string): boolean => {
  const status = services.tasks.get(taskId)?.status;
  return !status || status === 'done' || status === 'dropped';
};

/**
 * Before my call, on every turn: a step I set for an earlier message ends here (it was that message's); then true when the agent's own
 * request (model.set) or its task's is in force – that choice is the main AI's or its delegator's, and the turn runs on it whole.
 */
export function requestHolds(services: RuntimeServices, agentId: string, taskId: string | undefined): boolean {
  const step = pendingRoute(services.db, agentId, undefined, () => false);
  if (step?.by) takeNextRoute(services.db, agentId, step.stepAt);
  return pendingRoute(services.db, agentId, taskId, finished(services)) !== undefined;
}

/** ' The person writes in German.' – their profile's language, which the AI keeps to the one they speak; '' without one. */
function personLanguage(services: RuntimeServices): string {
  try {
    const code = services.settings.get().profile?.language?.trim();
    return code ? ` The person writes in ${languageName(code)}.` : '';
  } catch {
    return '';
  }
}

/** A route's parts as a line: model · effort · temperature. */
function routeParts(services: RuntimeServices, value: { modelId?: string; effort?: string; temperature?: number }): string {
  const model = value.modelId ? services.catalog.get(value.modelId)?.name ?? value.modelId : '';
  return [model, value.effort ? `effort ${value.effort}` : '', value.temperature !== undefined ? `temperature ${value.temperature}` : ''].filter(Boolean).join(' · ');
}

/**
 * F22 (owner 16.11.2026): the person's suggestion as the routing call reads it – picked since their line before their newest one
 * (or after their newest one) is what they want now, one that stayed is a hint from before (chat/suggestion-fresh.ts).
 */
function suggestionFact(person: string, suggested: string, when: ReturnType<typeof suggestionNow>): string {
  if (when === 'earlier') return `${person} suggested ${suggested} in this chat earlier and left it standing – a hint from before, the work decides; it runs when I set it`;
  return `${person} picked ${suggested} in this chat ${when === 'now' ? 'for their newest message' : 'after their newest message'} – what they want now, left only for a clear reason; it runs when I set it`;
}

/**
 * B-083: the line the call reads about how the coming turn runs – the model of my last turn (any chat: one context), the start model with
 * the agent's fixed effort and who set it (without one of the agent's own, the Work model the person chose in Settings – review 14.11.),
 * and the person's suggestion in this chat; '' when nothing is known.
 */
export function turnFacts(services: RuntimeServices, agent: Agent, conversationId: string | undefined): string {
  try {
    const last = services.runs.list(agent.id, RECENT_RUNS).find((item) => !item.splitId && item.model);
    const policy = agent.modelPolicy;
    const pin = policy?.pin;
    const setBy = pin && policy?.pinBy ? ` (set by ${policy.pinBy.self ? 'itself' : policy.pinBy.name}, ${dayText(policy.pinBy.at, profileZone(services))})` : '';
    const work = !pin ? settingsPin(services.settings.get().routing, { agent } as RouteRequest)?.modelId : undefined;
    const start = routeParts(services, { modelId: pin ?? work, effort: policy?.effort });
    const startText = pin ? `start model ${start}${setBy}` : work ? `start model ${start} (the Work model in Settings)` : `start model chosen per task${policy?.effort ? ` · effort ${policy.effort}` : ''}`;
    const parts = [last?.model ? `runs on ${routeParts(services, { modelId: last.model, effort: last.effort, temperature: last.route?.temperature })}` : 'no turn yet', startText];
    const chip = chatChoice(services, conversationId, agent.id);
    const suggested = routeParts(services, { modelId: chip.pin, effort: chip.effort, temperature: chip.temperature });
    if (suggested) parts.push(suggestionFact(services.settings.get().profile?.name?.trim() || 'the person', suggested, suggestionNow(services, conversationId, agent.id))); // 13.11.2026: the chip is information, never a route
    return `The main AI's coming turn: ${parts.join('; ')}.`;
  } catch {
    return '';
  }
}

/**
 * Whether another effort keeps the prompt cache on the engine and model of the main AI's last turn (sources read 15.11.2026). Claude
 * Code – each Autark turn starts it with --resume and --effort – keeps it on Fable 5.1 and later, Opus 5.5, Sonnet 5.5 and Haiku 5.5 with
 * a plan or key; on other models each effort has its own cache (code.claude.com/docs/en/prompt-caching, "Changing effort level"; the API
 * does it with a per-message effort, platform.claude.com/docs/en/build-with-claude/effort-per-message). Codex keeps it on GPT-6 models
 * (E4 14.11.: Sol medium → high on the app server, 99 % cached; OpenAI keeps the prefix with a configuration_update item,
 * developers.openai.com/api/docs/guides/prompt-caching). Our own API engines put the effort at the top of each request, where it shapes
 * the rendered prompt (the same two docs): another effort reads the context uncached. Undefined where nothing is known.
 */
export function effortKeepsCache(engine: string | undefined, modelId: string): boolean | undefined {
  const model = modelId.slice(modelId.indexOf(':') + 1);
  if (engine === 'claude') return /^claude-(?:(?:opus|sonnet|haiku)-5-5|(?:fable|mythos)-(?:5-[1-9]|[6-9]))/.test(model);
  if (engine === 'codex') return /^gpt-(?:[6-9]|\d{2,})/.test(model) ? true : undefined;
  if (engine === 'anthropic' || engine === 'openai') return false;
  return undefined;
}

/**
 * What a switch costs now: cold (any model reads uncached), maybe warm, or warm (the last turn's model holds the cache; another reads the
 * context uncached first) – and on a cache that may hold, whether another effort keeps it there (effortKeepsCache).
 */
export function switchLine(services: RuntimeServices, agent: Agent, now: number): string {
  try {
    const last = services.runs.list(agent.id, RECENT_RUNS).find((run) => !run.splitId && run.model && (run.endedAt ?? run.startedAt));
    if (!last?.model) return 'What a switch costs now: the main AI has no turn yet – any model costs the same.';
    const since = now - (last.endedAt ?? last.startedAt ?? 0);
    const ago = Math.max(0, Math.round(since / 60_000));
    const name = services.catalog.get(last.model)?.name ?? last.model;
    const perCall = last.inputTokens && last.modelCalls ? Math.round(last.inputTokens / last.modelCalls / 1000) : undefined;
    const size = perCall ? `about ${perCall}k tokens per call` : 'its context';
    if (since > CACHE_COLD_MS) return `What a switch costs now: nothing – the main AI's last turn ended ${ago} min ago, its cache is cold, any model reads ${size} uncached.`;
    const ran = `the main AI's last turn ran ${ago} min ago on ${name}${last.effort ? ` · ${last.effort}` : ''}`;
    const keeps = effortKeepsCache(last.engine, last.model);
    const effort = keeps === true ? ` Another effort on ${name} keeps it.` : keeps === false ? ` Another effort on ${name} reads it uncached too, like another model.` : '';
    if (since > CACHE_WARM_MS) return `What a switch costs now: ${ran}; its context (${size}) may still be cached on it – a provider keeps a cache from about 5 minutes to an hour. Staying may keep that cache; another model first reads it once uncached at its own input price.${effort}`;
    return `What a switch costs now: ${ran}; its context (${size}) is still cached on it. Staying keeps that cache; another model first reads it once uncached at its own input price.${effort}`;
  } catch {
    return '';
  }
}

/** What the call before a turn did: the route line it set (none: it set no route) and the hits it opened as the main AI's calls. */
export interface Look { line?: string; calls: TraceCall[] }

/** The prompt's line where a request of the agent's own or of its task holds the turn (requestHolds): the call leaves model and effort. */
const HELD_LINE = "The main AI's coming turn runs on the model and effort its own request (or its task's) set – I leave them.";

/** What both calls read about the turn: who works, the standing words, `facts` (the route call's line), the chat before and what wakes it. */
function promptHead(services: RuntimeServices, input: { agent: Agent; conversationId?: string; said: string; from?: keyof typeof WAKE_LABEL }, facts: string): string[] {
  const { agent } = input;
  const standing = standingWords(services, agent);
  return [
    `Agent: ${agent.name}${agent.role ? ` – ${agent.role}` : ''}${agent.mode ? ` (mode ${agent.mode})` : ''}.${personLanguage(services)}`,
    ...(standing ? ['What the agent has here – its standing facts and agreements (its SYSTEM.md):', standing, ''] : []), // the same each turn: early, so it is read from cache
    ...(facts ? [facts, ''] : []),
    'The chat before (oldest first):',
    askContext(services, { agentId: agent.id, conversationId: input.conversationId, context: 'recent' }) || '(nothing)',
    '',
    WAKE_LABEL[input.from ?? 'person'],
    input.said.length > PROMPT_CHARS ? `${input.said.slice(0, PROMPT_CHARS)} …` : input.said,
  ];
}

/**
 * The route of an answer as the subconscious's one-step request with its why; 'model · effort', or undefined when it names neither.
 * The model the router runs with no request (the start model, else the Work model): only my effort is mine – it runs as the person set it.
 */
function takeRoute(services: RuntimeServices, agent: Agent, answer: { model?: unknown; effort?: unknown; why?: unknown; hardest?: unknown }, work: readonly ModelInfo[], start: ModelInfo | undefined): string | undefined {
  const named = String(answer.model ?? '');
  const info = work.find((item) => item.name === named) ?? (named ? catalogModel(services.catalog, named) : undefined);
  const model = info && typeof info !== 'string' && work.some((item) => item.id === info.id) ? info : undefined; // one the turn runs
  const effort: Effort | undefined = EFFORTS.find((item) => item === String(answer.effort ?? '').toLowerCase());
  if (!model && !effort) return undefined;
  const kept = model !== undefined && model.id === start?.id;
  const why = String(answer.why ?? answer.hardest ?? '').replace(/\s+/g, ' ').trim().slice(0, WHY_CHARS);
  const line = `${model?.name ?? 'same model'} · ${effort ?? 'same effort'}`; // its why stays on the run's route: the log carries no chat content
  if (kept && !effort) return line;
  const value: NextRoute = { ...(model && !kept ? { modelId: model.id } : {}), ...(effort ? { effort } : {}), ...(why ? { reason: why } : {}), by: 'subconscious', at: services.clock.now() };
  setNextRoute(services.db, agent.id, value);
  return line;
}

/** The route call's answer: the route (unless a request holds the turn) and the hits to open, each with what it changes. */
function lookSchema(names: readonly string[], hits: readonly string[]) {
  const properties: Record<string, unknown> = {};
  if (names.length) {
    Object.assign(properties, {
      hardest: { type: 'string' }, misread: { type: 'boolean' }, decide: { type: 'boolean' },
      model: { type: 'string', enum: [...names] }, effort: { type: 'string', enum: [...EFFORTS] }, why: { type: 'string' },
    });
  }
  if (hits.length) properties.open = { type: 'array', items: { type: 'object', properties: { id: { type: 'string', enum: [...hits] }, changes: { type: 'string' } }, required: ['id', 'changes'], additionalProperties: false } };
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

/**
 * The call the turn waits for (v2, 15.11.2026): the coming turn's model and effort as the subconscious's request – not while a request
 * of the agent's own or of its task holds the turn (`held`) – and the word search's hits it opens (look.ts openHits). No call without
 * anything to choose. Undefined when no call ran, it failed or the turn stopped waiting. Never throws.
 */
export async function routeTurn(services: RuntimeServices, runner: StructuredRunner, input: { agent: Agent; conversationId?: string; thread?: string; said: string; from?: keyof typeof WAKE_LABEL; mode?: string; vision?: boolean; held?: boolean; signal?: AbortSignal; deadlineMs: number }): Promise<Look | undefined> {
  try {
    const { agent } = input;
    const mode = input.mode ?? agent.mode;
    const looked = { agent, thread: input.thread ?? MAIN_THREAD, ...(input.conversationId ? { conversationId: input.conversationId } : {}), ...(mode ? { mode } : {}) };
    const { offers, start } = input.held ? { offers: [] as Offer[], start: undefined } : offeredModels(services, agent, { mode, text: input.said, ...(input.vision ? { vision: true } : {}), ...(input.conversationId ? { conversationId: input.conversationId } : {}) });
    const work = offers.map((offer) => offer.model);
    const names = work.map((model) => model.name);
    const hits = await searchHits(services, { ...looked, text: input.said, ...(input.signal ? { signal: input.signal } : {}) });
    if ((!names.length && !hits.length) || input.signal?.aborted) return undefined;
    const now = services.clock.now();
    const prompt = [
      ...promptHead(services, input, input.held ? HELD_LINE : names.length ? turnFacts(services, agent, input.conversationId) : ''),
      ...(hits.length ? ['', hitLines(hits)] : []),
      ...(names.length ? ['', switchLine(services, agent, now), modelLines(offers)] : []),
    ].join('\n');
    const reply = await runner({ purpose: 'subconscious', system: ROUTE_SYSTEM, prompt, schema: lookSchema(names, hits.map((hit) => hit.id)), effort: 'low', deadlineMs: input.deadlineMs, ...(input.signal ? { signal: input.signal } : {}) });
    if (input.signal?.aborted) return undefined; // the turn runs already, or was stopped
    const answer = (reply.structured ?? JSON.parse(reply.text)) as { model?: unknown; effort?: unknown; why?: unknown; hardest?: unknown; open?: unknown };
    const line = names.length ? takeRoute(services, agent, answer, work, start) : undefined;
    const calls = hits.length && Array.isArray(answer.open) ? await openHits(services, looked, answer.open, hits) : [];
    return { ...(line ? { line } : {}), calls };
  } catch (error) {
    try { services.log.debug('subconscious look failed', { error: String(error) }); } catch { /* nothing to report to */ }
    return undefined;
  }
}

/**
 * The call beside the turn (v2, 15.11.2026): the biggest items still whole in the agent's context (look.ts contextItems), the ones it
 * condenses marked with its note (look.ts markItems). The turn does not wait for it – its marks reach the session at the next rebuild
 * anyway (measured 15.11.: with the items in the route call the turn waited 17–22 s instead of 7). Returns how many it condensed
 * (0 without items or on failure). Never throws.
 */
export async function condenseTurn(services: RuntimeServices, runner: StructuredRunner, input: { agent: Agent; conversationId?: string; thread?: string; said: string; from?: keyof typeof WAKE_LABEL; signal?: AbortSignal; deadlineMs: number }): Promise<number> {
  try {
    const thread = input.thread ?? MAIN_THREAD;
    const items = contextItems(services, input.agent.id, thread);
    if (!items.length || input.signal?.aborted) return 0;
    const ids = items.map((entry) => entry.item.itemId);
    const prompt = [...promptHead(services, input, ''), '', itemLines(items, services.clock.now())].join('\n');
    const schema = { type: 'object', properties: { condense: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', enum: ids }, note: { type: 'string' } }, required: ['id', 'note'], additionalProperties: false } } }, required: ['condense'], additionalProperties: false };
    const reply = await runner({ purpose: 'subconscious', system: ROUTE_SYSTEM, prompt, schema, effort: 'low', deadlineMs: input.deadlineMs, ...(input.signal ? { signal: input.signal } : {}) });
    if (input.signal?.aborted) return 0; // stopped
    const answer = (reply.structured ?? JSON.parse(reply.text)) as { condense?: unknown };
    return markItems(services, input.agent.id, thread, items, answer.condense);
  } catch (error) {
    try { services.log.debug('subconscious condense failed', { error: String(error) }); } catch { /* nothing to report to */ }
    return 0;
  }
}
