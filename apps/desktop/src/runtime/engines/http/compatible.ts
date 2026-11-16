// OpenAI-compatible Chat Completions engine: Ollama, LM Studio, llama.cpp, vLLM, OpenRouter,
// Gemini/xAI/DeepSeek compat endpoints and any custom server.
// Owns: messages/tools request shape (the stable prompt as the system message, the live context first in the user message; B-078: with the temperature an agent asked for; B-083: not to Gemini 3+, which Google
// keeps at its default 1.0, and a gateway's Claude and GPT ids by their own provider's rule – compatibleTemperature),
// streamed delta + tool_call assembly, reasoning deltas, and
// OpenRouter's own price of each request (PR9: asked for with `usage: {include: true}`; with a
// bring-your-own-key the upstream provider's inference cost counts too). MM10: the only adapter
// that sends recordings – an audio part becomes `input_audio` (WAV or MP3, ≤ 10 MB, base64), then
// its text; the OpenAI API speaks this format too, so media.listen runs OpenAI models through it.
// Never: sends reasoning or usage params to servers that may reject unknown fields (only known
// providers), reads a cost field of any other server (its meaning is unknown), or sends audio in
// another format or above the limit (a note says why instead).
// Untested live against each server: field support varies (tool-call quality, usage, reasoning).

import type { Account, Effort, EngineId } from '../../../shared/model/providers.ts';
import type { EngineEvent, EngineModel, EngineTurnInput } from '../types.ts';
import type { ToolOutput } from '../../tools/types.ts';
import { traceCallId, type TraceCall } from '../../../shared/model/subconscious.ts';
import { ToolNames, contextText, isRecord, num, outputImages, outputText, str, tryJson } from '../shared.ts';
import { AUDIO_INPUT_BYTES, HttpEngine, audioFormat, splitInput, type AudioPart, type LoopStep, type StepUsage } from './base.ts';
import { HttpEngineError, postJson, readSse } from './common.ts';
import { anthropicTemperature } from './anthropic.ts';
import { openAiTemperature } from './openai.ts';
import { compatibleEffort, compatibleReasoning, type CompatibleEffort } from './compatible-effort.ts';

const MAX_REQUEST_USD = 10_000; // a larger "cost" of one request is no price

/** B-083: the temperature a chat completions server gets (0..2), undefined without one and for Gemini 3 and later
 *  ("gemini-3…", "google/gemini-3…"): Google recommends its default 1.0 there, lower values can loop or degrade. A gateway's
 *  Claude ids follow the Claude rule (http/anthropic.ts anthropicTemperature, 0..1) only on a step at effort `none`, which
 *  carries no reasoning – above it the gateway turns Claude's thinking on, and thinking is never turned off for a temperature
 *  (owner 09.11.); without an effort it counts as thinking. Its GPT-5+/6 and o-series ids follow the OpenAI rule – this
 *  engine sends them no effort `none`, so they reason and refuse it (http/openai.ts). */
export function compatibleTemperature(model: string, value: number | undefined, effort?: Effort): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const gemini = /(?:^|\/)gemini-(\d+)/i.exec(model);
  if (gemini && Number(gemini[1]) >= 3) return undefined;
  if (/(?:^|[/.])claude-/i.test(model)) return effort === 'none' ? anthropicTemperature(model, value) : undefined;
  const bare = model.slice(model.lastIndexOf('/') + 1).toLowerCase();
  if (/^(gpt-|o\d)/.test(bare)) return openAiTemperature(bare, value);
  return Math.max(0, Math.min(2, value));
}

/** OpenRouter's `usage.cost` in USD (credits) plus, with BYOK, the upstream inference cost; undefined when absent or implausible. */
export function openRouterCost(usage: Record<string, unknown>): number | undefined {
  const cost = num(usage.cost);
  if (cost === undefined || cost < 0) return undefined;
  const upstream = usage.is_byok === true && isRecord(usage.cost_details) ? num(usage.cost_details.upstream_inference_cost) : undefined;
  const total = cost + (upstream !== undefined && upstream > 0 ? upstream : 0);
  return total <= MAX_REQUEST_USD ? total : undefined;
}

function usageOf(raw: Record<string, unknown>, provider: string): StepUsage {
  const usage: StepUsage = { inputTokens: num(raw.prompt_tokens) ?? 0, outputTokens: num(raw.completion_tokens) ?? 0 };
  const cost = provider === 'openrouter' ? openRouterCost(raw) : undefined;
  if (cost !== undefined) usage.costUsd = cost;
  return usage;
}

