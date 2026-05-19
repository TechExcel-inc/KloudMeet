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

/** True when the local participant is `Meeting.createdByMemberId` (may update meeting via API). */
export function isDbMeetingOwner(
  meetingOwnerMemberId: string | null | undefined,
  participantMetadata?: string | null,
): boolean {
  if (meetingOwnerMemberId == null || meetingOwnerMemberId === '') return false;
  const localId = parseKloudMemberIdFromMetadata(participantMetadata);
  return localId !== null && localId === String(meetingOwnerMemberId);
}
