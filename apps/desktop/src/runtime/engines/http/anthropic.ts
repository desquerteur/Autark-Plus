// Anthropic Messages API engine (raw HTTP; no SDK dependency).
// Owns: request shape (the cached stable system block, the live context first in the user message, tools, adaptive thinking with
// summarized display, output_config.effort, structured output, B-078/B-083: the agent's temperature on the models that sample
// without thinking anyway – thinking is never turned off for it, owner 09.11.), SSE assembly of content blocks
// (thinking blocks as reasoning with an id per round and block, D5) and the tool_use loop. Assistant content (incl. thinking blocks + signatures) is appended unchanged.
// A request's inputTokens counts its cache reads and writes; both also stand on their own in its usage when the API reports them.
// Never: forces tool_choice (rejected by current models) or edits earlier turns (preserved thinking).

import type { EngineId, Effort } from '../../../shared/model/providers.ts';
import type { CacheTokens, EngineEvent, EngineTurnInput } from '../types.ts';
import type { ToolOutput } from '../../tools/types.ts';
import { traceCallId, type TraceCall } from '../../../shared/model/subconscious.ts';
import { ToolNames, addCache, contextText, isRecord, nearestEffort, num, outputImages, outputText, str, tryJson } from '../shared.ts';
import { HttpEngine, splitInput, type LoopStep } from './base.ts';
import { HttpEngineError, postJson, readSse } from './common.ts';

/**
 * Thinking/effort support per model family: adaptive thinking arrived with the 4.6 models (Opus 4.6
 * and Sonnet 4.6 stop at `max` without `xhigh`), `xhigh` with Opus 4.7. Older models (Opus 4.5,
 * Haiku 4.5 …) reject adaptive thinking, so they run without thinking params.
 */
export function anthropicProfile(model: string): { adaptive: boolean; efforts: Effort[] } {
  if (/^claude-(opus|sonnet|haiku|fable|mythos)-[5-9]/.test(model) || /^claude-opus-4-[7-9]/.test(model)) return { adaptive: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max'] };
  if (/^claude-(opus|sonnet)-4-6/.test(model)) return { adaptive: true, efforts: ['low', 'medium', 'high', 'max'] };
  return { adaptive: false, efforts: ['none'] };
}

/** A Claude id as the Anthropic API names it: a provider prefix goes and dots read as dashes (anthropic/claude-opus-4.7 is claude-opus-4-7). */
function claudeId(model: string): string {
  return model.toLowerCase().replace(/^.*[/.](?=claude-)/, '').replace(/\./g, '-'); // anthropic/claude-opus-4.7, us.anthropic.claude-…
}

/**
 * B-083 (live 09.11.2026, 240 + 52 requests through Claude Code: .local/b083/experiments/deep/claude-matrix.md, verify.md):
 * the Claude models that still sample with a temperature – the 4.6 generation and older (Sonnet and Opus 4.6, Haiku 4.5,
 * Opus/Sonnet 4.5 and before, the 3.x ids), each only with thinking off (thinking on: 400 "temperature may only be set to 1
 * when thinking is enabled or in adaptive mode", on the plan and the API alike). Opus 4.7 and 4.8, every 5.x model, Fable and
 * Mythos answer any value but 1 with 400 "temperature is deprecated for this model", whatever the thinking mode; an unknown
 * family counts as new. One rule for the Anthropic API here, http/temperature.ts and a gateway's Claude ids (compatible.ts).
 */
export function claudeSamples(model: string): boolean {
  const id = claudeId(model);
  if (/^claude-[0-3]-/.test(id)) return true; // claude-3-5-sonnet, claude-3-opus …
  const named = /^claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(id); // a date after the major is no minor
  return named !== null && (Number(named[1]) < 4 || (Number(named[1]) === 4 && Number(named[2] ?? 0) <= 6));
}

/**
 * B-078 (D14, D16), B-083: the temperature this model gets (0..1, the API's range – 1.5 is a 400), undefined where the model
 * no longer samples (claudeSamples) or thinks: owner 09.11. – "Es ist unbedingt wichtig. Ohne das funktioniert das nicht gut.
 * Mach das bitte nicht." Thinking is never turned off for a temperature, so a 4.6 model keeps its adaptive thinking and its
 * own setting; the older models, which run here without thinking anyway (anthropicProfile), take it.
 */
export function anthropicTemperature(model: string, value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || !claudeSamples(model) || anthropicProfile(claudeId(model)).adaptive) return undefined;
  return Math.max(0, Math.min(1, value));
}

