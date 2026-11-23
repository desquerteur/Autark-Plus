// B-078 (D14, D16): which engine and model take the temperature an agent asks for (model.set) – one answer for the tool's
// reply, read from the adapters' own rules. Owner 09.11. (B-083): thinking is never turned off for a temperature – "Es ist
// unbedingt wichtig. Ohne das funktioniert das nicht gut." So a temperature goes along only where it costs no thinking: the
// compatible engine sends it beside its models' reasoning except to Gemini 3 and later and to a gateway's Claude and GPT ids
// above effort none, the OpenAI API to models without reasoning and to a step that runs at effort none anyway, the Anthropic
// API to the older Claude models that run without thinking anyway; Claude Code (it always thinks), Codex and the ACP CLIs
// keep their own. Claude takes a temperature only without thinking, on the plan and the API alike (live 09.11.2026,
// .local/b083/experiments/deep/claude-matrix.md). With the step's effort the answer matches what the engine sends; without
// one a reasoning model counts as reasoning.
// Owns: that yes/no and TEMPERATURE_FACT, the sentence of where a temperature reaches (model.set's answer, "## Now").
// Never: sends anything or decides the value an adapter puts on the wire (the adapters do).

import type { Effort } from '../../../shared/model/providers.ts';
import { anthropicTemperature } from './anthropic.ts';
import { compatibleTemperature } from './compatible.ts';
import { openAiTemperature } from './openai.ts';

/** Where a temperature reaches, in my voice (first person, a fact): model.set's answer and the "## Now" stance line. */
export const TEMPERATURE_FACT = 'my thinking comes first, so a temperature goes only where it costs none: to the API and local models that take one (models.list marks them); Claude and Codex keep their own setting (older Claude models take one only without thinking, the newer ones none, Codex not at all) – there my drafts carry the variety';

/** True when a turn of this engine on this provider model (at this effort) sends the temperature. */
export function takesTemperature(engine: string, model: string, effort?: Effort): boolean {
  if (engine === 'fake') return true;
  if (engine === 'compatible') return compatibleTemperature(model, 1, effort) !== undefined;
  if (engine === 'openai') return openAiTemperature(model, 1, effort) !== undefined;
  if (engine === 'anthropic') return anthropicTemperature(model, 1) !== undefined;
  return false;
}
