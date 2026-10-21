import { getRoomServiceClient } from '@/lib/livekitRooms';
import {
  mergeParticipantLiveDocAi,
  parseParticipantLiveDocAi,
} from '@/lib/participantLiveDocAi';
import {
  mergeRoomMetadataWithView,
  parseCurrentViewFromRoomMetadata,
  type MeetingRoomView,
} from '@/lib/meetingRoomViewShared';

export type { MeetingRoomView } from '@/lib/meetingRoomViewShared';
export { parseMeetingRoomView, parseCurrentViewFromRoomMetadata } from '@/lib/meetingRoomViewShared';

/** 一次读取房间 metadata：当前视图，以及普通参会者是否显示文档 AI。 */
export async function readMeetingRoomFlags(roomName: string): Promise<{
  currentView: MeetingRoomView | null;
  participantLiveDocAi: boolean;
}> {
  const client = getRoomServiceClient();
  if (!client) return { currentView: null, participantLiveDocAi: true };
  try {
    const rooms = await client.listRooms([roomName]);
    const metadata = rooms[0]?.metadata;
    return {
      currentView: parseCurrentViewFromRoomMetadata(metadata),
      participantLiveDocAi: parseParticipantLiveDocAi(metadata),
    };
  } catch {
    return { currentView: null, participantLiveDocAi: true };
  }
}

/** 普通参会者是否显示文档 AI。房间不存在或未设置时为显示。 */
export async function getParticipantLiveDocAi(roomName: string): Promise<boolean> {
  const flags = await readMeetingRoomFlags(roomName);
  return flags.participantLiveDocAi;
}

/** 写入普通参会者文档 AI 开关，不覆盖 metadata 里的其他字段。 */
export async function setParticipantLiveDocAi(
  roomName: string,
  show: boolean,
): Promise<boolean> {
  const client = getRoomServiceClient();
  if (!client) return false;
  try {
    const rooms = await client.listRooms([roomName]);
    const existing = rooms[0]?.metadata;
    await client.updateRoomMetadata(roomName, mergeParticipantLiveDocAi(existing, show));
    return true;
  } catch (e) {
    console.error('[participantLiveDocAi] updateRoomMetadata failed', roomName, e);
    return false;
  }
}

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
