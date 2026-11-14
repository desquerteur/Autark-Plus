// AF-020: the side chat of a project's page (data-tour="project-chat") – the person's default 1:1 with one project agent
// (chats.direct, the same chat as "Message" on the agent; its home is the project folder, so it works in the project),
// right beside the page: no view switch. A top line names the agent (with "Lead") and opens the chat as the full chat
// view; under it the messages, the important-question strip and the one composer (chat/*), in a `.chat-column` so Esc
// stops the agent there like in the chat view. Loads the newest page and marks the chat read while it is shown.
// Owns: this pane and which 1:1 it shows. Never: message rendering or sending (chat/*), who works in the project.

import { useEffect, useState } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import type { Project } from '../../shared/model/project.ts';
import { activeConversationId, agentMap, conversationMap, conversations, ensureConversation, loadMessages, messagesFor, upsertById } from '../lib/store.ts';
import { rpc } from '../lib/rpc.ts';
import { go } from '../lib/router.ts';
import { toastError } from '../lib/toasts.ts';
import { EmptyState, Icon, IconButton, Spinner } from '../lib/ui.tsx';
import { AgentStatusAvatar, agentLine } from '../team/parts.tsx';
import { MessageList } from '../chat/MessageList.tsx';
import { AskStrip } from '../chat/AskStrip.tsx';
import { Composer } from '../chat/Composer.tsx';

/** agent id → the id of the person's 1:1 with it (asked once per window; chats.direct always answers the same chat). */
const directIds = new Map<string, string>();

/** The 1:1 with `agentId`: its conversation id once known, `failed` when chats.direct refused. */
function useDirect(agentId: string): { id?: string; failed: boolean } {
  const [state, setState] = useState<{ agentId: string; id?: string; failed: boolean }>({ agentId, id: directIds.get(agentId), failed: false });
  const online = rpc.status.value === 'open';
  useEffect(() => {
    const known = directIds.get(agentId);
    if (known) { setState({ agentId, id: known, failed: false }); return; }
    setState({ agentId, failed: false });
    if (!online) return;
    let alive = true;
    rpc.call('chats.direct', { memberId: agentId }).then((chat) => {
      upsertById(conversations, chat); // the row exists at once; conversation.upserted keeps it fresh
      directIds.set(agentId, chat.id);
      if (alive) setState({ agentId, id: chat.id, failed: false });
    }, (error) => {
      if (!alive) return;
      toastError(error, 'Could not open the chat');
      setState({ agentId, failed: true });
    });
    return () => { alive = false; };
  }, [agentId, online]);
  return state.agentId === agentId ? state : { failed: false };
}

/** The messages and the composer of one chat (the chat view's column without its header and docked tabs). */
function ChatColumn(props: { conversationId: string; label: string }) {
  const { conversationId } = props;
  const chat = conversationMap.value.get(conversationId);
  const list = messagesFor(conversationId);
  const loading = useSignal(true);
  // The window holds only the routed chat's topic (store-events.ts); this pane holds its own while shown – subscribed
  // before the page loads, so nothing in between is missed. Its cleanup leaves the topic to the routed chat when the
  // person opened this very chat as the full view (that effect may already hold it).
  useEffect(() => {
    const topic = `chat:${conversationId}` as const;
    rpc.subscribe([topic]);
    return () => { if (activeConversationId.peek() !== conversationId) rpc.unsubscribe([topic]); };
  }, [conversationId]);
  useEffect(() => {
    loading.value = true;
    loadMessages(conversationId)
      .catch((error) => toastError(error, 'Messages could not be loaded'))
      .finally(() => { loading.value = false; });
  }, [conversationId]);
  const missing = !chat;
  useEffect(() => { if (missing) void ensureConversation(conversationId).catch(() => undefined); }, [conversationId, missing]);
  // mark read while shown (like the chat view)
  const lastSeq = list.value.length ? list.value[list.value.length - 1].seq : 0;
  useEffect(() => {
    if (!chat || !lastSeq) return;
    const read = () => { if (chat.unread > 0) void rpc.call('chats.markRead', { id: conversationId, seq: lastSeq }).catch(() => undefined); };
    if (document.visibilityState === 'visible') read();
    const shown = () => { if (document.visibilityState === 'visible') read(); };
    document.addEventListener('visibilitychange', shown);
    return () => document.removeEventListener('visibilitychange', shown);
  }, [conversationId, lastSeq, chat?.unread]);
  if (!chat) return <div class="chat-missing"><Spinner /></div>;
  return (
    <section class="chat-column project-chat-column" aria-label={props.label}>
      <MessageList conversationId={conversationId} loading={loading.value && !list.value.length} start={null} />
      <AskStrip conversationId={conversationId} />
      <Composer chat={chat} />
    </section>
  );
}

export function ProjectChat(props: { project: Project; agentId?: string }) {
  const { project, agentId } = props;
  if (!agentId) {
    return (
      <aside class="project-chat" data-tour="project-chat" aria-label="Project chat">
        <div class="project-chat-empty"><EmptyState>Hire a lead or add an agent to this project to write with it here.</EmptyState></div>
      </aside>
    );
  }
  return <ProjectChatWith key={agentId} project={project} agentId={agentId} />;
}

function ProjectChatWith(props: { project: Project; agentId: string }) {
  const { project, agentId } = props;
  const agent = agentMap.value.get(agentId);
  const name = agent?.name ?? project.agents.find((entry) => entry.id === agentId)?.name ?? 'Agent';
  const lead = project.leadId === agentId;
  const direct = useDirect(agentId);
  const line = agent ? (agentLine(agent) || agent.role) : '';
  return (
    <aside class="project-chat" data-tour="project-chat" aria-label={`Chat with ${name}`}>
      <div class="project-chat-top">
        {agent && <AgentStatusAvatar agent={agent} size={28} />}
        <span class="project-chat-who">
          <span class="project-chat-name">{name}{lead && <span class="project-lead-mark"><Icon name="crown" size={12} />Lead</span>}</span>
          {line && <span class="project-chat-line">{line}</span>}
        </span>
        <IconButton icon="arrows-out-simple" size="small" label="Open as full chat" disabled={!direct.id} onClick={() => { if (direct.id) go.chat(direct.id); }} />
      </div>
      {direct.id
        ? <ChatColumn conversationId={direct.id} label={`Chat with ${name}`} />
        : <div class="chat-missing">{direct.failed ? <EmptyState>This chat could not be opened.</EmptyState> : <Spinner />}</div>}
    </aside>
  );
}
