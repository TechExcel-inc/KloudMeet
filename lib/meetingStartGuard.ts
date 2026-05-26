import { authFetch, authHeaders } from '@/lib/kloudSession';

export type ActiveMeetingInfo = {
  id: number;
  roomName: string;
  title: string | null;
  status: string;
  actualStartedAt: string;
  scheduledFor?: string | null;
  /** 与 GET /api/meetings/[roomName] 的 isActive 一致 */
  isActive?: boolean;
};

export type MeetingStartIntent =
  | { type: 'newMeeting' }
  | { type: 'personalRoom'; roomName: string }
  | { type: 'startScheduled'; roomName: string };

export type ActiveMeetingCheckResult =
  | { action: 'proceed' }
  | {
      action: 'redirect';
      roomName: string;
      meetingId?: number;
    }
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
  if (!res.ok) {
    throw new Error(`active-meeting ${res.status}`);
  }
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

/**
 * 有进行中的会议则一律弹冲突窗（含列表 Start 与当前点击同 roomName 的情况）。
 */
export async function checkMeetingStartGuard(
  token: string,
  intent: MeetingStartIntent,
): Promise<ActiveMeetingCheckResult> {
  const active = await fetchActiveMeeting(token);
  if (!active) {
    return { action: 'proceed' };
  }

  return {
    action: 'conflict',
    activeMeeting: active,
    pendingIntent: intent,
  };
}
