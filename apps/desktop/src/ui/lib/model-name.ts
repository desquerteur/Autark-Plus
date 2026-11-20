// A model's short name as the composer's model chip, the working line and the model tag under a message say
// it: the catalog's name (models.list) without the vendor word ("Claude Opus 5.5" → "Opus 5.5", chat/live-text.ts
// shortModelName), else the id's last segment ("codex:gpt-6" → "gpt-6"). F05 (owner 12.11.2026): where it runs –
// the catalog's source ("Codex", "Claude Code", a connection's name; ModelInfo.source) – so the same name from two
// sources reads apart: the model picker's rows (pickerDetails), the agent's "Now" row, a Work card and the activity log's
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

// F05: the full ID is visible even when no source is known (an older catalog).
export function pickerDetails(model: Pick<ModelInfo, 'id' | 'available' | 'source'>): string {
  return [model.source, model.id, model.available ? '' : 'Unavailable'].filter(Boolean).join(' · ');
}
