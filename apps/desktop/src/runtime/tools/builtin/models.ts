// Model knowledge and self-routing for agents (RT4, RT2): models.list compares the models the calling
// agent may use for a kind of work (routing/model-list.ts; decisions and embeddings: what answers them now and the
// models made for them), and a manager can pick a pin for
// agents.update; model.set (moved here from skills.ts, B-048) asks for the next step's or the task's model.
// Both are core tools (tools/registry.ts), offered in every mode.
// B-048 E4.2 – model by need: model.set takes a need (stronger, cheaper, faster, vision, long_context –
// routing/need.ts) or a concrete model, and/or an effort. A need is resolved by the router (a preview
// route like the next turn's, the decision model breaking near-ties) and the answer names the model it
// will be; the request keeps the need, the model it ran on and that model (agents/next-route.ts), so
// the turn's router resolves it again within the same bounds. B-083 D1/D4/D5: a model is found by the one lookup (also
// "GPT-6 Luna" for "GPT-6-Luna"; cheap / strong are the needs cheaper / stronger), any effort is stored as asked (the
// router clamps it, the answer shows the clamped one), and a named model that cannot run now is answered with `instead`
// (its route's reason leads with why) – a task request stays until it runs, my running turn stays where it is.
// now: true hands the new model to the running turn
// (Dispatcher.continueNow with the target: B-080, the same engine switches inside the turn from its next step; another
// engine cuts the turn at the next tool boundary and continues at once on the new route; B-083 review: with a temperature
// the model takes it always cuts – a running turn keeps its temperature, the new turn takes the stored request with it).
// B-078 (D16): model.set also takes a temperature (0..2), kept like the effort (agents/next-route.ts) and sent by the
// engines that take one (engines/http/temperature.ts reads the adapters' rules, B-083 with the effort: compatible except
// Gemini 3+, OpenAI without reasoning or at effort none, the Anthropic API on the older Claude models that run without
// thinking anyway – owner 09.11.: thinking is never turned off for it); where it does not reach, the answer says where it
// does (TEMPERATURE_FACT).
// B-080 (live 07.11.: Jonas's model.set for a step got "My model is pinned by my manager."): my own agent pin is my
// default, and model.set picks another for a step or a task (the router lets my request beat it, B-079).
// B-083 (owner 08.11.: "nur … ein kleiner Tipp"; 13.11.2026: "einfach nur da, wird der KI so erklärt"): the person's
// suggestion in a chat is information on their line (context/render.ts suggestionTag), never a route – what I ask for here
// runs my next turn; when it leaves their suggestion, the answer names it in one line (whose suggestion I leave). How to weigh a step stands in the standard SYSTEM.md (resources/prompts/standard-*.md).
// B-083 Ultra: a part (ctx.split) has no next turn – its request is never stored under (agent, no chat), it acts inside
// the part's turn (always tried as now) or not at all; its answer says which (integration review: never "next turn", never
// a temperature its running turn does not take, never a new turn).
// B-080 (live 07.11.: Jonas's and Nora's "for: task" got "This turn has no task"; "extra high" claimed while every run
// stayed medium): `task` names the task (this turn's by default) and implies for: "task" – the request holds on every
// turn of mine on it, in whichever chat it runs; every call previews where the work runs (the task's chat, mode and id,
// else this turn's) and answers with the model and effort that route names.
// B-080 review: a colleague's task other than this turn's is answered as that fact with nothing stored (my request reaches
// my own turns; theirs read their own), and now: true switches the running turn only for its own work – a request for another task holds
// from that task's next turn.
// Owns: the models.list and model.set definitions. Never: changes routing state beyond the agent's own
// request, lists or picks chat models outside the calling agent's model policy band, cuts a turn without now, or moves my
// running turn onto a model I did not name (D1).

