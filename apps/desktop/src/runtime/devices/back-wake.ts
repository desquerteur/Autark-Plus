// B-080 (live 05.–08.11.2026: agents built their own watchers for "peer connected", timed re-checks and to-dos asking
// the owner to wake the notebook): when a call of mine failed because a linked PC could not be reached
// (tools/registry.ts), I am woken once in that chat or task as soon as that PC is online again – the wake's note is
// "<PC> is reachable again.". One entry per agent, chat (or task) and PC; the wake clears them. In memory: a restart
// forgets them, and I look again myself.
// Owns: these entries and their one wake. Never: dials, waits, polls or repeats the failed call.

import type { RuntimeServices } from '../contracts.ts';

/** Who missed a PC: the agent and the chat or task its call came from. */
export interface Missed { agentId: string; conversationId?: string; taskId?: string }

type BackServices = Pick<RuntimeServices, 'bus' | 'wakes' | 'log'>;

/** Per runtime (its services object): device id → entries by agent and chat. */
const entries = new WeakMap<object, Map<string, Map<string, Missed>>>();

const where = (who: Missed): string => who.conversationId ?? `task:${who.taskId}`;

/** Notes that `who` could not reach `deviceId`; false (nothing noted) without a chat or task to wake it in. */
export function missed(services: object, deviceId: string, who: Missed): boolean {
  if (!deviceId || !who.agentId || (!who.conversationId && !who.taskId)) return false;
  let byDevice = entries.get(services);
  if (!byDevice) entries.set(services, byDevice = new Map());
  let list = byDevice.get(deviceId);
  if (!list) byDevice.set(deviceId, list = new Map());
  list.set(`${who.agentId}\u0000${where(who)}`, { agentId: who.agentId, conversationId: who.conversationId, taskId: who.taskId });
  return true;
}

/** The device.upserted listener (wired beside startSync, main.ts): a PC turning online wakes each of its entries once. */
export function wakeWhenBack(services: BackServices): () => void {
  return services.bus.on('device.upserted', (device) => {
    if (device.kind !== 'pc' || device.self || device.status !== 'online') return;
    const byDevice = entries.get(services);
    const list = byDevice?.get(device.id);
    if (!list) return;
    byDevice!.delete(device.id);
    for (const who of list.values()) {
      try {
        services.wakes.wake({
          agentId: who.agentId, reason: 'event', conversationId: who.conversationId, taskId: who.taskId,
          note: `${device.name} is reachable again.`, coalesceKey: `device-back:${device.id}:${where(who)}`,
        });
      } catch (error) {
        services.log.warn('back wake not queued', { agentId: who.agentId, deviceId: device.id, error: String(error) });
      }
    }
  });
}