export class CompatibleEngine extends HttpEngine {
  readonly id: EngineId = 'compatible';
  private readonly effortProfiles = new Map<string, Map<string, CompatibleEffort>>();

  private profileKey(account: Account): string { return JSON.stringify([account.id, account.provider, account.baseUrl, account.home]); }

  override async listModels(account: Account): Promise<EngineModel[]> {
    const models = await super.listModels(account);
    const current = this.effortProfiles.get(this.profileKey(account));
    if (current) for (const id of current.keys()) if (!models.some((m) => m.model === id)) current.delete(id);
    return models;
  }

  protected override listedModel(raw: { id: string; display_name?: unknown }, account: Account): EngineModel {
    const profile = compatibleEffort(account.provider, raw as Record<string, unknown>);
    const key = this.profileKey(account);
    let profiles = this.effortProfiles.get(key);
    if (!profiles) this.effortProfiles.set(key, (profiles = new Map()));
    profiles.set(raw.id, profile);
    return { ...super.listedModel(raw, account), efforts: profile.efforts, ...(profile.defaultEffort ? { defaultEffort: profile.defaultEffort } : {}) };
  }

  protected authHeaders(key: string | undefined): Record<string, string> {
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  /** MM10: the chat completions parts of a recording (then its `text`), or a note why it is not sent. */
  private async inputAudio(part: AudioPart, base: string): Promise<Array<Record<string, unknown>>> {
    const format = audioFormat(part.mime, part.name);
    const data = format ? await this.audio(part.path) : undefined;
    // Vercel AI Gateway refuses input_audio (HTTP 400, live 07.11.2026) and takes a recording as a file part (its docs).
    const sound = /ai-gateway\.vercel\.sh/i.test(base)
      ? { type: 'file', file: { filename: part.name, file_data: `data:${format === 'mp3' ? 'audio/mpeg' : 'audio/wav'};base64,${data}` } }
      : { type: 'input_audio', input_audio: { data, format } };
    if (format && data) return [sound, ...(part.text ? [{ type: 'text', text: part.text }] : [])];
    const why = format ? `larger than ${AUDIO_INPUT_BYTES / 1024 / 1024} MB` : 'only WAV and MP3 can be sent';
    return [{ type: 'text', text: `[audio: ${part.name} (${part.mime}) – not sent: ${why}]${part.text ? `\n${part.text}` : ''}` }];
  }

  protected async startConversation(input: EngineTurnInput, names: ToolNames, base: string) {
    const parts: Array<Record<string, unknown>> = [];
    const context = contextText(input.system.volatile);
    if (context) parts.push({ type: 'text', text: context });
    let media = 0; // images and recordings need a list of parts
    for (const part of splitInput(input.input, { audio: true }).parts) {
      if (part.type === 'text') parts.push({ type: 'text', text: part.text });
      else if (part.type === 'image') { media++; parts.push({ type: 'image_url', image_url: { url: `data:${part.mime};base64,${await this.image(part.path)}` } }); }
      else {
        const sound = await this.inputAudio(part, base);
        if (sound[0].type === 'input_audio' || sound[0].type === 'file') media++;
        parts.push(...sound);
      }
    }
    // Plain string content where possible: many local servers only accept strings.
    const userContent = media ? parts : parts.map((p) => String(p.text ?? '')).join('\n\n') || '(continue)';
    const system = input.system.stable;
    const messages: Array<Record<string, unknown>> = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: userContent });
    const provider = input.account.provider;
    const body: Record<string, unknown> = { model: input.model, stream: true, stream_options: { include_usage: true } };
    if (input.tools.length) body.tools = input.tools.map((tool) => ({ type: 'function', function: { name: names.wire(tool.name), description: tool.description, parameters: tool.inputSchema } }));
    // A persisted catalog can precede this engine instance. Reacquire metadata before encoding its effort.
    if ((provider === 'openrouter' || provider === 'deepseek') && !this.effortProfiles.get(this.profileKey(input.account))?.has(input.model)) await this.listModels(input.account);
    const profile = this.effortProfiles.get(this.profileKey(input.account))?.get(input.model) ?? { efforts: ['none'] as Effort[] };
    if ((provider === 'openrouter' || provider === 'deepseek') && !profile.efforts.includes(input.effort)) {
      throw new HttpEngineError({ code: 'unavailable', message: 'The model effort capabilities changed. Refresh the model list and retry.' });
    }
    Object.assign(body, compatibleReasoning(profile, input.effort));
    if (provider === 'openrouter') body.usage = { include: true }; // its own price per request (PR9)
    // B-078: the temperature the agent asked for (model.set) – a standard chat completions field (B-083: Gemini 3+ keeps 1.0,
    // a gateway's Claude and GPT ids follow their provider's rule)
    const temperature = compatibleTemperature(input.model, input.temperature, input.effort);
    if (temperature !== undefined) body.temperature = temperature;
    if (input.outputSchema) body.response_format = { type: 'json_schema', json_schema: { name: 'result', schema: input.outputSchema } };

