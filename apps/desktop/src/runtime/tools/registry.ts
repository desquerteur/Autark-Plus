// The tool registry: one list of Autark tools, the same for every engine (an engine differs only in its direct offer,
// core-sets.ts). shell.exec starts in the CLI engines' env (engines/wf-shim.ts agentEnv).
// Owns: registration (remote tools get the optional `device` argument), the per-agent/per-mode offer (sorted, for prompt
// caching) and the one call path: mode check → company placement (placement.ts placeCompany) → coerce + validate →
// device placement → leak redactor (secrets/guard.ts: a stored secret value arrives as its handle) → idempotency by
// (run, call id): a resend while it runs gets its result, one cut off before its result is told so → run here, on a
// linked PC or in another company on this PC → cut and redact (outputs.ts) → journal (journal.ts). Each call with an id
// is reported to the turn's tool boundary (onCall). A call that could not reach a linked PC wakes the agent once that
// PC is back (devices/back-wake.ts).
// A tool is offered when its mode fits: the mode's patterns, EVERY_MODE or anyMode; `requires: 'device'` keeps the
// device tools to modes that work on a computer or browser (or name the tool), `requires: 'embeddings'` the vector tools to
// while a chosen embedding model can serve (a tool that cannot work is not listed).
// Never: retries external effects, puts secret values or HIDDEN_ARGS into outputs or the journal, or forwards a call
// to a revoked, unknown or non-PC device.

import type { RuntimeServices, ToolRegistry } from '../contracts.ts';
import type { Agent } from '../../shared/model/org.ts';
import type { ModeInfo } from '../../shared/model/knowledge.ts';
import { toErrorData, WorkforceError } from '../../shared/errors.ts';
import type { ActionDescription, ToolContext, ToolDef, ToolOutput, ToolSpec } from './types.ts';
import { DEVICE_ARG, failure } from './types.ts';
import { inCompany, isRecord, onPc, place, placeCompany, safeSelfId, withDeviceArg, type CompanyTarget } from './placement.ts';
import { callCompany } from '../root/companies.ts';
import { coerce, validate } from './validate.ts';
import { finalizeOutput, preview } from './outputs.ts';
import { cachedResult, journalArgs, journalResult, journaled, safeItem, safeUpdate } from './journal.ts';
import { CALL_TOOL, coreNames } from './core-sets.ts';
import { noteLearned } from './learned.ts';
import { callRefusal, callTarget } from './builtin/tools-meta.ts';
import { withoutSecretValues } from '../secrets/guard.ts';
import { missed } from '../devices/back-wake.ts'; // B-080
import { mailScopeRefusal } from './mail-scope.ts';
import '../contracts/vectors.ts';

export { resolveDevice, withDeviceArg, type DeviceTarget } from './placement.ts';

export interface ToolRegistryOptions {
  /** Late-bound: the registry is itself part of RuntimeServices. */
  services: () => RuntimeServices;
  /** Hook when a call with a call id starts (true) and ends (false): the turn's tool boundaries (agents/dispatch-boundary.ts). */
  onCall?(ctx: { agentId: string; runId: string; callId: string }, running: boolean): void;
}

/** '*' = everything, 'tasks.*' prefix globs, '!name' excludes. Last matching pattern wins. */
export function matchesPatterns(name: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return true;
  let allowed = false;
  for (const raw of patterns) {
    const negate = raw.startsWith('!');
    const pattern = negate ? raw.slice(1) : raw;
    const regex = new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    if (regex.test(name)) allowed = !negate;
  }
  return allowed;
}

/** Offered in every mode, whatever its tool patterns: the four task commands (asking the person and handing work on are
 *  tasks.create / tasks.give), self-routing, reporting,
 *  handing a choice to the decision model, the secrets catalog and a command with a stored secret (shell.exec, on any
 *  linked PC too), the companies on this PC, finding and opening knowledge, the web search, splitting, the meta tools,
 *  seeing an image, starting a CLI sign-in and reading my chats.
 *  B-086: agents.update too – a "System prompt update" or "Training: …" review reaches an agent in any mode, and its
 *  answer is its own SYSTEM.md (agents.update writes instructions only for the caller). */
export const EVERY_MODE: ReadonlySet<string> = new Set([
  'chat.read', 'chat.direct',
  'tasks.create', 'tasks.give', 'tasks.update', 'tasks.finish', 'agents.update', 'model.set', 'models.list', 'feedback.report', 'decide',
  'secrets.list', 'secrets.save', 'secrets.generate', 'shell.exec', 'secrets.import', 'secrets.export', 'secrets.delete',
  'companies.list',
  'knowledge.find', 'knowledge.open',
  'web.search',
  'tools.find', 'tools.call',
  'agents.split', 'agents.split_results', 'agents.split_merge', 'agents.split_tell',
  'media.view', 'accounts.sign_in', 'telegram.connect',
]);