import type { ToolContext, ToolDef } from '../types.ts';
import { failure, json, text } from '../types.ts';
import type { RouteRequest } from '../../contracts.ts';
import type { ModeInfo } from '../../../shared/model/knowledge.ts';
import type { Effort, RouteDecision } from '../../../shared/model/providers.ts';
import { CATEGORIES } from '../../models/priors.ts';
import { categoryLabel } from '../../routing/categories.ts';
import { modelList } from '../../routing/model-list.ts';
import { chatChoice } from '../../routing/policies.ts';
import { MODEL_NEEDS, NO_FIT_TEXT, needMet, type ModelNeed } from '../../routing/need.ts';
import { catalogModel, modelWord, onModel, returnRun, setNextRoute, setTaskRoute, type NextRoute } from '../../agents/next-route.ts';
import { personName } from '../../agents/publishing.ts';
import { TEMPERATURE_FACT, takesTemperature } from '../../engines/http/temperature.ts'; // B-083: the fact lives beside its rule
import { HUMAN_ID } from '../../../shared/ids.ts';
import { clip, defineTool, internal } from './util.ts';

const listModels = defineTool<{ category?: string; includeUnavailable?: boolean }>({
  name: 'models.list',
  description: 'Compares the models I can use, best first for a kind of work. Each with tier, source, efforts, fit, price per 1M tokens and smarts 0–100; I ask for one with model.set.',
  inputSchema: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: [...CATEGORIES], description: "Default my mode's; decision and embeddings show what answers those now." },
      includeUnavailable: { type: 'boolean', description: 'Also those that cannot run now, with why.' },
    },
    additionalProperties: false,
  },
  category: 'read',
  describe: (args) => internal(`List models${args.category ? ` for ${categoryLabel(args.category)}` : ''}`),
  async run(args, ctx) {
    const catalog = ctx.services.catalog;
    // Fresh install: the catalog may not be built yet (refresh is coalesced and throttled).
    if (!catalog.list().some((model) => model.available)) await catalog.refresh().catch(() => undefined);
    let mode: Pick<ModeInfo, 'category' | 'minTier'>;
    try { mode = ctx.services.modes.get(ctx.mode); } catch { mode = { category: 'chat' }; }
    return text(modelList({
      services: ctx.services, agent: ctx.agent, mode,
      category: args.category, includeUnavailable: args.includeUnavailable,
    }));
  },
});

const EFFORTS: Effort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
const NEED_WORDS: Record<ModelNeed, string> = { stronger: 'a stronger model', cheaper: 'a cheaper model', faster: 'a faster model', vision: 'a model that reads images', long_context: 'a longer context' };
/** Runs read for the choice a turn returns to (as planTurn reads them, agents/turn-prepare.ts). */
const RETURN_RUNS = 50;

interface SetArgs { model?: string; need?: ModelNeed; effort?: Effort; temperature?: number; for?: 'next_step' | 'task'; task?: string; now?: boolean; reason?: string }
type Previous = NonNullable<RouteRequest['previous']>;
/** `on` (D1): the model the work is on – where its turn stays while a model I name cannot run (agents/next-route.ts onModel). */
type Base = { modelId?: string; effort?: Effort; category?: string; on?: string };

/** The one sentence about where a temperature reaches, in model.set's answer when it does not reach the step's model
 *  (first person, no rule; engines/http/temperature.ts decides per model and effort, as the adapters send it, and holds it). */
export { TEMPERATURE_FACT };

/** B-080: what model.set says without a task to hold the request for. */
export const NO_TASK_TEXT = 'This turn has no task of mine – I name it with task: "<id>" (tasks.list), or keep it for my next step here.';

/** What the calling run runs on now (the dispatcher's activity, B-048 E4.5), else the tool context's model. */
function current(ctx: ToolContext): { modelId?: string; effort?: Effort } {
  let row: { model?: string; effort?: Effort } | undefined;
  try { row = ctx.services.dispatcher?.activity().find((item) => item.runId === ctx.runId); } catch { row = undefined; }
  return { modelId: ctx.modelId ?? row?.model, effort: row?.effort };
}

/** B-080: where the work a request shapes runs – the task's chat and id (the mode is my own); for the next step this turn's. */
interface Place { conversationId?: string; mode: string; taskId?: string; text?: string }

