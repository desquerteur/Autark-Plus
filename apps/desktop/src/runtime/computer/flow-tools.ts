// computer.wait and computer.batch, on the model of browser.wait and browser.batch (KI-Runde 17.11.2026: 297 shell calls
// that only slept between screen steps, seven round trips per repeated cycle, and an agent's lookup for "computer batch
// several steps"):
// - computer.wait waits until an element whose name holds a text shows in a window, a window whose title holds a text
//   is open, or simply for a time – checking about once a second, up to WAIT_MAX_MS – and answers what it found (the
//   element lines carry refs for computer.act).
// - computer.batch runs up to BATCH_MAX steps of the acting tools (act, click, type, key, scroll, drag, wait) in order in
//   one call, each checked against its own tool's schema, stopping at the first that fails; I get how many ran and each
//   step's answer. The steps are the tools themselves (computer/tools.ts passes them in), so a step is what a direct call
//   would be – its summary, its secret handling, its read-back.
// Owns: the two tools' schemas, the wait loop and the batch's run and answer. Never: retries a step, or runs a step a
// direct call of its tool would refuse.

import type { ActionDescription, ToolContext, ToolDef, ToolOutput } from '../tools/types.ts';
import { failure, text } from '../tools/types.ts';
import { defineTool } from '../tools/builtin/util.ts';
import { coerce, validate } from '../tools/validate.ts';
import { WorkforceError } from '../../shared/errors.ts';
import type { ComputerService, WindowInfo } from './service.ts';
import { deviceAction as device, onThisPc, type RefLabels, type WindowApps } from './seen.ts';
import { callerOf } from './lease.ts';

export const WAIT_MAX_MS = 60_000;
/** A wait for a text or title without its own time waits this long at most. */
const WAIT_DEFAULT_MS = 15_000;
const POLL_MS = 1_000;
export const BATCH_MAX = 20;
/** The tools a batch step may be, by the short name the step uses. */
export const BATCH_STEPS = ['act', 'click', 'type', 'key', 'scroll', 'drag', 'wait'] as const;

const seconds = (ms: number) => Math.round(ms / 100) / 10;

/** Waits `ms`, or until the call is stopped. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new WorkforceError('cancelled', 'Stopped.')); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, Math.max(0, ms));
    const stop = () => { clearTimeout(timer); reject(new WorkforceError('cancelled', 'Stopped.')); };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

type WaitArgs = { text?: string; title?: string; window?: number; ms?: number };

export function waitTool(computer: ComputerService, refLabels: RefLabels, apps: WindowApps, now: () => number = Date.now): ToolDef {
  return defineTool<WaitArgs>({
    name: 'computer.wait',
    description: `Waits until an element whose name holds a text shows in a window, or a window whose title holds a text is open – or simply for ms – up to ${WAIT_MAX_MS / 1000} s. Then I get what came, with refs for computer.act.`,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 200, description: 'Part of an element\'s name.' },
        title: { type: 'string', minLength: 1, maxLength: 200, description: 'Part of a window\'s title; with text, the element is looked for in that window.' },
        window: { type: 'integer', description: 'The window to look in; default the one in front.' },
        ms: { type: 'integer', minimum: 100, maximum: WAIT_MAX_MS, description: `How long at most; alone, how long to wait. Default ${WAIT_DEFAULT_MS / 1000} s.` },
      },
      additionalProperties: false,
    },
    category: 'device', remote: true, requires: 'device',
    describe: (args, ctx) => device(args.text || args.title ? `Wait for "${String(args.text ?? args.title).slice(0, 60)}"` : `Wait ${seconds(args.ms ?? 0)} s`, ctx, true),
    async run(args, ctx) {
      if (!args.text && !args.title && args.ms === undefined) throw new WorkforceError('bad_request', 'Give text, title or ms.');
      const limit = Math.min(WAIT_MAX_MS, Math.max(100, args.ms ?? WAIT_DEFAULT_MS));
      const started = now();
      ctx.status('waiting on the screen');
      if (!args.text && !args.title) {
        await pause(limit, ctx.signal);
        return text(`Waited ${seconds(now() - started)} s.`);
      }
      const caller = callerOf(ctx);
      for (;;) {
        let window: WindowInfo | undefined;
        if (args.title) {
          const list = await computer.windows(ctx.signal);
          if (onThisPc(ctx)) apps.learn(list);
          const wanted = args.title.toLowerCase();
          window = list.find((item) => item.title.toLowerCase().includes(wanted));
        }
        if (window && !args.text) return text(`Waited ${seconds(now() - started)} s: it came – window ${window.hwnd} "${window.title}" · ${window.process || 'unknown'}.`);
        if (args.text && (window || !args.title)) {
          const where = window?.hwnd ?? args.window;
          const found = await computer.find({ window: where, name: args.text, signal: ctx.signal, caller });
          if (found.count) {
            refLabels.learn(found.text, where ?? apps.front);
            return text(`Waited ${seconds(now() - started)} s: it came.\n${found.text}`);
          }
        }
        if (now() - started + POLL_MS > limit) return text(`Waited ${seconds(now() - started)} s: it did not come in time.`);
        await pause(POLL_MS, ctx.signal);
      }
    },
  });
}

type Step = { tool: (typeof BATCH_STEPS)[number]; args?: Record<string, unknown> };

/** The text parts of a step's answer. */
const said = (output: ToolOutput): string => output.content.filter((part) => part.type === 'text').map((part) => (part as { text: string }).text).join('\n').trim();

