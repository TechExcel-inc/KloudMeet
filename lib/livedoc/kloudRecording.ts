import { prisma } from '@/lib/db';
import {
  buildMeetingServerUrl,
  ensureHostBypassesProxy,
  formatUpstreamFetchError,
} from '@/lib/peertimeUpstream';

/**
 * Server side: Kloud MeetingServer recording/start_recording and end_recording for LiveDoc Full
 * Recording. While Kloud's recording runs it saves every LiveDoc action of the meeting; start also
 * tells the meeting's members (MEETING_CHANGE 16), so every LiveDoc plugin knows it is recording.
 */

type ResultVO<T> = { code: number; msg?: string; data?: T };

async function callRecording<T>(
  path: 'start_recording' | 'end_recording',
  kloudMeetingId: number,
  userToken: string,
): Promise<ResultVO<T>> {
  const { url, headers } = buildMeetingServerUrl(
    `/recording/${path}?meetingId=${encodeURIComponent(String(kloudMeetingId))}`,
  );
  ensureHostBypassesProxy(url);
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { UserToken: userToken, ...headers } });
  } catch (error) {
    throw new Error(`Kloud ${path} unavailable: ${formatUpstreamFetchError(error)}`);
  }
  if (!res.ok) throw new Error(`Kloud ${path}: HTTP ${res.status}`);
  return (await res.json()) as ResultVO<T>;
}

/** Starts Kloud's recording of the meeting; returns Kloud's recording id. */
export async function startKloudRecording(kloudMeetingId: number, userToken: string): Promise<number> {
  const result = await callRecording<number>('start_recording', kloudMeetingId, userToken);
  if (result.code !== 0 || typeof result.data !== 'number' || result.data <= 0) {
    throw new Error(`Kloud start_recording: ${result.msg ?? 'error'} (code=${result.code})`);
  }
  return result.data;
}

/**
 * Ends Kloud's side of a livedoc_full recording and forgets the stored token. Used by stop, by the
 * egress ending and by the room emptying, whichever comes first; later calls do nothing.
 */
export async function finishLivedocRecording(
  recording: { id: number; kind: string; livedocToken: string | null },
  kloudMeetingId: number | null,
  userToken?: string | null,
): Promise<void> {
  if (recording.kind !== 'livedoc_full') return;
  const token = userToken || recording.livedocToken;
  if (!token || !kloudMeetingId) return;
  const cleared = await prisma.recording.updateMany({
    where: { id: recording.id, livedocToken: { not: null } },
    data: { livedocToken: null },
  });
  if (cleared.count === 0) return;
  await endKloudRecording(kloudMeetingId, token);
}

/** Ends Kloud's recording. Safe to call twice: "not recording" is logged, not thrown. */
export async function endKloudRecording(kloudMeetingId: number, userToken: string): Promise<void> {
  try {
    const result = await callRecording<unknown>('end_recording', kloudMeetingId, userToken);
    if (result.code !== 0) {
      console.warn('[kloudRecording] end_recording', kloudMeetingId, result.code, result.msg);
    }
  } catch (error) {
    console.error('[kloudRecording] end_recording failed', kloudMeetingId, error);
  }
}