function placeOf(ctx: ToolContext, taskId: string | undefined): Place {
  const id = taskId ?? ctx.taskId;
  let task: { title: string; notes: string; conversationId?: string; mode?: string } | undefined;
  try { task = id ? ctx.services.tasks.get(id) : undefined; } catch { task = undefined; }
  const text = task ? `${task.title}\n${task.notes}` : undefined;
  if (!taskId) return { conversationId: ctx.conversationId, mode: ctx.mode, taskId: ctx.taskId, text };
  return { conversationId: task?.conversationId, mode: ctx.mode, taskId, text };
}

/**
 * What that work's next turn returns to, by RT2's return rule (agents/next-route.ts returnRun): my next step and the task this run works
 * on – this run (the model I am on); another task (`taskId`) – its newest done run, else my last done run no request shaped; `on` (D1)
 * is that same run's model for another task, else the model I am on.
 */
function baseOf(ctx: ToolContext, from: { modelId?: string; effort?: Effort }, taskId: string | undefined): Base {
  if ((!taskId || taskId === ctx.taskId) && from.modelId) return { ...from, on: from.modelId };
  try {
    const runs = ctx.services.runs.list(ctx.agent.id, RETURN_RUNS);
    const last = returnRun(runs, taskId ? 'task' : 'step', taskId);
    const on = taskId ? last?.model : onModel(runs);
    const base = last?.model ? { modelId: last.model, effort: last.effort ?? 'medium', ...(last.route?.category ? { category: last.route.category } : {}) } : {};
    return { ...base, ...(on ? { on } : {}) };
  } catch { return from; }
}

/** RouteRequest.previous of that turn with this request on it (agents/next-route.ts returnChoice's shapes). */
function previousOf(args: SetArgs, modelId: string | undefined, from: { modelId?: string }, base: Base): Previous | undefined {
  const category = base.category ? { category: base.category } : {};
  if (modelId || args.need) {
    return {
      modelId: modelId ?? from.modelId ?? base.modelId ?? '', effort: args.effort ?? base.effort ?? 'medium', explicit: true, ...(args.effort ? {} : { asked: 'model' as const, ...category }),
      ...(args.need ? { need: { kind: args.need, ...(from.modelId ? { from: from.modelId } : {}) } } : {}),
      ...(modelId && base.on && base.on !== modelId ? { from: base.on } : {}), // D1: the preview's "model it is on" is the turn's
    };
  }
  if (args.effort) return { modelId: base.modelId ?? '', effort: args.effort, explicit: true, asked: 'effort', ...category };
  return base.modelId ? { modelId: base.modelId, effort: base.effort ?? 'medium', ...category } : undefined;
}

/** The route the work's next turn would take with this request: the router's own rules, one preview (no state changes). */
async function preview(ctx: ToolContext, place: Place, previous: Previous | undefined): Promise<RouteDecision> {
  let mode: ModeInfo;
  try { mode = ctx.services.modes.get(place.mode); } catch { mode = { key: place.mode, category: 'chat' } as ModeInfo; }
  return ctx.services.router.route({
    agent: ctx.agent, conversationId: place.conversationId, taskId: place.taskId, mode, ...(place.text ? { text: place.text } : {}), ...(previous ? { previous } : {}),
  });
}

