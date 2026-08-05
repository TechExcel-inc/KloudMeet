import type { MeetingRoomView } from '@/lib/meetingRoomViewShared';

/** Persist authoritative stage view for late joiners (fire-and-forget safe). */
export async function persistMeetingRoomView({
  roomName,
  view,
  livekitToken,
}: {
  roomName: string;
  view: MeetingRoomView;
  livekitToken: string;
}): Promise<void> {
  const response = await fetch(
    `/api/meetings/${encodeURIComponent(roomName)}/view`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${livekitToken}`,
      },
      body: JSON.stringify({ view }),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`persistMeetingRoomView: ${response.status} ${text}`);
  }
}
