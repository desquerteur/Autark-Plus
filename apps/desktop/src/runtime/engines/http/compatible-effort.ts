// Owns: documented per-model Compatible effort metadata and its exact request encoding.
// Never: infers effort support from a provider or model name alone. Unknown means omission, not thinking disabled.
// Sources (checked 2026-11-10): openrouter.ai/docs/guides/best-practices/reasoning-tokens;
// api-docs.deepseek.com/api/list-models/ and guides/thinking_mode/.
import type { Effort, ProviderId } from '../../../shared/model/providers.ts';
import { isRecord } from '../shared.ts';
import { clampEffort, EFFORT_ORDER } from '../../models/efforts.ts';

// Wire allowlists are exact, not the UI's aliases (minimal is not low on every server).
const levelsOf = (values: unknown[]) => EFFORT_ORDER.filter((e) => values.includes(e));
const exactEffort = (value: unknown) => EFFORT_ORDER.find((e) => e === value);

export interface CompatibleEffort {
  efforts: Effort[];
  defaultEffort?: Effort;
  wire?: 'openrouter' | 'deepseek';
}

/** Only explicit, protocol-specific model metadata grants control. A generic supported_parameters flag is insufficient. */
export function compatibleEffort(provider: ProviderId, raw: Record<string, unknown>): CompatibleEffort {
  if (provider === 'openrouter' && isRecord(raw.reasoning)) {
    const r = raw.reasoning;
    const levels = r.supported_efforts === null ? ['none', 'low', 'medium', 'high', 'xhigh', 'max'] : r.supported_efforts;
    if (Array.isArray(levels)) {
      const efforts = levelsOf(levels).filter((e) => e !== 'none' || r.mandatory !== true);
      if (efforts.length) {
        const value = r.default_enabled === false && efforts.includes('none') ? 'none' : exactEffort(r.default_effort);
        return { efforts, ...(value && efforts.includes(value) ? { defaultEffort: value } : {}), wire: 'openrouter' };
      }
    }
  }
  if (provider === 'deepseek' && isRecord(raw.effort) && Array.isArray(raw.effort.supported_levels)) {
    const levels = levelsOf(raw.effort.supported_levels).filter((e) => e === 'low' || e === 'high' || e === 'max');
    if (levels.length) {
      const value = exactEffort(raw.effort.default_level);
      const canDisable = raw.id === 'deepseek-flash' || raw.id === 'deepseek-v4-pro';
      return { efforts: [...(canDisable ? ['none' as const] : []), ...levels], ...(value && levels.some((level) => level === value) ? { defaultEffort: value } : {}), wire: 'deepseek' };
    }
  }
  return { efforts: ['none'] };
}

/** `none` is explicit disable only for supported profiles. With no profile it means no control / provider default. */
export function compatibleReasoning(profile: CompatibleEffort, wanted: Effort): Record<string, unknown> {
  if (!profile.wire) return {};
  const effort = clampEffort(wanted, profile.efforts);
  if (profile.wire === 'openrouter') return { reasoning: { effort } };
  return effort === 'none' ? { thinking: { type: 'disabled' } } : { reasoning_effort: effort };
}