const setModel = defineTool<SetArgs>({
  name: 'model.set',
  description: 'Sets the model, effort or temperature for my next turn, a task, or right now. A new model, and on Claude a new effort, rereads my whole context, so a change fits where something starts fresh or a step needs clearly more.',
  inputSchema: {
    type: 'object',
    properties: {
      need: { type: 'string', enum: [...MODEL_NEEDS] }, model: { type: 'string', description: 'An id from models.list, or cheap / strong.' }, effort: { type: 'string', enum: EFFORTS },
      temperature: { type: 'number', minimum: 0, maximum: 2, description: '0–2; only models that take one.' },
      for: { type: 'string', enum: ['next_step', 'task'], description: 'next_step (default) or task: every turn on it until done.' },
      task: { type: 'string', minLength: 1, maxLength: 120, description: "Default this turn's task." },
      now: { type: 'boolean', description: 'true: my running turn goes on with it, else a new turn at once.' }, reason: { type: 'string', maxLength: 300 },
    },
    additionalProperties: false,
  },
  category: 'think',
  describe: (args) => internal(`${args.task ? `Task ${args.task}` : args.for === 'task' ? 'This task' : 'Next step'} on ${args.need ? NEED_WORDS[args.need] ?? args.need : args.model ?? 'same model'} ${args.effort ?? ''}${args.temperature !== undefined ? ` temperature ${args.temperature}` : ''}${args.now ? ' now' : ''}`.replace(/\s+/g, ' ').trim()),
  async run(args, ctx) {
    if (args.model && args.need) return failure('Give a need or a model, not both.');
    const word = args.model ? modelWord(args.model) : undefined; // D5: cheap / strong – cheaper or stronger than the model I run on
    if (word) args = { ...args, model: undefined, need: word };
    if (!args.model && !args.need && !args.effort && args.temperature === undefined) return failure('Give a need, a model, an effort and/or a temperature.');
    if (args.temperature !== undefined && (typeof args.temperature !== 'number' || !Number.isFinite(args.temperature) || args.temperature < 0 || args.temperature > 2)) return failure('temperature is a number from 0 to 2.');
    const forTask = args.for === 'task' || Boolean(args.task);
    const taskId = forTask ? (args.task ?? ctx.taskId) : undefined;
    if (forTask) {
      if (!taskId) return failure(NO_TASK_TEXT);
      let task: { status: string; assigneeKind?: string; assigneeId?: string } | undefined;
      try { task = ctx.services.tasks.get(taskId); } catch { task = undefined; }
      if (!task) return failure(args.task ? `No task ${taskId} – I name one of mine with task: "<id>" (tasks.list), or keep it for my next step here.` : NO_TASK_TEXT);
      if (task.status === 'done' || task.status === 'dropped') return failure(`Task ${taskId} is finished – my next step here takes it with for: "next_step".`);
      // A colleague's turns read their own requests (next-route.ts keys agent + task): mine reaches that work on my own
      // turns on it (this one, e.g. a review), not on theirs.
      if (task.assigneeKind === 'agent' && task.assigneeId && task.assigneeId !== ctx.agent.id && taskId !== ctx.taskId) {
        return failure(`Task ${taskId} is ${ctx.services.org.get(task.assigneeId)?.name ?? task.assigneeId}'s – a request of mine reaches my own turns; for work I give on, tasks.create and tasks.give take model and effort.`);
      }
    }
    const place = placeOf(ctx, taskId);
    const policy = ctx.agent.modelPolicy;
    const from = current(ctx);
    const base = baseOf(ctx, from, taskId);
    let modelId: string | undefined;
    let effort = args.effort;
    let route: RouteDecision | undefined;
    let asked: string | undefined; // D1: the name of the model I named, when it cannot run now (its route runs another)
    if (args.model) {
      const info = catalogModel(ctx.services.catalog, args.model); // D4: any effort – the preview shows the one the router clamps to
      if (typeof info === 'string') return failure(info);
      if (policy.avoid?.includes(info.id)) return failure(`${info.name} is excluded by my model policy.`);
      route = await preview(ctx, place, previousOf(args, info.id, from, base)).catch(() => undefined); // no route right now: stored as asked
      modelId = info.id;
      if (route && route.modelId !== modelId) asked = info.name;
    } else if (args.need) {
      try { route = await preview(ctx, place, previousOf(args, undefined, from, base)); } catch (error) {
        return failure(`No model can run this right now: ${error instanceof Error ? error.message : String(error)}`);
      }
      const stay = ctx.services.catalog.get(from.modelId ?? '')?.name ?? 'my current model';
      if (!needMet(route.reason, args.need)) return failure(`${capital(NO_FIT_TEXT[args.need])} within my model policy right now – I stay on ${stay}. Ask for an effort instead, or name a model from models.list.`);
      modelId = route.modelId;
      effort = args.effort ?? (route.modelId === from.modelId ? route.effort : undefined); // stronger without a stronger model: one effort step up, kept as asked
    } else {
      route = await preview(ctx, place, previousOf(args, undefined, from, base)).catch(() => undefined); // an effort or temperature alone: what the work runs on with it
    }
    const value: NextRoute = {
      ...(modelId ? { modelId } : {}), ...(effort ? { effort } : {}), ...(args.need ? { need: args.need, ...(from.modelId ? { from: from.modelId } : {}) } : {}),
      ...(args.reason ? { reason: clip(args.reason, 300) } : {}), ...(args.temperature !== undefined ? { temperature: args.temperature } : {}), at: ctx.services.clock.now(),
    };
    if (taskId) setTaskRoute(ctx.services.db, ctx.agent.id, taskId, value);
    else if (!ctx.split) setNextRoute(ctx.services.db, ctx.agent.id, value); // B-083: a part has no next turn – its change acts inside its turn or not at all
    // The answer names what the preview route runs on (else what was asked, else what runs now).
    const runsOn = route?.modelId ?? modelId ?? from.modelId;
    const shown = route?.effort ?? effort;
    const info = runsOn ? ctx.services.catalog.get(runsOn) : undefined;
    const name = info?.name;
    // B-083 review: a running turn keeps its temperature. One the model takes (engines/http/temperature.ts) cuts the turn
    // with now (no target) – the new turn runs on the stored request with it; a stance leaves the in-turn switch of model
    // and effort as it is (dispatch-runs.ts setModelInTurn keeps the temperature for my next turn).
    const warm = args.temperature !== undefined;
    const sent = !info || takesTemperature(info.engine, info.model, shown);
    // D1: a model I named that cannot run now never becomes my running turn's – no cut, no switch onto a model nobody named.
    const target = !asked && runsOn && !(warm && sent) ? { modelId: runsOn, ...(shown ? { effort: shown } : {}) } : undefined;
    // now acts on the running turn: for its own work (no task, or this turn's task); another task's request waits for that task's turn.
    const ownWork = !taskId || taskId === ctx.taskId;
    const switched = !asked && (args.now || ctx.split !== undefined) && ownWork ? switchNow(ctx, `${name ?? 'the requested model'}${shown ? ` · ${shown}` : ''}${warm ? ` · temperature ${args.temperature}` : ''}`, target) : false;
    const tip = leftTip(ctx, place, { ...(modelId && runsOn ? { modelId: runsOn } : {}), ...(effort ? { effort: shown } : {}), temperature: args.temperature }, taskId);
    const stay = ctx.services.catalog.get(from.modelId ?? '')?.name ?? from.modelId ?? 'its model';
    // B-083 integration review: a part is never cut and has no next turn – its answer names what its running turn does.
    const partNow = switched ? 'my running turn goes on with the new model from its next step'
      : `my running turn stays on ${stay} – ${warm && sent
        ? 'a running turn keeps its temperature (model.set without one tries the model and effort inside it)'
        : 'a part takes a new model inside its turn on the same engine and account, where that engine switches mid-turn'}; a part has no next turn, so I go on as I am`;
    return json({
      ok: true, ...(name ? { model: name } : {}), ...(runsOn ? { modelId: runsOn } : {}), ...(shown ? { effort: shown } : {}),
      ...(warm && (!ctx.split || taskId || switched) ? { temperature: args.temperature, ...(!sent ? { temperatureNote: `${name ?? 'This model'} samples at its own setting – ${TEMPERATURE_FACT}.` } : {}) } : {}),
      appliesTo: taskId ? `every turn on task ${taskId} until it is done, in whichever chat it runs` : ctx.split ? (switched ? 'this part\'s turn' : 'nothing – this part goes on as it is') : 'next turn',
      ...(tip ? { suggestion: tip } : {}),
      ...(asked && route ? { instead: insteadText(route, asked, [name ?? runsOn, shown].filter(Boolean).join(' · '), taskId, ctx.split !== undefined) } : {}),
      ...(args.now || ctx.split ? { now: asked ? `my running turn stays on ${stay}` : !ownWork ? `my running turn is on other work – it applies from the next turn on task ${taskId}` : ctx.split ? partNow : switched ? (warm && sent ? 'my work continues at once in a new turn with it' : 'my running turn goes on with the new model from its next step; where that cannot happen inside it (another engine) my work continues at once in a new turn on it') : 'cannot switch inside this turn – it applies from my next turn' } : {}),
      ...(args.need && info && from.modelId === info.id ? { stays: `${capital(NO_FIT_TEXT[args.need])}: I stay on ${info.name}${effort ? ` at effort ${effort}` : ''}.` } : {}),
    });
  },
});

