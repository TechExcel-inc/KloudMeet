import { isChatAttachment, type ChatAttachment, type ChatMsg } from '@/lib/chatProtocol';

export interface PersistedChatMessage {
  clientMessageId: string;
  senderIdentity: string;
  senderName: string;
  message: string;
  timestamp: number;
  kind?: ChatMsg['kind'];
  attachment?: ChatAttachment;
}

export interface ChatHistoryResponse {
  messages?: unknown;
}

/** isPersistedChatMessage — 校验 /chat-messages 返回的单条历史消息 */
export function isPersistedChatMessage(value: unknown): value is PersistedChatMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.clientMessageId !== 'string' ||
    typeof candidate.senderIdentity !== 'string' ||
    typeof candidate.senderName !== 'string' ||
    typeof candidate.message !== 'string' ||
    typeof candidate.timestamp !== 'number' ||
    !Number.isFinite(candidate.timestamp)
  ) {
    return false;
  }
  if (candidate.kind !== undefined && candidate.kind !== 'text' && candidate.kind !== 'livedoc') {
    return false;
  }
  if (candidate.attachment !== undefined && !isChatAttachment(candidate.attachment)) {
    return false;
  }
  return true;
}

/** mergeChatMessages — 按 clientMessageId 去重合并，结果按时间升序 */
export function mergeChatMessages(current: ChatMsg[], incoming: ChatMsg[]): ChatMsg[] {
  const byId = new Map(current.map((message) => [message.clientMessageId, message]));
  for (const message of incoming) {
    byId.set(message.clientMessageId, message);
  }
  return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp);
}
