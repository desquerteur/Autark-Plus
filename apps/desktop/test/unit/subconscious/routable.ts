// Test helper: fake services that route – one Codex plan account for their connected models (the fixtures' model() lists 'acc_1')
// and the routing settings the router's pool reads (routing/pool.ts buildPool); `models` replaces the catalog's list.
// Owns: that setup only. Never: real accounts or engines.

import type { RuntimeServices } from '../../../src/runtime/contracts.ts';
import type { ModelInfo } from '../../../src/shared/model/providers.ts';
import { account } from '../models/harness.ts';

export function routable(services: RuntimeServices, models?: ModelInfo[]): void {
  const plan = account('acc_1', 'codex');
  const { settings, catalog, accounts } = services;
  Object.assign(services, {
    ...(models ? { catalog: { ...catalog, list: () => models, get: (id: string) => models.find((item) => item.id === id) } } : {}),
    accounts: { ...accounts, list: () => [plan], candidates: () => [plan] },
    settings: {
      ...settings,
      get: () => {
        const now = (settings?.get?.() ?? {}) as ReturnType<RuntimeServices['settings']['get']>;
        return { ...now, routing: { ...now.routing, allowPaidFallback: now.routing?.allowPaidFallback ?? false } };
      },
    },
  });
}
