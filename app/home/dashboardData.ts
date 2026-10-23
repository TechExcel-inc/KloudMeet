/**
 * What the home page highlights, picked from the user's recent meetings: what is live or
 * coming up next, and which meetings have a replay ready to watch.
 */

/** The fields of a meeting from /api/account/meetings that the home page reads. */
export interface DashMeeting {
  id?: number | string;
  roomName: string;
  title?: string | null;
  status?: string;
  isActive?: boolean;
  scheduledFor?: string | null;
  createdAt?: string;
  actualStartedAt?: string | null;
  durationMinutes?: number | null;
  createdByMemberId?: number | string;
  createdByMember?: { fullName?: string | null; username?: string | null } | null;
  _count?: { participants?: number };
  recordings?: DashRecording[];
}

export interface DashRecording {
  id: number | string;
  status: string;
  shareKey?: string | null;
  visibility?: string;
  durationSeconds?: number | null;
}

export type UpNextItem = { meeting: DashMeeting; kind: 'live' | 'scheduled'; at: number };

/** A scheduled meeting stays in "Up next" this long after its start time if nobody started it. */
export const UP_NEXT_GRACE_MS = 30 * 60 * 1000;

function startedAt(m: DashMeeting): number {
  const raw = m.actualStartedAt || m.createdAt;
  return raw ? new Date(raw).getTime() : 0;
}

/** Live meetings first (longest running first), then scheduled ones, soonest first. */
export function pickUpNext(meetings: DashMeeting[], now: number, max = 3): UpNextItem[] {
  const live: UpNextItem[] = [];
  const scheduled: UpNextItem[] = [];
  for (const m of meetings) {
    if (m.isActive) {
      live.push({ meeting: m, kind: 'live', at: startedAt(m) });
      continue;
    }
    if (m.status === 'ENDED' || m.status === 'CANCELED' || !m.scheduledFor) continue;
    const at = new Date(m.scheduledFor).getTime();
    if (Number.isNaN(at) || at < now - UP_NEXT_GRACE_MS) continue;
    scheduled.push({ meeting: m, kind: 'scheduled', at });
  }
  live.sort((a, b) => a.at - b.at);
  scheduled.sort((a, b) => a.at - b.at);
  return [...live, ...scheduled].slice(0, max);
}

export type ReplayItem = { meeting: DashMeeting; recording: DashRecording };

/** Meetings with a finished recording, most recent first. */
export function pickRecentReplays(meetings: DashMeeting[], max = 4): ReplayItem[] {
  const items: ReplayItem[] = [];
  for (const m of meetings) {
    const recording = m.recordings?.find((r) => r.status === 'READY');
    if (recording) items.push({ meeting: m, recording });
  }
  const when = (m: DashMeeting) => new Date(m.scheduledFor || m.createdAt || 0).getTime();
  items.sort((a, b) => when(b.meeting) - when(a.meeting));
  return items.slice(0, max);
}

/** Whether this user has actually run a meeting they host (not just created one). */
export function hasHostedMeeting(meetings: DashMeeting[], userId: string | number): boolean {
  return meetings.some(
    (m) =>
      String(m.createdByMemberId) === String(userId) &&
      (m.isActive || m.status === 'ENDED' || !!m.actualStartedAt),
  );
}

/** Minutes of a recording, or of the meeting when the recording has no length yet. */
export function replayMinutes(item: ReplayItem): number | null {
  const secs = item.recording.durationSeconds;
  if (secs && secs > 0) return Math.max(1, Math.round(secs / 60));
  return item.meeting.durationMinutes ?? null;
}
