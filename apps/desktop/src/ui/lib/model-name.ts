// A model's short name as the composer's model chip, the working line and the model tag under a message say
// it: the catalog's name (models.list) without the vendor word ("Claude Opus 5.5" → "Opus 5.5", chat/live-text.ts
// shortModelName), else the id's last segment ("codex:gpt-6" → "gpt-6"). F05 (owner 12.11.2026): where it runs –
// the catalog's source ("Codex", "Claude Code", a connection's name; ModelInfo.source) – so the same name from two
// sources reads apart: the model picker's rows (pickerHints), the agent's "Now" row, a Work card and the activity log's
// turns.
// Owns: the catalog lookups and the picker rows' hints. Never: loads the catalog (the store's loadModels does).

import type { ModelInfo } from '../../shared/model/providers.ts';
import { models } from './store.ts';
import { shortModelName } from '../chat/live-text.ts';

const infoOf = (id: string) => models.value.find((model) => model.id === id || model.model === id);

export function modelShortName(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const info = infoOf(id);
  return info ? shortModelName(info.name) : id.split(':').pop();
}

/** F05: where a catalog model runs ("Codex", "Claude Code", a connection's name); undefined when the catalog does not say. */
export function modelSource(id: string | undefined): string | undefined {
  return id ? infoOf(id)?.source : undefined;
}

/** F05: a model's name with its source after it – "Opus 5.5 · Claude Code"; the name alone without a known source. */
export function nameWithSource(name: string, id: string | undefined): string {
  const source = modelSource(id);
  return name && source ? `${name} · ${source}` : name;
}

type Listed = Pick<ModelInfo, 'id' | 'model' | 'available' | 'source'>;

/** The last segment of a provider model id ("deepseek/deepseek-v4-flash" → "deepseek-v4-flash"). */
const lastSegment = (model: string) => model.split(/[/:]/).pop() || model;

/**
 * F05: each picker row's muted hint – its source; the model id's last segment after it when another row of the list
 * shows the same name from the same source (seven "DeepSeek V4" on one connection); "Unavailable" last.
 */
export function pickerHints(list: readonly Listed[], nameOf: (model: Listed) => string): Map<string, string> {
  const key = (model: Listed) => `${nameOf(model)}\n${model.source ?? ''}`;
  const count = new Map<string, number>();
  for (const model of list) count.set(key(model), (count.get(key(model)) ?? 0) + 1);
  return new Map(list.map((model) => {
    const twin = (count.get(key(model)) ?? 0) > 1;
    return [model.id, [model.source, twin ? lastSegment(model.model) : '', model.available ? '' : 'Unavailable'].filter(Boolean).join(' · ')];
  }));
}
