export type RecordingTimeFields = {
  createdAt: Date;
  mediaStartedAt?: Date | null;
  durationSeconds?: number | null;
};

/** Attendance window [joinedAt, leftAt ?? now] overlaps the recording's span (open-ended while recording). */
export function attendanceOverlapsRecording(
  attendance: { joinedAt: Date; leftAt: Date | null },
  recording: RecordingTimeFields,
  now = new Date(),
): boolean {
  const recStart = recording.mediaStartedAt ?? recording.createdAt;
  const recEnd =
    recording.durationSeconds != null
      ? new Date(recStart.getTime() + recording.durationSeconds * 1000)
      : now;
  const presentUntil = attendance.leftAt ?? now;
  return attendance.joinedAt <= recEnd && presentUntil >= recStart;
}
