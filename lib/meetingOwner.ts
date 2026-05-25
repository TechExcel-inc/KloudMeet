/** Parse LiveKit participant metadata from `/api/connection-details` (logged-in users). */
export function parseKloudMemberIdFromMetadata(metadata?: string | null): string | null {
  if (!metadata || typeof metadata !== 'string') return null;
  try {
    const o = JSON.parse(metadata) as { kloudMemberId?: string | number };
    const id = o?.kloudMemberId;
    if (id === undefined || id === null) return null;
    return String(id);
  } catch {
    return null;
  }
}

/** 当前登录用户是否为该会场 DB 发起人（PreJoin / resolve 跳过用） */
export function isCurrentUserMeetingCreator(
  meetingInfo: { createdByMemberId?: number | string | null } | null | undefined,
  currentUser: { id?: number | string | null } | null | undefined,
): boolean {
  if (meetingInfo?.createdByMemberId == null || currentUser?.id == null) {
    return false;
  }
  return String(meetingInfo.createdByMemberId) === String(currentUser.id);
}

/** True when the local participant is `Meeting.createdByMemberId` (may update meeting via API). */
export function isDbMeetingOwner(
  meetingOwnerMemberId: string | null | undefined,
  participantMetadata?: string | null,
): boolean {
  if (meetingOwnerMemberId == null || meetingOwnerMemberId === '') return false;
  const localId = parseKloudMemberIdFromMetadata(participantMetadata);
  return localId !== null && localId === String(meetingOwnerMemberId);
}