    const step = async (key: string | undefined, emit: (e: EngineEvent) => void): Promise<LoopStep> => {
      const response = await postJson(this.fetchFn, `${base}/chat/completions`, { Accept: 'text/event-stream', ...this.authHeaders(key) }, { ...body, messages }, input.signal);
      let text = '';
      let finish: string | undefined;
      const calls = new Map<number, { id: string; name: string; args: string }>();
      let usage: StepUsage | undefined;
      for await (const { data } of readSse(response)) {
        if (data === '[DONE]') break;
        if (!isRecord(data)) continue;
        if (isRecord(data.error)) throw new HttpEngineError({ code: 'internal', message: 'The model could not complete this turn.' });
        if (isRecord(data.usage)) usage = usageOf(data.usage, provider);
        const choice = Array.isArray(data.choices) && isRecord(data.choices[0]) ? data.choices[0] : undefined;
        if (!choice) continue;
        finish = str(choice.finish_reason) ?? finish;
        const delta = isRecord(choice.delta) ? choice.delta : {};
        if (typeof delta.content === 'string' && delta.content) { text += delta.content; emit({ type: 'text', delta: delta.content }); }
        const reasoning = str(delta.reasoning_content) ?? str(delta.reasoning);
        if (reasoning) emit({ type: 'reasoning', delta: reasoning });
        if (Array.isArray(delta.tool_calls)) {
          for (const raw of delta.tool_calls) {
            if (!isRecord(raw)) continue;
            const index = num(raw.index) ?? calls.size;
            const call = calls.get(index) ?? { id: '', name: '', args: '' };
            if (str(raw.id)) call.id = raw.id as string;
            const fn = isRecord(raw.function) ? raw.function : {};
            if (str(fn.name)) call.name += fn.name as string;
            if (str(fn.arguments)) call.args += fn.arguments as string;
            calls.set(index, call);
          }
        }
      }
      if (!finish && !text && !calls.size) throw new HttpEngineError({ code: 'internal', message: 'The model response did not complete.' });
      const rawCalls = [...calls.values()];
      const list = rawCalls.map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, args: tryJson(c.args) }));
      const assistant: Record<string, unknown> = { role: 'assistant', content: text || null };
      // Keep the actual argument string in history, including malformed JSON; the loop returns its error.
      if (list.length) assistant.tool_calls = list.map((c, i) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: rawCalls[i].args } }));
      messages.push(assistant);
      if (finish === 'length' && !list.length) throw new HttpEngineError({ code: 'internal', message: 'The model response was cut off.' }, usage);
      return { text, calls: list, done: list.length === 0, usage, structured: input.outputSchema ? tryJson(text.trim()) : undefined };
    };

    const addResults = (results: Array<{ id: string; name: string; output: ToolOutput }>) => {
      const images: Array<Record<string, unknown>> = [];
      for (const r of results) {
        messages.push({ role: 'tool', tool_call_id: r.id, content: (r.output.isError ? 'ERROR: ' : '') + (outputText(r.output) || 'ok') });
        for (const img of outputImages(r.output)) images.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.dataBase64}` } });
      }
      if (images.length) messages.push({ role: 'user', content: [{ type: 'text', text: 'Images returned by the tool calls above:' }, ...images] });
    };
    const addUserText = (text: string) => { messages.push({ role: 'user', content: text }); }; // steering (base.ts)
    const injectTrace = (calls: readonly TraceCall[]) => {
      messages.push({ role: 'assistant', content: null, tool_calls: calls.map((call, index) => ({ id: traceCallId(input.runId, index), type: 'function', function: { name: names.wire(call.tool), arguments: JSON.stringify(call.args) } })) });
      calls.forEach((call, index) => messages.push({ role: 'tool', tool_call_id: traceCallId(input.runId, index), content: call.output }));
    };
    return { step, addResults, addUserText, injectTrace };
  }
}