/** computer.batch over the tools its steps name (computer.<step>). */
export function batchTool(tools: readonly ToolDef[]): ToolDef {
  const byStep = new Map(tools.map((tool) => [tool.name.replace(/^computer\./, ''), tool]));
  const stepTool = (step: Step): ToolDef => {
    const tool = byStep.get(step.tool);
    if (!tool) throw new WorkforceError('bad_request', `A batch step is one of ${BATCH_STEPS.join(', ')}.`);
    return tool;
  };
  return defineTool<{ steps: Step[] }>({
    name: 'computer.batch',
    description: `Runs up to ${BATCH_MAX} steps of computer.act, click, type, key, scroll, drag and wait in one call, in order, stopping at the first that fails. I get how many ran and each step's answer.`,
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array', minItems: 1, maxItems: BATCH_MAX,
          items: {
            type: 'object',
            properties: { tool: { type: 'string', enum: [...BATCH_STEPS] }, args: { type: 'object', description: 'The arguments that tool takes.' } },
            required: ['tool'], additionalProperties: false,
          },
        },
      },
      required: ['steps'], additionalProperties: false,
    },
    category: 'device', remote: true, requires: 'device',
    describe: (args, ctx): ActionDescription => {
      const steps = args.steps.map((step) => {
        const tool = stepTool(step);
        return tool.describe ? tool.describe(coerce(step.args ?? {}, tool.inputSchema) as Record<string, unknown>, ctx) : { summary: tool.name, external: false };
      });
      return {
        summary: `Batch of ${steps.length}: ${steps.map((step) => step.summary).join('; ')}`.slice(0, 900),
        resource: steps.find((step) => step.resource)?.resource,
        reversible: steps.every((step) => step.reversible === true),
        external: steps.some((step) => step.external),
      };
    },
    async run(args, ctx: ToolContext) {
      const lines: string[] = [];
      let ran = 0;
      let stopped: string | undefined;
      for (const [index, step] of args.steps.entries()) {
        const tool = stepTool(step);
        const given = coerce(step.args ?? {}, tool.inputSchema);
        const errors = validate(given, tool.inputSchema);
        if (errors.length) { stopped = `#${index + 1} ${tool.name}: invalid arguments – ${errors.join('; ')}`; break; }
        let output: ToolOutput;
        try { output = await tool.run(given as Record<string, unknown>, ctx); } catch (error) {
          stopped = `#${index + 1} ${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`;
          break;
        }
        ran++;
        lines.push(`#${index + 1} ${tool.name}: ${said(output)}`);
        if (output.isError) { stopped = `#${index + 1} ${tool.name} did not do what it should (above).`; break; }
      }
      const head = `Ran ${ran} of ${args.steps.length} steps.${stopped ? ` Stopped: ${stopped}` : ''}`;
      const body = [head, ...lines].join('\n');
      return stopped ? failure(body) : text(body);
    },
  });
}
