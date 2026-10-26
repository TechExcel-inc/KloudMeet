'use client';

import React from 'react';
import {
  DataPacket_Kind,
  RoomEvent,
  type RemoteParticipant,
  type Room,
} from 'livekit-client';
import { ChatPanel } from '@/lib/ChatAndAttendeePanel';
import {
  CHAT_OPEN_DOCUMENT_TYPE,
  CHAT_PING_TYPE,
  CHAT_PONG_TYPE,
  CHAT_UPLOAD_REQUEST_TYPE,
  CHAT_UPLOAD_RESULT_TYPE,
  createChatMessageId,
  getLiveDocIframe,
  isChatWireMessage,
  postToLiveDocIframe,
  wireToChatMsg,
  type ChatAttachment,
  type ChatMsg,
  type ChatWireMessage,
} from '@/lib/chatProtocol';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { useI18n } from '@/lib/i18n';
import type { ConnectionDetails } from '@/lib/types';
import type { ViewMode } from '@/lib/KloudMeetToolbar';
import { isPersistedChatMessage, mergeChatMessages, type ChatHistoryResponse } from './roomChatHistory';

const CHAT_TOPIC = 'kloud-chat';

export interface MeetingChatOptions {
  room: Room;
  meetingRoomName: string;
  livedocInstanceId: string | null;
  connectionDetailsRef: React.MutableRefObject<ConnectionDetails>;
  setLivedocHasBeenActivated: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveView: React.Dispatch<React.SetStateAction<ViewMode>>;
}

export interface MeetingChatApi {
  chatMessages: ChatMsg[];
  chatAttachBusy: boolean;
  sendChatMessage: (text: string) => void;
  handleAttachFile: (file: File) => Promise<void>;
  openLivedocFromChat: (msg: ChatMsg) => Promise<void>;
  chatPanelNode: React.ReactNode;
}

/**
 * useMeetingChat — 会中文字聊天、历史拉取、以及经 LiveDoc iframe 的文件分享
 */