export class AnthropicEngine extends HttpEngine {
  readonly id: EngineId = 'anthropic';

  protected authHeaders(key: string | undefined): Record<string, string> {
    return { 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}) };
  }

  protected override effortsFor(model: string): Effort[] {
    return anthropicProfile(model).efforts;
  }

  /** The list is paginated (20 per page by default); one page of up to 1000 covers every model. */
  protected override modelsPath(): string {
    return '/models?limit=1000';
  }

  protected async startConversation(input: EngineTurnInput, names: ToolNames, base: string) {
    const content: Array<Record<string, unknown>> = [];
    const context = contextText(input.system.volatile);
    if (context) content.push({ type: 'text', text: context });
    for (const part of splitInput(input.input).parts) {
      if (part.type === 'text') content.push({ type: 'text', text: part.text });
      else content.push({ type: 'image', source: { type: 'base64', media_type: part.mime, data: await this.image(part.path) } });
    }
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content: content.length ? content : [{ type: 'text', text: '(continue)' }] }];
    const system: Array<Record<string, unknown>> = [];
    if (input.system.stable) system.push({ type: 'text', text: input.system.stable, cache_control: { type: 'ephemeral' } });
    const body: Record<string, unknown> = { model: input.model, max_tokens: 64_000, stream: true, system, cache_control: { type: 'ephemeral' } };
    if (input.tools.length) body.tools = input.tools.map((tool) => ({ name: names.wire(tool.name), description: tool.description, input_schema: tool.inputSchema }));
    const profile = anthropicProfile(input.model);
    const temperature = anthropicTemperature(input.model, input.temperature);
    const output: Record<string, unknown> = {};
    if (profile.adaptive) {
      body.thinking = { type: 'adaptive', display: 'summarized' }; // B-083: never off for a temperature (anthropicTemperature)
      output.effort = nearestEffort(input.effort === 'none' ? 'low' : input.effort, profile.efforts);
    }
    if (input.outputSchema) output.format = { type: 'json_schema', schema: input.outputSchema };
    if (Object.keys(output).length) body.output_config = output;
    if (temperature !== undefined) body.temperature = temperature;

    let round = 0; // D5: reasoning block ids stay unique across tool rounds
    const step = async (key: string | undefined, emit: (e: EngineEvent) => void): Promise<LoopStep> => {
      const response = await postJson(this.fetchFn, `${base}/messages`, { Accept: 'text/event-stream', ...this.authHeaders(key) }, { ...body, messages }, input.signal);
      const current = round++;
      const thought = (index: number) => `r${current}:${index}`;
      const blocks: Array<Record<string, unknown>> = [];
      const json = new Map<number, string>();
      let stopReason: string | undefined;
      let inputTokens = 0, outputTokens = 0;
      let cache: CacheTokens = {}; // the cache reads and writes inside inputTokens, when reported
      let text = '';
      for await (const { data } of readSse(response)) {
        if (!isRecord(data)) continue;
        const index = num(data.index) ?? 0;
        switch (data.type) {
          case 'message_start': {
            const u = isRecord(data.message) && isRecord(data.message.usage) ? data.message.usage : {};
            inputTokens = (num(u.input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0);
            cache = addCache({ cacheReadTokens: num(u.cache_read_input_tokens), cacheWriteTokens: num(u.cache_creation_input_tokens) }, {});
            break;
          }
          case 'content_block_start':
            if (isRecord(data.content_block)) blocks[index] = { ...data.content_block };
            break;
          case 'content_block_delta': {
            const block = blocks[index];
            const delta = isRecord(data.delta) ? data.delta : {};
            if (!block) break;
            if (delta.type === 'text_delta' && typeof delta.text === 'string') { block.text = String(block.text ?? '') + delta.text; text += delta.text; emit({ type: 'text', delta: delta.text }); }
            else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') { block.thinking = String(block.thinking ?? '') + delta.thinking; if (delta.thinking) emit({ type: 'reasoning', delta: delta.thinking, id: thought(index) }); }
            else if (delta.type === 'signature_delta' && typeof delta.signature === 'string') block.signature = String(block.signature ?? '') + delta.signature;
            else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') json.set(index, (json.get(index) ?? '') + delta.partial_json);
            break;
          }
          case 'content_block_stop': {
            const block = blocks[index];
            if (block?.type === 'tool_use' && json.has(index)) block.input = tryJson(json.get(index)!);
            if (block?.type === 'thinking') emit({ type: 'reasoning_end', id: thought(index) });
            break;
          }
          case 'message_delta': {
            if (isRecord(data.delta)) stopReason = str(data.delta.stop_reason) ?? stopReason;
            if (isRecord(data.usage)) outputTokens = num(data.usage.output_tokens) ?? outputTokens;
            break;
          }
          case 'error': {
            const type = isRecord(data.error) ? String(data.error.type ?? '') : '';
            if (type === 'rate_limit_error') throw new HttpEngineError({ code: 'rate_limited', message: 'The usage limit of this account was reached.' });
            if (type === 'overloaded_error') throw new HttpEngineError({ code: 'unavailable', message: 'The provider is overloaded. Retry later.' });
            throw new HttpEngineError({ code: 'internal', message: 'The model could not complete this turn.' });
          }
        }
      }
      const usage = { inputTokens, outputTokens, ...cache };
      if (!stopReason) throw new HttpEngineError({ code: 'internal', message: 'The model response did not complete.' });
      if (stopReason === 'refusal') throw new HttpEngineError({ code: 'forbidden', message: 'The model declined this request.' }, usage);
      const assistant = blocks.filter(Boolean);
      // Messages history requires an object input. A placeholder pairs the rejected call with its error result;
      // execution still receives the original parsed value, so invalid JSON cannot become a default action.
      messages.push({ role: 'assistant', content: assistant.map((b) => b.type === 'tool_use' && !isRecord(b.input) ? { ...b, input: {} } : b) });
      const calls = assistant.filter((b) => b.type === 'tool_use').map((b) => ({ id: str(b.id) ?? '', name: str(b.name) ?? '', args: b.input }));
      if (stopReason === 'pause_turn') {
        // Server paused a long turn: continue by re-sending (no new user content needed).
        return { text, calls: [], done: false, continue: true, usage };
      }
      if (stopReason === 'max_tokens' && !calls.length) throw new HttpEngineError({ code: 'internal', message: 'The model response was cut off.' }, usage);
      return { text, calls, done: stopReason !== 'tool_use', usage, structured: input.outputSchema ? tryJson(text.trim()) : undefined };
    };

    const addResults = (results: Array<{ id: string; name: string; output: ToolOutput }>) => {
      // All results of one assistant turn go back in ONE user message (keeps parallel tool use).
      messages.push({
        role: 'user',
        content: results.map((r) => ({
          type: 'tool_result', tool_use_id: r.id, is_error: r.output.isError === true,
          content: [
            { type: 'text', text: outputText(r.output) || (r.output.isError ? 'failed' : 'ok') },
            ...outputImages(r.output).map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.dataBase64 } })),
          ],
        })),
      });
    };
    // Steering (base.ts): after tool results the text joins that user message (roles keep alternating).
    const addUserText = (text: string) => {
      const last = messages[messages.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) last.content = [...last.content, { type: 'text', text }];
      else messages.push({ role: 'user', content: [{ type: 'text', text }] });
    };
    // The subconscious's calls: one assistant turn of tool_use blocks, all results in ONE user message. A request's first turn
    // holds no thinking block yet, so nothing here is bound to thinking (a history of tool_use without thinking is valid).
    const injectTrace = (calls: readonly TraceCall[]) => {
      messages.push({ role: 'assistant', content: calls.map((call, index) => ({ type: 'tool_use', id: traceCallId(input.runId, index), name: names.wire(call.tool), input: call.args })) });
      messages.push({ role: 'user', content: calls.map((call, index) => ({ type: 'tool_result', tool_use_id: traceCallId(input.runId, index), content: call.output })) });
    };
    return { step, addResults, addUserText, injectTrace };
  }
}
