/**
 * The recording bot (a web egress page that joins like a guest) is marked by the server in its
 * LiveKit token metadata, so meetings leave it out of tiles, counts and the attendee list.
 * Participants can't change their own metadata, so a guest who calls themselves
 * "KloudMeet Recorder" is still shown.
 */
export const RECORDER_PARTICIPANT_METADATA = JSON.stringify({ kloudRecorder: true });

export function isRecorderParticipant(p: { metadata?: string } | null | undefined): boolean {
  const metadata = p?.metadata;
  if (!metadata || !metadata.includes('kloudRecorder')) return false;
  try {
    return (JSON.parse(metadata) as { kloudRecorder?: unknown } | null)?.kloudRecorder === true;
  } catch {
    return false;
  }
}

/** Remote participants people see: everyone except the recording bot. */
export function visibleRemoteParticipants<P extends { metadata?: string }>(
  participants: Iterable<P>,
): P[] {
  return Array.from(participants).filter((p) => !isRecorderParticipant(p));
}