/**
 * B-083: the person's suggestion where the work runs (the composer chip: routing/policies.ts chatChoice) is information
 * for me, never a route; a request that leaves it is stored like any other, and this one line names whose suggestion I
 * leave – undefined when the request keeps it or there is none. Where: this chat, else the chat of the task the request is for.
 */
function leftTip(ctx: ToolContext, place: Place, taken: { modelId?: string; effort?: Effort; temperature?: number }, taskId: string | undefined): string | undefined {
  let tip: ReturnType<typeof chatChoice>;
  try { tip = chatChoice(ctx.services, place.conversationId, ctx.agent.id); } catch { return undefined; }
  const named = (id: string) => ctx.services.catalog.get(id)?.name ?? id;
  const left: string[] = [];
  const took: string[] = [];
  if (tip.pin && taken.modelId && taken.modelId !== tip.pin) { left.push(named(tip.pin)); took.push(named(taken.modelId)); }
  if (tip.effort && taken.effort && taken.effort !== tip.effort) { left.push(`effort ${tip.effort}`); took.push(`effort ${taken.effort}`); }
  if (tip.temperature !== undefined && taken.temperature !== undefined && taken.temperature !== tip.temperature) { left.push(`temperature ${tip.temperature}`); took.push(`temperature ${taken.temperature}`); }
  if (!left.length) return undefined;
  const chat = place.conversationId === ctx.conversationId ? 'in this chat' : `in the chat of task ${place.taskId}`;
  return `${capital(personName(ctx.services, HUMAN_ID) ?? 'the person')} suggested ${left.join(' · ')} ${chat} – I take ${took.join(' · ')} for ${taskId ? `task ${taskId}` : 'this step'}.`;
}

