'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { handleKloudSessionExpired } from '@/lib/handleKloudSessionExpired';
import { useI18n } from '@/lib/i18n';
import { authHeaders } from '@/lib/kloudSession';
import { parseKloudMemberIdFromIdentity } from '@/lib/meetingOwner';
import styles from '@/styles/MeetingChatHistory.module.css';

interface MeetingInfo {
  id: number;
  title: string | null;
  roomName: string;
  startedAt: string;
  endedAt: string | null;
}

interface HistoryMessage {
  clientMessageId: string;
  senderIdentity: string;
  senderName: string;
  message: string;
  timestamp: number;
}

interface HistoryResponse {
  meeting: MeetingInfo;
  messages: HistoryMessage[];
  total: number;
  totalPages: number;
}

interface StoredAuthUser {
  id?: string | number;
  username?: string;
  displayName?: string;
  email?: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getStoredAuthUser(): StoredAuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('kloudUser') ?? sessionStorage.getItem('kloudUser');
    if (!stored) return null;
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as StoredAuthUser;
  } catch {
    return null;
  }
}

function isOwnHistoryMessage(message: HistoryMessage, currentUser: StoredAuthUser | null): boolean {
  if (!currentUser) return false;
  const userId = currentUser.id == null ? null : String(currentUser.id);
  if (userId) {
    const senderMemberId = parseKloudMemberIdFromIdentity(message.senderIdentity);
    if (senderMemberId !== null && String(senderMemberId) === userId) return true;
    if (message.senderIdentity === `km_${userId}` || message.senderIdentity.startsWith(`km_${userId}_`)) {
      return true;
    }
  }

  const ownNames = [currentUser.username, currentUser.displayName, currentUser.email]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
  return ownNames.some((value) => value === message.senderIdentity || value === message.senderName);
}

/** MeetingChatHistoryPage — 显示指定会议的完整会后聊天记录。 */
export default function MeetingChatHistoryPage(): React.ReactElement {
  const params = useParams<{ meetingId: string }>();
  const { t } = useI18n();
  const [meeting, setMeeting] = React.useState<MeetingInfo | null>(null);
  const [messages, setMessages] = React.useState<HistoryMessage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [currentUser, setCurrentUser] = React.useState<StoredAuthUser | null>(null);

  React.useEffect(() => {
    setCurrentUser(getStoredAuthUser());
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();

    const loadHistory = async (): Promise<void> => {
      setLoading(true);
      setError(false);
      try {
        const headers = authHeaders();
        const firstResponse = await fetch(
          `/api/meeting-chat/${encodeURIComponent(params.meetingId)}?page=1&pageSize=500`,
          { headers, cache: 'no-store', signal: controller.signal },
        );
        if (firstResponse.status === 401) {
          handleKloudSessionExpired();
          return;
        }
        if (!firstResponse.ok) {
          setError(true);
          return;
        }

        const firstPage = await firstResponse.json() as HistoryResponse;
        const remainingPages =
          firstPage.totalPages > 1
            ? await Promise.all(
              Array.from({ length: firstPage.totalPages - 1 }, (_, index) =>
                fetch(
                  `/api/meeting-chat/${encodeURIComponent(params.meetingId)}?page=${index + 2}&pageSize=500`,
                  { headers, cache: 'no-store', signal: controller.signal },
                ).then(async (response): Promise<HistoryResponse> => {
                  if (!response.ok) throw new Error('Failed to load chat history page');
                  return response.json() as Promise<HistoryResponse>;
                }),
              ),
            )
            : [];

        setMeeting(firstPage.meeting);
        setMessages([
          ...firstPage.messages,
          ...remainingPages.flatMap((page) => page.messages),
        ]);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        if (loadError instanceof Error && loadError.name === 'AbortError') return;
        setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadHistory();
    return () => controller.abort();
  }, [params.meetingId]);

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <header className={styles.header}>
          <Link href="/" className={styles.backLink}>
            <span aria-hidden>←</span>
            {t('common.back')}
          </Link>
          <div className={styles.heading}>
            <h1>{t('chatHistory.title')}</h1>
            {meeting && (
              <p>
                {meeting.title || meeting.roomName}
                <span> · {messages.length} {t('chatHistory.messages')}</span>
              </p>
            )}
          </div>
        </header>

        <div className={styles.content}>
          {loading && <div className={styles.state}>{t('chatHistory.loading')}</div>}
          {!loading && error && (
            <div className={`${styles.state} ${styles.error}`}>{t('chatHistory.loadFailed')}</div>
          )}
          {!loading && !error && messages.length === 0 && (
            <div className={styles.state}>{t('chatHistory.empty')}</div>
          )}
          {!loading && !error && messages.length > 0 && (
            <div className={styles.messageList}>
              {messages.map((message) => {
                const isOwn = isOwnHistoryMessage(message, currentUser);
                return (
                  <article
                    key={message.clientMessageId}
                    className={`${styles.messageRow} ${isOwn ? styles.messageRowOwn : ''}`}
                  >
                    <div className={`${styles.avatar} ${isOwn ? styles.avatarOwn : ''}`}>
                      {getInitials(message.senderName)}
                    </div>
                    <div className={`${styles.messageBody} ${isOwn ? styles.messageBodyOwn : ''}`}>
                      <div className={styles.messageMeta}>
                        <strong>{message.senderName}</strong>
                        <time dateTime={new Date(message.timestamp).toISOString()}>
                          {new Date(message.timestamp).toLocaleString()}
                        </time>
                      </div>
                      <p>{message.message}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
