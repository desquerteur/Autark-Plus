// What the new-chat dialog's "Start chat" does (B-050 K9, revised 12.11.2026 – Stanislaus: "kein neuer Chat
// erstellt" with an empty optional name): it always creates a new chat with the chosen agents and people and
// the topic as its title. Without a topic it is named like every untitled chat: each viewer sees the other
// members' names (shared/text/chat-names.ts displayTitle) until the first message gives it a topic (runtime
// chat/service.ts deriveTitle). The pair's default 1:1 stays one click away on "Message" (chat/direct.ts) –
// the dialog never silently opens an existing chat instead of the new one asked for.
// Owns: that decision. Never: calls RPC or reads the store (the caller says which ids are agents).

export interface NewChatPlan { title?: string; agentIds: string[]; people: string[] }

export function newChatPlan(selected: readonly string[], topic: string, isAgent: (id: string) => boolean): NewChatPlan | null {
  if (!selected.length) return null;
  const title = topic.trim();
  return {
    ...(title ? { title } : {}),
    agentIds: selected.filter((id) => isAgent(id)), people: selected.filter((id) => !isAgent(id)),
  };
}