export function useMeetingChat({
  room,
  meetingRoomName,
  livedocInstanceId,
  connectionDetailsRef,
  setLivedocHasBeenActivated,
  setActiveView,
}: MeetingChatOptions): MeetingChatApi {
  const { t } = useI18n();
  const chatEncoder = React.useMemo(() => new TextEncoder(), []);
  const chatDecoder = React.useMemo(() => new TextDecoder(), []);
  const [chatMessages, setChatMessages] = React.useState<ChatMsg[]>([]);
  const [chatAttachBusy, setChatAttachBusy] = React.useState(false);
  const pendingChatUploadRef = React.useRef<{ requestId: string } | null>(null);
  const livedocInstanceIdRef = React.useRef(livedocInstanceId);
  livedocInstanceIdRef.current = livedocInstanceId;

  const waitForLiveDocIframe = React.useCallback(async (timeoutMs = 20000): Promise<boolean> => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (getLiveDocIframe()?.contentWindow) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
    return !!getLiveDocIframe()?.contentWindow;
  }, []);

  const waitForLivedocInstanceId = React.useCallback(async (timeoutMs = 25000): Promise<string | null> => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const id = livedocInstanceIdRef.current;
      if (id) return id;
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
    return livedocInstanceIdRef.current;
  }, []);

  const waitForLiveDocPluginReady = React.useCallback(async (timeoutMs = 25000): Promise<boolean> => {
    const iframe = getLiveDocIframe();
    if (!iframe?.contentWindow) return false;
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(ok);
      };
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { type?: unknown } | null;
        if (!data || typeof data !== 'object' || data.type !== 'onkloudloaded') return;
        if (event.source && event.source !== iframe.contentWindow) return;
        finish(true);
      };
      const timer = window.setTimeout(() => finish(false), timeoutMs);
      window.addEventListener('message', onMessage);
    });
  }, []);

  /** Confirm MainStage OnMessage is listening (works even if onkloudloaded already fired). */
  const waitForLiveDocChatBridge = React.useCallback(async (timeoutMs = 20000): Promise<boolean> => {
    const started = Date.now();
    const pingId = createChatMessageId();
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        window.clearInterval(pingTimer);
        window.clearTimeout(deadline);
        window.removeEventListener('message', onMessage);
        resolve(ok);
      };
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { type?: unknown; requestId?: unknown } | null;
        if (!data || typeof data !== 'object' || data.type !== CHAT_PONG_TYPE) return;
        if (data.requestId && data.requestId !== pingId) return;
        finish(true);
      };
      const ping = () => {
        postToLiveDocIframe({ type: CHAT_PING_TYPE, requestId: pingId });
      };
      window.addEventListener('message', onMessage);
      ping();
      const pingTimer = window.setInterval(ping, 500);
      const deadline = window.setTimeout(() => finish(false), timeoutMs);
      void (async () => {
        while (!settled && Date.now() - started < timeoutMs) {
          if (!getLiveDocIframe()?.contentWindow) {
            await new Promise((r) => window.setTimeout(r, 200));
            continue;
          }
          await new Promise((r) => window.setTimeout(r, 500));
        }
      })();
    });
  }, []);

  const ensureLiveDocViewReady = React.useCallback(async (): Promise<boolean> => {
    setLivedocHasBeenActivated(true);
    setActiveView('liveDoc');
    const id = await waitForLivedocInstanceId();
    if (!id) return false;
    const iframeReady = await waitForLiveDocIframe();
    if (!iframeReady) return false;
    const bridgeReady = await waitForLiveDocChatBridge(25000);
    if (!bridgeReady) {
      const pluginOk = await waitForLiveDocPluginReady(5000);
      if (!pluginOk) return false;
      const retry = await waitForLiveDocChatBridge(10000);
      if (!retry) return false;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    return true;
  }, [
    waitForLiveDocIframe,
    waitForLivedocInstanceId,
    waitForLiveDocPluginReady,
    waitForLiveDocChatBridge,
    setLivedocHasBeenActivated,
    setActiveView,
  ]);

  const persistChatMessage = React.useCallback(
    async (body: {
      clientMessageId: string;
      message: string;
      kind?: ChatMsg['kind'];
      attachment?: ChatAttachment;
    }): Promise<void> => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetchWithTimeout(
            `/api/meetings/${encodeURIComponent(meetingRoomName)}/chat-messages`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${connectionDetailsRef.current.participantToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
            },
          );
          if (response.ok || response.status < 500) return;
        } catch (error) {
          if (attempt === 1 || (error instanceof Error && error.name === 'AbortError')) return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
    },
    [meetingRoomName, connectionDetailsRef],
  );

  const publishChatWire = React.useCallback(
    (wire: ChatWireMessage) => {
      const payload = chatEncoder.encode(JSON.stringify(wire));
      room.localParticipant
        .publishData(payload, { reliable: true, topic: CHAT_TOPIC })
        .catch(() => {
          room.localParticipant.publishData(payload, { topic: CHAT_TOPIC }).catch(console.error);
        });
    },
    [room, chatEncoder],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    const loadChatHistory = async (): Promise<void> => {
      try {
        const response = await fetchWithTimeout(
          `/api/meetings/${encodeURIComponent(meetingRoomName)}/chat-messages`,
          {
            cache: 'no-store',
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${connectionDetailsRef.current.participantToken}`,
            },
          },
        );
        if (!response.ok) return;

        const body = (await response.json()) as ChatHistoryResponse;
        if (!Array.isArray(body.messages)) return;
        const history = body.messages
          .filter(isPersistedChatMessage)
          .map<ChatMsg>((message) => ({
            clientMessageId: message.clientMessageId,
            senderIdentity: message.senderIdentity,
            senderName: message.senderName,
            message: message.message,
            timestamp: message.timestamp,
            isLocal: message.senderIdentity === room.localParticipant.identity,
            kind: message.kind,
            attachment: message.attachment,
          }));
        setChatMessages((current) => mergeChatMessages(current, history));
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    };

    void loadChatHistory();
    return () => controller.abort();
  }, [meetingRoomName, room.localParticipant.identity, connectionDetailsRef]);

  React.useEffect(() => {
    const handleChatData = (
      payload: Uint8Array,
      _participant?: RemoteParticipant,
      _kind?: DataPacket_Kind,
      topic?: string,
    ) => {
      if (topic !== CHAT_TOPIC) return;
      try {
        const data: unknown = JSON.parse(chatDecoder.decode(payload));
        if (!isChatWireMessage(data)) return;
        const incoming = wireToChatMsg(data, room.localParticipant.identity);
        setChatMessages((current) => mergeChatMessages(current, [incoming]));
      } catch (e) {
        console.error('Chat message parse error:', e);
      }
    };
    room.on(RoomEvent.DataReceived, handleChatData);
    return () => {
      room.off(RoomEvent.DataReceived, handleChatData);
    };
  }, [room, chatDecoder]);

  const sendChatMessage = React.useCallback(
    (text: string) => {
      const now = Date.now();
      const clientMessageId = createChatMessageId();
      const senderName =
        room.localParticipant.name || room.localParticipant.identity || 'You';
      const wire: ChatWireMessage = {
        type: 'chat',
        clientMessageId,
        senderIdentity: room.localParticipant.identity,
        senderName,
        message: text,
        timestamp: now,
        kind: 'text',
      };
      setChatMessages((current) =>
        mergeChatMessages(current, [wireToChatMsg(wire, room.localParticipant.identity)]),
      );
      publishChatWire(wire);
      void persistChatMessage({ clientMessageId, message: text, kind: 'text' });
    },
    [room, publishChatWire, persistChatMessage],
  );

  const sendLivedocChatMessage = React.useCallback(
    (attachment: ChatAttachment) => {
      const now = Date.now();
      const clientMessageId = createChatMessageId();
      const senderName =
        room.localParticipant.name || room.localParticipant.identity || 'You';
      const message = attachment.fileName
        ? `${t('chat.sharedFile') || 'Shared'}: ${attachment.fileName}`
        : t('chat.sharedLiveDoc') || 'Shared a LiveDoc';
      const wire: ChatWireMessage = {
        type: 'chat',
        clientMessageId,
        senderIdentity: room.localParticipant.identity,
        senderName,
        message,
        timestamp: now,
        kind: 'livedoc',
        attachment,
      };
      setChatMessages((current) =>
        mergeChatMessages(current, [wireToChatMsg(wire, room.localParticipant.identity)]),
      );
      publishChatWire(wire);
      void persistChatMessage({
        clientMessageId,
        message,
        kind: 'livedoc',
        attachment,
      });
    },
    [room, publishChatWire, persistChatMessage, t],
  );

  const openLivedocFromChat = React.useCallback(
    async (msg: ChatMsg) => {
      const itemId = msg.attachment?.itemId;
      if (!itemId || itemId <= 0) return;
      const ready = await ensureLiveDocViewReady();
      if (!ready) {
        console.warn('[chat] LiveDoc iframe not ready for open');
        return;
      }
      postToLiveDocIframe({
        type: CHAT_OPEN_DOCUMENT_TYPE,
        itemId,
        pageNumber: 1,
        sendmsg: true,
      });
    },
    [ensureLiveDocViewReady],
  );

  const handleAttachFile = React.useCallback(
    async (file: File) => {
      if (chatAttachBusy) return;
      if (!file) return;
      setChatAttachBusy(true);
      const requestId = createChatMessageId();
      pendingChatUploadRef.current = { requestId };
      try {
        const ready = await ensureLiveDocViewReady();
        if (!ready) {
          console.warn('[chat] LiveDoc not ready for upload (no instance or iframe)');
          pendingChatUploadRef.current = null;
          setChatAttachBusy(false);
          return;
        }
        const fileBuffer = await file.arrayBuffer();
        const payload = {
          type: CHAT_UPLOAD_REQUEST_TYPE,
          requestId,
          fileName: file.name,
          fileType: file.type || '',
          fileSize: file.size,
          fileBuffer,
        };
        let posted = postToLiveDocIframe(payload);
        if (!posted) {
          for (let i = 0; i < 10 && !posted; i += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 300));
            posted = postToLiveDocIframe(payload);
          }
        }
        if (!posted) {
          pendingChatUploadRef.current = null;
          setChatAttachBusy(false);
          return;
        }
        window.setTimeout(() => {
          if (pendingChatUploadRef.current?.requestId === requestId) {
            pendingChatUploadRef.current = null;
            setChatAttachBusy(false);
          }
        }, 180000);
      } catch (error) {
        console.error('[chat] attach file failed', error);
        pendingChatUploadRef.current = null;
        setChatAttachBusy(false);
      }
    },
    [chatAttachBusy, ensureLiveDocViewReady],
  );

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') return;
      if (data.type !== CHAT_UPLOAD_RESULT_TYPE) return;
      const pending = pendingChatUploadRef.current;
      if (!pending) return;
      pendingChatUploadRef.current = null;
      setChatAttachBusy(false);

      const status =
        data.status === 'failed' || data.status === 'converting' || data.status === 'uploading'
          ? data.status
          : 'ready';
      const itemId = typeof data.itemId === 'number' ? data.itemId : Number(data.itemId);
      const fileName =
        typeof data.fileName === 'string' && data.fileName.trim()
          ? data.fileName.trim()
          : 'Document';
      if (status === 'failed' || !Number.isFinite(itemId) || itemId <= 0) {
        return;
      }
      const attachmentIdRaw = data.attachmentId;
      const attachmentId =
        typeof attachmentIdRaw === 'number'
          ? attachmentIdRaw
          : Number.isFinite(Number(attachmentIdRaw))
            ? Number(attachmentIdRaw)
            : undefined;
      sendLivedocChatMessage({
        itemId,
        attachmentId,
        fileName,
        livedocInstanceId: livedocInstanceIdRef.current ?? undefined,
        status,
      });
      if (status === 'ready') {
        void ensureLiveDocViewReady().then((ready) => {
          if (!ready) return;
          postToLiveDocIframe({
            type: CHAT_OPEN_DOCUMENT_TYPE,
            itemId,
            pageNumber: 1,
            sendmsg: true,
          });
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sendLivedocChatMessage, ensureLiveDocViewReady]);

  const chatPanelNode = (
    <ChatPanel
      messages={chatMessages}
      onSend={sendChatMessage}
      onAttachFile={handleAttachFile}
      onOpenLivedoc={openLivedocFromChat}
      attachBusy={chatAttachBusy}
    />
  );

  return {
    chatMessages,
    chatAttachBusy,
    sendChatMessage,
    handleAttachFile,
    openLivedocFromChat,
    chatPanelNode,
  };
}
