/** Time-zone helpers shared by the schedule dialog and calendar export (no Node/DOM deps). */

/** Offset of `timezone` from UTC at `date`, in minutes (e.g. Asia/Shanghai → 480). */
export function getTimezoneOffsetMinutes(timezone: string, date: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
      year: 'numeric',
    }).formatToParts(date);
    const offsetPart = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT+00:00';
    if (offsetPart === 'GMT') return 0;
    const match = offsetPart.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) return 0;
    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    return sign * (hours * 60 + minutes);
  } catch {
    return 0;
  }
}

/**
 * Wall-clock `date` (YYYY-MM-DD) + `time` (HH:mm) in `timezone` → UTC ISO string.
 * Iterates twice so the offset is taken at the target instant (handles DST edges).
 */
export function zonedDateTimeToUtcIso(date: string, time: string, timezone: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/);
  if (!match || !timeMatch) return new Date(`${date}T${time}:00`).toISOString();

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let timestamp = localAsUtc;

  for (let i = 0; i < 2; i += 1) {
    const offsetMinutes = getTimezoneOffsetMinutes(timezone, new Date(timestamp));
    timestamp = localAsUtc - offsetMinutes * 60_000;
  }

  return new Date(timestamp).toISOString();
}