/** Arguments the journal never shows (a phone's pairing code is a one-time secret; a secret's value). */
export const HIDDEN_ARGS: ReadonlyMap<string, readonly string[]> = new Map([['phone.pair', ['code']], ['decide', ['context']], ['secrets.save', ['value']]]);

/** Arguments that go straight into the vault: the leak guard (secrets/guard.ts) leaves them as given. */
export const VAULT_ARGS: ReadonlyMap<string, readonly string[]> = new Map([['secrets.save', ['value']]]);

const CUT_OFF = 'This call already started earlier, but no result was recorded (it was probably cut off), so whether it had an effect is unknown. I check that before doing it again.';

export class Registry implements ToolRegistry {
  private tools = new Map<string, ToolDef>();
  private options: ToolRegistryOptions;
  /** Calls running in this process by idempotency key (a resend gets the same result). */
  private readonly running = new Map<string, Promise<ToolOutput>>();

  constructor(options: ToolRegistryOptions) {
    this.options = options;
  }

  register(tool: ToolDef): void {
    if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(tool.name)) throw new Error(`Invalid tool name: ${tool.name}`);
    this.tools.set(tool.name, withDeviceArg(tool));
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  all(): ToolDef[] {
    return [...this.tools.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /** Is `tool` offered in `mode`? (Same rule for the offer and for calls.) */
  allowed(tool: ToolDef, _agent: Agent, mode: ModeInfo): boolean {
    if (tool.modes && !tool.modes.includes(mode.key)) return false;
    if (!EVERY_MODE.has(tool.name) && !tool.anyMode && !matchesPatterns(tool.name, mode.tools)) return false;
    if (tool.requires === 'embeddings') return this.embeddings();
    if (tool.requires === 'device') return mode.workspace === 'computer' || mode.workspace === 'browser' || (mode.tools ?? []).some((pattern) => pattern !== '*' && matchesPatterns(tool.name, [pattern]));
    return true;
  }

  /** An embedding model a person chose can serve now (models/embeddings.ts). */
  private embeddings(): boolean {
    try { return Boolean(this.options.services().vectors?.available()); } catch { return false; }
  }

  /** B-080: the same tools for every engine (`_engine` names the caller; its direct offer is offerFor's core set). */
  specsFor(agent: Agent, mode: ModeInfo, _engine?: { ownTools: boolean; via: 'mcp' | 'native' }): ToolSpec[] {
    return this.all()
      .filter((tool) => this.allowed(tool, agent, mode))
      .map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
  }

  /** B-049 F4: the engine's direct offer – the mode's core set, `learned` and the meta tools, out of specsFor (same order). */
  offerFor(agent: Agent, mode: ModeInfo, engine: { ownTools: boolean; via: 'mcp' | 'native' }, learned: readonly string[] = []): ToolSpec[] {
    const direct = coreNames(mode, engine);
    for (const name of learned) direct.add(name);
    return this.specsFor(agent, mode, engine).filter((spec) => direct.has(spec.name));
  }

  /** `company`: tools.call's own `company` (B-075), apart from the target's arguments. */
  async call(name: string, args: unknown, base: Omit<ToolContext, 'services'>, callId: string, company?: unknown): Promise<ToolOutput> {
    if (name === CALL_TOOL) return this.callThrough(args, base, callId); // B-049 F4
    const services = this.options.services();
    const scopeRefusal = mailScopeRefusal(base.origin, name, args, company, () => services.apps?.list() ?? []);
    if (scopeRefusal) return failure(scopeRefusal);
    if (base.origin?.mailScope && services.apps?.mailGeneration?.(base.origin.mailScope.appId) !== base.origin.mailScope.generation) return failure('Mailbox incarnation changed.');
    const ctx: ToolContext = { ...base, services, callId: callId || undefined }; // a nested call never inherits its caller's id
    const tool = this.tools.get(name);
    if (!tool) return failure(`Unknown tool "${name}". Use one of the listed tools.`);

    let mode: ModeInfo | undefined;
    try { mode = services.modes.get(ctx.mode); } catch { mode = undefined; }
    if (mode && !this.allowed(tool, ctx.agent, mode)) return failure(`Tool "${name}" is not in mode "${ctx.mode}".`);

    const placedIn = placeCompany(services, tool, args, company); // B-075: `company` – another company of this PC runs it
    if ('error' in placedIn) return failure(placedIn.error);
    const given = coerce(placedIn.input, tool.inputSchema); // B-080: "2" where a number fits, an enum value in another case
    const errors = validate(given, tool.inputSchema);
    if (errors.length) {
      const stray = !tool.remote && isRecord(given) && Object.hasOwn(given, DEVICE_ARG) && errors.some((line) => line.startsWith(`${DEVICE_ARG}:`));
      return failure(stray ? `${name} always runs on this PC, so it takes no "${DEVICE_ARG}".` : `Invalid arguments for ${name}:\n${errors.join('\n')}`);
    }
    const fields = (given ?? {}) as Record<string, unknown>;
    const placed: ReturnType<typeof place> = placedIn.target ? { input: fields } : place(services, tool, fields, ctx); // in another company, that one places it
    if ('error' in placed) return failure(placed.error);
    const { target } = placed;
    const input = withoutSecretValues(services.secrets, placed.input, VAULT_ARGS.get(name)); // owner 29.10.2026 (secrets/guard.ts)

    // Idempotency: the same (run, call id) never executes twice (engine retries, reconnects): a
    // resend while it runs gets its result; one whose result was never journaled is told so.
    const idemKey = `${ctx.runId}:${callId}`;
    const running = this.running.get(idemKey);
    if (running) return running;
    const cached = cachedResult(services, `${idemKey}:result`);
    if (cached) return cached;
    if (journaled(services, idemKey)) return failure(CUT_OFF);

    let action: ActionDescription = { summary: name, external: false };
    if (tool.describe) {
      try { action = tool.describe(input, ctx); } catch (error) {
        if (!placedIn.target) return failure(`Invalid arguments for ${name}: ${toErrorData(error).message}`); // in another company its describe read this one's data
      }
    }
    if (target) action = onPc(action, target);
    if (placedIn.target) action = inCompany(action, placedIn.target); // judged external there: its effect is that company's

    // The turn's tool boundary follows this call under its id from here (a resend above is the same call).
    const report = (on: boolean) => { if (callId) { try { this.options.onCall?.({ agentId: ctx.agent.id, runId: ctx.runId, callId }, on); } catch { /* bookkeeping only */ } } };
    report(true);
    const call = this.invoke(services, { tool, args: input, action, ctx, company: placedIn.target }, callId, idemKey, target?.name);
    this.running.set(idemKey, call);
    try { return await call; } finally { this.running.delete(idemKey); report(false); }
  }

  /**
   * tools.call: its target runs through call() under the target's own name and this call id – the same validation,
   * journal and result as a direct call (tools-meta.ts callRefusal); a target that succeeded and is in no core set (also
   * not the file and web tools an engine without its own gets) is noted for the next fresh session (learned.ts).
   */
  private async callThrough(args: unknown, base: Omit<ToolContext, 'services'>, callId: string): Promise<ToolOutput> {
    const services = this.options.services();
    const target = callTarget(args);
    if ('error' in target) return failure(target.error);
    const scopeRefusal = mailScopeRefusal(base.origin, target.name, target.args, target.company, () => services.apps?.list() ?? []);
    if (scopeRefusal) return failure(scopeRefusal);
    if (base.origin?.mailScope && services.apps?.mailGeneration?.(base.origin.mailScope.appId) !== base.origin.mailScope.generation) return failure('Mailbox incarnation changed.');
    const refused = callRefusal({ ...base, services, callId: callId || undefined }, target.name);
    if (refused) return failure(refused);
    const output = await this.call(target.name, target.args, base, callId, target.company);
    if (output.isError) return output; // a wrong or failed call never takes a learned slot
    try {
      if (!coreNames(services.modes.get(base.mode), { ownTools: false }).has(target.name)) noteLearned(services, base.agent.id, target.name); // a part learns for its agent, like every turn
    } catch { /* unknown mode or no store: nothing learned */ }
    return output;
  }

  /** run → journal, for a call id that has not started before. */
  private async invoke(services: RuntimeServices, call: { tool: ToolDef; args: Record<string, unknown>; action: ActionDescription; ctx: ToolContext; company?: CompanyTarget }, callId: string, idemKey: string, device?: string): Promise<ToolOutput> {
    const { tool, args: input, action, ctx, company } = call;
    const name = tool.name;
    // Summaries are redacted too: a tool may echo a filled value.
    const callData = { callId, args: preview(services.secrets, journalArgs(input, HIDDEN_ARGS.get(name))), summary: preview(services.secrets, action.summary), category: tool.category, ...(device ? { device } : {}) };
    const callItem = safeItem(services, ctx.runId, { kind: 'tool_call', name, data: callData, effectStatus: action.external ? 'pending' : 'none', idemKey });
    const started = Date.now();
    let output: ToolOutput;
    try {
      output = company ? await forward(company, tool, input, ctx) : await this.execute(tool, input, ctx);
    } catch (error) {
      // A throw after an external call started may still have had an effect: never retry blindly.
      output = { ...failure(toErrorData(error).message + backLater(ctx, error)), effect: action.external ? { status: 'unknown' } : undefined };
    }
    const { output: finalOutput, blobIds } = await finalizeOutput(output, services, name);
    if (callItem && action.external) {
      const status = finalOutput.effect?.status ?? (finalOutput.isError ? 'failed' : 'confirmed');
      safeUpdate(services, callItem, { effectStatus: status, data: { ...callData, ms: Date.now() - started, externalId: finalOutput.effect?.externalId } });
    }
    journalResult(services, ctx.runId, name, callId, idemKey, finalOutput, blobIds);
    return finalOutput;
  }

  private async execute(tool: ToolDef, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
    const remote = ctx.deviceId !== undefined && tool.remote && ctx.deviceId !== safeSelfId(ctx.services);
    if (!remote) return normalizeOutput(await tool.run(input, ctx));
    // Nothing ran there when the dial failed or was stopped (reachable: false) or that PC refused the call before
    // its tool ran (PEER_REFUSALS): a plain failure, never unknown.
    let result: unknown;
    try {
      result = await ctx.services.devices.call(ctx.deviceId!, 'tools.call', {
        name: tool.name, args: input, agentId: ctx.agent.id, agentName: ctx.agent.name, runId: ctx.runId,
        conversationId: ctx.conversationId, taskId: ctx.taskId, mode: ctx.mode,
      }, ctx.signal);
    } catch (error) {
      if (!nothingRan(error)) throw error;
      return failure(error.message + backLater(ctx, error, ctx.deviceId));
    }
    return normalizeOutput(result);
  }
}

/**
 * B-080: for a call that could not reach a linked PC (unavailable, reachable false; not a refusal, never this PC): the
 * agent is noted for a wake when that PC is back (devices/back-wake.ts), and the sentence that says so; else ''.
 * `forwardedTo`: the PC a forwarded call went to. An error naming another PC came from that PC's own dial of a third
 * one (a devices.send_file there): this PC may well reach the third PC, so no online change and no wake would come –
 * the plain failure then.
 */
function backLater(ctx: ToolContext, error: unknown, forwardedTo?: string): string {
  if (!(error instanceof WorkforceError) || error.code !== 'unavailable' || error.details?.reachable !== false || error.details.refused) return '';
  const named = typeof error.details.deviceId === 'string' ? error.details.deviceId : undefined;
  if (forwardedTo !== undefined && named !== undefined && named !== forwardedTo) return '';
  const id = named ?? forwardedTo;
  if (!id || id === safeSelfId(ctx.services)) return '';
  return missed(ctx.services, id, { agentId: ctx.agent.id, conversationId: ctx.conversationId, taskId: ctx.taskId }) ? ' I hear it here when it is back.' : '';
}

const PEER_REFUSALS: ReadonlySet<string> = new Set(['forbidden', 'bad_request']); // that PC's or company's checks and arguments (devices/tools.ts, builtin/companies.ts)

/** Nothing ran there: the call never reached it (reachable: false) or it refused before its tool ran (PEER_REFUSALS). */
const nothingRan = (error: unknown): error is WorkforceError => error instanceof WorkforceError && (error.details?.reachable === false || PEER_REFUSALS.has(error.code));

/** B-075: runs a call in another company's runtime on this PC (its companies.tool); the result names that company. */
async function forward(company: CompanyTarget, tool: ToolDef, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
  let result: unknown;
  try {
    result = await callCompany(company.dir, 'companies.tool', {
      name: tool.name, args: input, agentId: ctx.agent.id, agentName: ctx.agent.name, runId: ctx.runId, mode: ctx.mode, from: company.from,
    }, { signal: ctx.signal });
  } catch (error) {
    if (!nothingRan(error)) throw error;
    return failure(`${company.name}: ${error.message}`);
  }
  const output = normalizeOutput(result);
  return { ...output, content: [{ type: 'text', text: `In ${company.name}:` }, ...output.content] };
}

/** Accepts plain strings or partial outputs from tools/devices and returns a valid ToolOutput. */
export function normalizeOutput(value: unknown): ToolOutput {
  if (typeof value === 'string') return { content: [{ type: 'text', text: value }] };
  if (value && typeof value === 'object' && Array.isArray((value as ToolOutput).content)) return value as ToolOutput;
  return { content: [{ type: 'text', text: JSON.stringify(value ?? null) }], structured: value };
}
