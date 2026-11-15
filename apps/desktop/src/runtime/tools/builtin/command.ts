// The command runner of shell.exec (files.ts): one shell command on this PC in a
// folder the caller resolved, with adaptive timeout reviews, an output cap and the run's abort. B-080: the shell is
// the caller's ShellSpawn – files.ts defaultShell: PowerShell on Windows (7 where found, else 5.1), sh on macOS and Linux.
// B-080 wave 3: output is decoded as UTF-8 per stream across reads, and each timeout review learns how many characters
// the command printed since the review before (newOutputChars) – the one fact between a working call and a hung one.
// B-044: `env` adds variables; a value may hold secret://<id> handles, resolved at spawn by the vault
// (secrets/handles.ts – owner 29.10.2026: every stored secret works in a command, any length – card data, CVCs and
// 2FA codes included). The output has each value the command received masked by its handle (its raw and encoded
// forms, any length – a short value that shows withholds the whole output; handles.ts maskValues), then passes the
// leak redactor like every tool output (tools/outputs.ts).
// B-072: the command starts in the engines' env (engines/wf-shim.ts agentEnv): `wf` is the app's client first on
// PATH (on Windows never system32's WF.msc) and AUTARK_DATA names this data folder; B-080: Codex's rg last on PATH
// (Windows) and PYTHONUTF8=1 come from the same env. B-085: AUTARK_AGENT = the calling agent (its `wf` writes as it),
// never for a linked PC's call (that agent is not one of this runtime's).
// Owns: the env checks, the spawn, the collection and the exit text. Never: logs the env or a value.

import { StringDecoder } from 'node:string_decoder';
import type { ToolContext, ToolOutput } from '../types.ts';
import { WorkforceError } from '../../../shared/errors.ts';
import { agentEnv, asAgent } from '../../engines/wf-shim.ts';
import { ENV_NAME, MAX_ENV, handlesIn, judgeHandles, resolveMasked, withHandles } from '../../secrets/handles.ts';
import type { ActionDescription } from '../types.ts';
import type { ShellSpawn } from './files.ts';
import { initialTimeoutSeconds, reviewToolTimeout, timeoutDecisionText } from '../timeout.ts';

const MAX_SHELL_OUTPUT = 64 * 1024;

/** The `env` argument of a command tool. */
export const ENV_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: { type: 'string', maxLength: 8000 },
  description: `Up to ${MAX_ENV} variables; a value can hold "secret://<id>" (e.g. "Bearer secret://<id>"), replaced only as the command starts – the value never reaches me and output showing it is masked. On Windows the command reads it as $env:NAME.`,
});

/** The env as given, checked (names, count); throws bad_request. */
export function checkEnv(env: Record<string, string> | undefined): Record<string, string> {
  const entries = Object.entries(env ?? {});
  if (entries.length > MAX_ENV) throw new WorkforceError('bad_request', `At most ${MAX_ENV} environment variables.`);
  for (const [name] of entries) if (!ENV_NAME.test(name)) throw new WorkforceError('bad_request', `"${name.slice(0, 40)}" is not an environment variable name (letters, digits, "_").`);
  return Object.fromEntries(entries);
}

/** A command call's action with its env secrets (the 'secret' category); a secret the env cannot take throws. */
export function commandAction(ctx: ToolContext, action: ActionDescription, env: Record<string, string> | undefined): ActionDescription {
  const ids = handlesIn(Object.values(checkEnv(env)));
  if (!ids.length) return action;
  const judged = judgeHandles(ctx, ids);
  if ('problem' in judged) throw new WorkforceError('forbidden', judged.problem);
  return withHandles(action, judged, 'in its environment', true);
}

