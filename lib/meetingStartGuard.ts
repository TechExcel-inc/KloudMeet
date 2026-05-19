import { authFetch, authHeaders } from '@/lib/kloudSession';

export type ActiveMeetingInfo = {
  id: number;
  roomName: string;
  title: string | null;
  status: string;
  actualStartedAt: string;
  scheduledFor?: string | null;
};

export type MeetingStartIntent =
  | { type: 'newMeeting' }
  | { type: 'personalRoom'; roomName: string }
  | { type: 'startScheduled'; roomName: string };

export type ActiveMeetingCheckResult =
  | { action: 'proceed' }
  | { action: 'redirect'; roomName: string; joinAction: 'join' | 'start' }
  | {
      action: 'conflict';
      activeMeeting: ActiveMeetingInfo;
      pendingIntent: MeetingStartIntent;
    };

export async function fetchActiveMeeting(
  token: string,
): Promise<ActiveMeetingInfo | null> {
  const res = await authFetch('/api/account/active-meeting', {
    headers: authHeaders({ Authorization: `Bearer ${token}` }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.hasActive || !data.meeting) return null;
  return data.meeting as ActiveMeetingInfo;
}

export async function endMeetingByHost(
  token: string,
  roomName: string,
): Promise<boolean> {
  const res = await authFetch(`/api/meetings/${roomName}/end`, {
    method: 'POST',
    headers: authHeaders({ Authorization: `Bearer ${token}` }),
  });
  return res.ok;
}

function targetRoomName(intent: MeetingStartIntent): string | null {
  if (intent.type === 'personalRoom' || intent.type === 'startScheduled') {
    return intent.roomName;
  }
  return null;
}

/**
 * Decide whether to proceed, show conflict modal, or redirect to the same active room.
 */
export async function checkMeetingStartGuard(
  token: string,
  intent: MeetingStartIntent,
): Promise<ActiveMeetingCheckResult> {
  const active = await fetchActiveMeeting(token);
  if (!active) {
    return { action: 'proceed' };
  }

  // 仅「开始同一场预约会议」且该会已在进行 → 直接加入。
  // My Room 即使目标房间相同也弹窗，便于「继续 / 结束并开新场」。
  const target = targetRoomName(intent);
  if (
    intent.type === 'startScheduled' &&
    target &&
    target === active.roomName
  ) {
    return {
      action: 'redirect',
      roomName: active.roomName,
      joinAction: 'join',
    };
  }

  return {
    action: 'conflict',
    activeMeeting: active,
    pendingIntent: intent,
  };
}
