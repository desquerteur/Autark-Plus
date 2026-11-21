// The small model tag under a message or a task (B-050 K6, the owner's 28.10. "wenn man ein Modell angibt, wird das
// einfach unter der Nachricht hingeschrieben … So würde ich das auch bei Task machen"): a person's message that asked
// for a model (meta.modelHint, stamped by the runtime) shows its short name; Auto shows nothing. B-083 (owner 08.11.:
// a picked model is "nur … ein kleiner Tipp"): every stamp reads "Suggested: …", also an older one stamped `pinned`.
// An external author's tag is never shown (its meta is untrusted). Kept apart from the model a message was written
// on (meta.model – only in the time's tooltip): this one is a recommendation for whoever takes the work.
// Owns: which messages carry a tag, and its words. Never: renders, or loads the model catalog (`nameOf`).

import type { Message, ModelTag } from '../../shared/model/chat.ts';
import { EFFORT_LABEL } from './live-text.ts';

export interface ModelTagView {
  /** The model's short name (the catalog's, else the id's last segment). */
  name: string;
  /** Always false since B-083 (every stamp is a suggestion); kept while ModelTagMark.tsx still reads it. */
  pinned: boolean;
  /** The tooltip: "Suggested: …", with the effort when one was suggested. */
  title: string;
}

type NameOf = (id: string) => string | undefined;

function view(hint: ModelTag | undefined, nameOf: NameOf): ModelTagView | undefined {
  if (!hint || typeof hint.modelId !== 'string' || hint.modelId === 'auto') return undefined;
  const name = nameOf(hint.modelId);
  if (!name) return undefined;
  const effort = !hint.effort ? '' : ` · ${Object.prototype.hasOwnProperty.call(EFFORT_LABEL, hint.effort) ? EFFORT_LABEL[hint.effort as keyof typeof EFFORT_LABEL] : hint.effort}`;
  return { name, pinned: false, title: `Suggested: ${name}${effort}` };
}

/** The tag of a person's or an agent's message; none for Auto, external authors and status lines. */
export function messageModelTag(message: Pick<Message, 'authorKind' | 'kind' | 'meta'>, nameOf: NameOf): ModelTagView | undefined {
  if ((message.authorKind !== 'human' && message.authorKind !== 'agent') || message.kind === 'status') return undefined;
  return view(message.meta.modelHint as ModelTag | undefined, nameOf);
}