function capital(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * D1: the fact when the model I named cannot run now – its route reason leads with it (routing/unfit.ts askedMiss). A task
 * request stays for the first of its turns that can run it; a next step is my next turn's only; a part goes on as it is.
 */
function insteadText(route: RouteDecision, asked: string, runsOn: string, taskId: string | undefined, part: boolean): string {
  const why = capital(route.reason.split(' · ')[0]);
  if (taskId) return `${why}. My request stays: my turns on task ${taskId} take ${asked} from the first one it can run; until then they run on ${runsOn}.`;
  return part ? `${why}. This part goes on as it is.` : `${why}. My next turn here runs on ${runsOn}.`;
}

/**
 * now: true – the dispatcher hands `target` to the running turn (B-080: the same engine switches inside it from its next
 * step); otherwise it cuts this turn at its next tool boundary and runs its chat (task) again at once with the note.
 */
function switchNow(ctx: ToolContext, label: string, target: { modelId: string; effort?: Effort } | undefined): boolean {
  try {
    return ctx.services.dispatcher?.continueNow?.(ctx.agent.id, ctx.runId, `I switched to ${label} (model.set now) – I continue my work where I stopped; what I did so far is kept.`, target) ?? false;
  } catch {
    return false;
  }
}

export const modelTools: ToolDef[] = [listModels, setModel];