export async function runCommand(shell: ShellSpawn, ctx: ToolContext, input: { command: string; cwd: string; timeoutSeconds?: number; env?: Record<string, string> }): Promise<ToolOutput> {
  const { values: extra, mask } = await resolveMasked(ctx, checkEnv(input.env)); // at spawn, never earlier
  if (ctx.signal.aborted) return { content: [{ type: 'text', text: 'Stopped before the command started.' }], isError: true };
  const controller = new AbortController();
  let review: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  let timedOut = false;
  let finish: (code: number | null) => void = () => {};
  const abort = () => { if (!done) { controller.abort(); finish(null); } };
  const started = Date.now();
  const decisions: string[] = [];
  let reviews = 0;
  const tool = 'shell.exec';
  let seconds = initialTimeoutSeconds(tool, input);
  let out = '';
  let recent = '';
  let printed = 0; // B-080 wave 3: characters received so far, and at the last review
  let looked = 0;
  let lookedAt = started; // B-080 wave 3 review: when that was – the seconds and the characters cover the same span
  // Keep enough overlap to mask a secret spanning chunks, including its encoded forms, before taking the visible tail.
  const overlap = Math.max(MAX_SHELL_OUTPUT, ...Object.values(extra).map((value) => value.length * 12));
  const take = (text: string) => {
    printed += text.length;
    if (out.length < MAX_SHELL_OUTPUT) out += text;
    recent = (recent + text).slice(-(overlap + 6000));
  };
  // B-080 wave 3: each stream decodes UTF-8 on its own across reads – a letter split between two reads stays whole.
  const decoders = [new StringDecoder('utf8'), new StringDecoder('utf8')];
  const collect = (decoder: StringDecoder) => (chunk: Buffer | string) => take(typeof chunk === 'string' ? chunk : decoder.write(chunk));
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      finish = (exitCode) => {
        if (done) return;
        done = true;
        review?.abort();
        resolve(exitCode);
      };
      const data = ctx.services.paths?.data;
      const agent = ctx.fromPc ? undefined : ctx.agent?.id; // B-085: a linked PC's agent is no agent of this runtime
      const child = shell(input.command, { cwd: input.cwd, signal: controller.signal, env: { ...(data ? agentEnv(data, { agent }) : asAgent(process.env, agent)), ...extra } });
      child.stdout?.on('data', collect(decoders[0]));
      child.stderr?.on('data', collect(decoders[1]));
      child.on('error', (error) => { if (controller.signal.aborted) finish(null); else { done = true; review?.abort(); reject(error); } });
      child.on('close', finish);
      const timeout = async () => {
        if (done || ctx.signal.aborted) return;
        review = new AbortController();
        ctx.status('Reviewing command timeout');
        const now = Date.now();
        const observation = { tool, args: { command: input.command, cwd: input.cwd }, elapsedSeconds: Math.round((now - started) / 1000), timeoutSeconds: seconds, output: mask(recent).slice(-6000), newOutputChars: printed - looked, secondsSinceLastLook: Math.round((now - lookedAt) / 1000) };
        looked = printed;
        lookedAt = now;
        const decision = await reviewToolTimeout(ctx, observation, review.signal);
        if (done || ctx.signal.aborted) return;
        decisions.push(timeoutDecisionText(observation, decision));
        reviews++;
        if (decisions.length > 20) decisions.shift();
        ctx.status(decisions.at(-1)!.slice(0, 140));
        if (decision.action === 'wait') { seconds = decision.seconds!; timer = setTimeout(() => { void timeout(); }, seconds * 1000); }
        else { timedOut = true; abort(); }
      };
      ctx.signal.addEventListener('abort', abort, { once: true });
      if (ctx.signal.aborted) abort();
      else timer = setTimeout(() => { void timeout(); }, seconds * 1000);
    });
    for (const decoder of decoders) take(decoder.end()); // an incomplete letter left at the end
    const seen = mask(out); // before the cap: a value cut in half would no longer be recognised
    const body = seen.length >= MAX_SHELL_OUTPUT ? `${seen.slice(0, MAX_SHELL_OUTPUT)}\n… [output capped]` : seen;
    const earlier = reviews > decisions.length ? [`${reviews - decisions.length} earlier timeout decisions are recorded in the run journal.`] : [];
    return { content: [{ type: 'text', text: ctx.services.secrets.redact(mask([...earlier, ...decisions, `exit ${timedOut ? 'timeout' : code ?? 'killed'}\n${body}`].join('\n'))) }], isError: timedOut || code !== 0 };
  } finally {
    clearTimeout(timer);
    review?.abort();
    ctx.signal.removeEventListener('abort', abort);
  }
}
