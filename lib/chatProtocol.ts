/** KloudMeet meeting chat wire + persistence helpers (text + livedoc attachment). */

export type ChatAttachmentStatus = 'ready' | 'converting' | 'failed' | 'uploading';

export interface ChatAttachment {
  itemId: number;
  attachmentId?: number;
  fileName: string;
  livedocInstanceId?: string;
  status: ChatAttachmentStatus;
}

export type ChatMessageKind = 'text' | 'livedoc';

export interface ChatMsg {
  clientMessageId: string;
  senderIdentity: string;
  senderName: string;
  message: string;
  timestamp: number;
  isLocal: boolean;
  kind?: ChatMessageKind;
  attachment?: ChatAttachment;
}

export interface ChatWireMessage {
  type: 'chat';
  clientMessageId?: string;
  senderIdentity: string;
  senderName: string;
  message: string;
  timestamp: number;
  kind?: ChatMessageKind;
  attachment?: ChatAttachment;
}

interface PersistedChatPayloadV1 {
  v: 1;
  kind: 'livedoc';
  message: string;
  attachment: ChatAttachment;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isChatAttachment(value: unknown): value is ChatAttachment {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isFiniteNumber(candidate.itemId) &&
    typeof candidate.fileName === 'string' &&
    (candidate.status === 'ready' ||
      candidate.status === 'converting' ||
      candidate.status === 'failed' ||
      candidate.status === 'uploading') &&
    (candidate.attachmentId === undefined || isFiniteNumber(candidate.attachmentId)) &&
    (candidate.livedocInstanceId === undefined || typeof candidate.livedocInstanceId === 'string')
  );
}

export function isChatWireMessage(value: unknown): value is ChatWireMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.type !== 'chat' ||
    (candidate.clientMessageId !== undefined && typeof candidate.clientMessageId !== 'string') ||
    typeof candidate.senderIdentity !== 'string' ||
    typeof candidate.senderName !== 'string' ||
    typeof candidate.message !== 'string' ||
    !isFiniteNumber(candidate.timestamp)
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

export function getChatMessageId(message: ChatWireMessage): string {
  return (
    message.clientMessageId ??
    `legacy:${message.senderIdentity}:${message.timestamp}:${message.message}`
  );
}

export function wireToChatMsg(
  data: ChatWireMessage,
  localIdentity: string,
): ChatMsg {
  return {
    clientMessageId: getChatMessageId(data),
    senderIdentity: data.senderIdentity,
    senderName: data.senderName,
    message: data.message,
    timestamp: data.timestamp,
    isLocal: data.senderIdentity === localIdentity,
    kind: data.kind === 'livedoc' ? 'livedoc' : data.attachment ? 'livedoc' : 'text',
    attachment: data.attachment,
  };
}

/** Encode rich chat for DB `content` column (plain text stays plain). */
export function encodeChatContent(input: {
  message: string;
  kind?: ChatMessageKind;
  attachment?: ChatAttachment;
}): string {
  if (input.kind === 'livedoc' && input.attachment) {
    const payload: PersistedChatPayloadV1 = {
      v: 1,
      kind: 'livedoc',
      message: input.message,
      attachment: input.attachment,
    };
    return JSON.stringify(payload);
  }
  return input.message;
}

/** Decode DB `content` back to message + optional attachment. */
export function decodeChatContent(content: string): {
  message: string;
  kind?: ChatMessageKind;
  attachment?: ChatAttachment;
} {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) {
    return { message: content };
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (
      parsed.v === 1 &&
      parsed.kind === 'livedoc' &&
      typeof parsed.message === 'string' &&
      isChatAttachment(parsed.attachment)
    ) {
      return {
        message: parsed.message,
        kind: 'livedoc',
        attachment: parsed.attachment,
      };
    }
  } catch {
    // fall through — treat as plain text
  }
  return { message: content };
}

export function createChatMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getLiveDocIframe(): HTMLIFrameElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('iframe[title="LiveDoc"]');
}

export function postToLiveDocIframe(payload: Record<string, unknown>): boolean {
  const iframe = getLiveDocIframe();
  if (!iframe?.contentWindow) return false;
  iframe.contentWindow.postMessage(payload, '*');
  return true;
}

export const CHAT_UPLOAD_RESULT_TYPE = 'Kloud-ChatUploadResult';
export const CHAT_UPLOAD_REQUEST_TYPE = 'Kloud-ChatUploadFile';
export const CHAT_OPEN_DOCUMENT_TYPE = 'Kloud-OpenDocument';
export const CHAT_PING_TYPE = 'Kloud-ChatPing';
export const CHAT_PONG_TYPE = 'Kloud-ChatPong';
