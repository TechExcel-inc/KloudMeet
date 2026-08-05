export type MeetingRoomView = 'liveDoc' | 'webcam' | 'shareScreen';

const VIEW_VALUES: ReadonlySet<string> = new Set(['liveDoc', 'webcam', 'shareScreen']);

export function parseMeetingRoomView(value: unknown): MeetingRoomView | null {
  return typeof value === 'string' && VIEW_VALUES.has(value)
    ? (value as MeetingRoomView)
    : null;
}

/** Parse LiveKit room.metadata JSON for currentView. */
export function parseCurrentViewFromRoomMetadata(
  metadata: string | undefined | null,
): MeetingRoomView | null {
  if (!metadata || !metadata.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!parsed || typeof parsed !== 'object') return null;
    return parseMeetingRoomView((parsed as { currentView?: unknown }).currentView);
  } catch {
    return null;
  }
}

export function mergeRoomMetadataWithView(
  existing: string | undefined | null,
  view: MeetingRoomView,
): string {
  let base: Record<string, unknown> = {};
  if (existing && existing.trim()) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      base = {};
    }
  }
  return JSON.stringify({ ...base, currentView: view });
}
