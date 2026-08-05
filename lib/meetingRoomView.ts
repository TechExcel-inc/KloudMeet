import { getRoomServiceClient } from '@/lib/livekitRooms';
import {
  mergeRoomMetadataWithView,
  parseCurrentViewFromRoomMetadata,
  type MeetingRoomView,
} from '@/lib/meetingRoomViewShared';

export type { MeetingRoomView } from '@/lib/meetingRoomViewShared';
export { parseMeetingRoomView, parseCurrentViewFromRoomMetadata } from '@/lib/meetingRoomViewShared';

/** Read authoritative meeting view from LiveKit room metadata (if room exists). */
export async function getMeetingRoomCurrentView(
  roomName: string,
): Promise<MeetingRoomView | null> {
  const client = getRoomServiceClient();
  if (!client) return null;
  try {
    const rooms = await client.listRooms([roomName]);
    const room = rooms[0];
    if (!room) return null;
    return parseCurrentViewFromRoomMetadata(room.metadata);
  } catch {
    return null;
  }
}

/** Persist meeting view onto LiveKit room metadata for late joiners. */
export async function setMeetingRoomCurrentView(
  roomName: string,
  view: MeetingRoomView,
): Promise<boolean> {
  const client = getRoomServiceClient();
  if (!client) return false;
  try {
    const rooms = await client.listRooms([roomName]);
    const existing = rooms[0]?.metadata;
    await client.updateRoomMetadata(roomName, mergeRoomMetadataWithView(existing, view));
    return true;
  } catch (e) {
    console.error('[meetingRoomView] updateRoomMetadata failed', roomName, e);
    return false;
  }
}
