// Which embedding model serves the use "embeddings" (settings.json routing.embeddings): only one a person chose – "local" (this
// PC's small model) or a model id "<account or provider>:<model>", listed or not: that model, and only that (vectors of two
// models do not compare, so a choice that is unreachable says so instead of falling to another). "auto" (nothing chosen) and
// "off": none – finding goes by words (knowledge/words.ts; lane find 14.11.2026, bench: words put the right catalog entry first
// in 26 of 95 turns, MiniLM in 7, while MiniLM takes +370–530 MB of RAM).
// Owns: that rule. Never: embeds, stores or reads keys.

import type { RuntimeServices } from '../contracts.ts';
import { servesUse, useValue, USE_AUTO, USE_OFF } from '../../shared/model/models-uses.ts';
import { DECISION_PROVIDER, type Account } from '../../shared/model/providers.ts';
import { endpointFor, LOCAL_PROVIDERS } from '../engines/http/common.ts';

export type EmbeddingChoice =
  | { kind: 'local' }
  | { kind: 'http'; accountId: string; provider: string; baseUrl: string; model: string; local: boolean };

/** The name settings.json takes for this PC's own model. */
export const LOCAL_CHOICE = 'local';

type Services = Pick<RuntimeServices, 'catalog' | 'accounts' | 'settings'>;

const usable = (account: Account): boolean => account.enabled && account.auth !== 'cli' && account.provider !== DECISION_PROVIDER && account.state !== 'needs_login' && account.state !== 'disabled';
const isLocal = (account: Account): boolean => account.auth === 'local' || LOCAL_PROVIDERS.has(account.provider);

function endpoint(account: Account): string | undefined {
  try { return endpointFor(account); } catch { return undefined; }
}

function viaAccount(account: Account, model: string): EmbeddingChoice | undefined {
  const baseUrl = endpoint(account);
  return baseUrl ? { kind: 'http', accountId: account.id, provider: account.provider, baseUrl, model, local: isLocal(account) } : undefined;
}

/** Embedding models the connections list, each with its account. */
function listed(s: Services): Array<{ account: Account; model: string }> {
  let models: ReturnType<Services['catalog']['list']>;
  try { models = s.catalog.list(); } catch { models = []; }
  const accounts = s.accounts.list().filter(usable);
  return models.filter((model) => model.available && servesUse(model, 'embeddings')).flatMap((model) => {
    const account = accounts.find((entry) => entry.provider === model.provider && (!model.accounts.length || model.accounts.includes(entry.id)));
    return account ? [{ account, model: model.model }] : [];
  });
}

/** What serves embeddings now: the model a person chose; undefined = nothing chosen, off, or the choice unreachable. `localPossible`: this PC can run its own model. */
export function embeddingChoice(s: Services, localPossible: boolean): EmbeddingChoice | undefined {
  let value: string;
  try { value = useValue(s.settings.get().routing, 'embeddings'); } catch { return undefined; }
  if (value === USE_OFF || value === USE_AUTO) return undefined;
  if (value === LOCAL_CHOICE) return localPossible ? { kind: 'local' } : undefined;
  const at = value.indexOf(':');
  const owner = at > 0 ? value.slice(0, at) : undefined; // an account the file names, or a provider
  const model = at > 0 ? value.slice(at + 1) : value;
  const own = owner ? s.accounts.list().find((entry) => usable(entry) && entry.id === owner) : undefined;
  if (own) return viaAccount(own, model);
  const known = listed(s).find((entry) => entry.model === model && (!owner || entry.account.provider === owner));
  if (known) return viaAccount(known.account, known.model);
  const account = owner ? s.accounts.list().find((entry) => usable(entry) && entry.provider === owner) : undefined;
  return account ? viaAccount(account, model) : undefined;
}
