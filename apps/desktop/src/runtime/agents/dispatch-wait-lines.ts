// A waiting line whose agent's home PC is out of reach gets one status line per chat and offline phase
// (the home's last-seen time). Reachability comes from the mesh's live link (devices.online): the stored row
// can stay 'online' after a crash or a kill.
// Owns: which chats get the home-PC waiting line. Never: claims, moves or drops a wake, or dials a PC.

import type { RuntimeServices } from '../contracts.ts';
import { DevicesRepo } from '../devices/repo.ts';

/** How many "cannot reach" keys are kept (oldest go first). */
const AWAY_KEYS = 500;

/** The chats where a line for the agent waits (its unclaimed message and answer wakes). */
function waitingChats(services: RuntimeServices, agentId: string): Set<string> {
  return new Set(services.wakes.list(agentId).filter((wake) => !wake.claimedAt && wake.conversationId && (wake.reason === 'message' || wake.reason === 'answer')).map((wake) => wake.conversationId!));
}

/** A line for an agent whose home PC this PC cannot reach now: one status line per chat and offline phase. */
export function noteAway(services: RuntimeServices, agentId: string, home: string, told: Set<string>): void {
  try {
    const record = new DevicesRepo(services.db).get(home);
    if (!record || services.devices.online(home)) return;
    const name = services.org.get(agentId)?.name ?? 'The agent';
    for (const conversationId of waitingChats(services, agentId)) {
      const key = `${home}:${record.lastSeenAt ?? 0}:${conversationId}`;
      if (told.has(key)) continue;
      told.add(key);
      if (told.size > AWAY_KEYS) told.delete(told.values().next().value!);
      services.chats.status(conversationId, { type: 'note', text: `${name} works on ${record.name}, which this PC cannot reach right now – the message goes over as soon as it is back.`, details: { waiting: { away: home } } }, { authorId: agentId });
    }
  } catch (error) {
    services.log.warn('away line not written', { agentId, error: String(error) });
  }
}
