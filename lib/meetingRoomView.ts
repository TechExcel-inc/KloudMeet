import { getRoomServiceClient } from '@/lib/livekitRooms';
import {
  mergeParticipantLiveDocAi,
  parseParticipantLiveDocAi,
} from '@/lib/participantLiveDocAi';
import {
  mergeRoomMetadataWithDesignLink,
  mergeRoomMetadataWithView,
  parseCurrentViewFromRoomMetadata,
  parseDesignLinkFromRoomMetadata,
  type MeetingRoomView,
} from '@/lib/meetingRoomViewShared';
import type { StoredDesignLink } from '@/lib/designLink';

export type { MeetingRoomView } from '@/lib/meetingRoomViewShared';
export { parseMeetingRoomView, parseCurrentViewFromRoomMetadata } from '@/lib/meetingRoomViewShared';

/** 一次读取房间 metadata：当前视图、普通参会者是否显示文档 AI、Design 模式的链接。 */
export async function readMeetingRoomFlags(roomName: string): Promise<{
  currentView: MeetingRoomView | null;
  participantLiveDocAi: boolean;
  designLink: StoredDesignLink | null;
}> {
  const client = getRoomServiceClient();
  if (!client) return { currentView: null, participantLiveDocAi: true, designLink: null };
  try {
    const rooms = await client.listRooms([roomName]);
    const metadata = rooms[0]?.metadata;
    return {
      currentView: parseCurrentViewFromRoomMetadata(metadata),
      participantLiveDocAi: parseParticipantLiveDocAi(metadata),
      designLink: parseDesignLinkFromRoomMetadata(metadata),
    };
  } catch {
    return { currentView: null, participantLiveDocAi: true, designLink: null };
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

/** Persist the Design-mode link (null clears it) and, when given, the view in one metadata write. */
export async function setMeetingRoomDesignLink(
  roomName: string,
  designLink: StoredDesignLink | null,
  view?: MeetingRoomView,
): Promise<boolean> {
  const client = getRoomServiceClient();
  if (!client) return false;
  try {
    const rooms = await client.listRooms([roomName]);
    const existing = rooms[0]?.metadata;
    await client.updateRoomMetadata(roomName, mergeRoomMetadataWithDesignLink(existing, designLink, view));
    return true;
  } catch (e) {
    console.error('[meetingRoomView] design link update failed', roomName, e);
    return false;
  }
}
