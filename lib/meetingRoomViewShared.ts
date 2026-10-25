import { parseStoredDesignLink, type StoredDesignLink } from '@/lib/designLink';

export type MeetingRoomView = 'liveDoc' | 'webcam' | 'shareScreen' | 'design';

const VIEW_VALUES: ReadonlySet<string> = new Set(['liveDoc', 'webcam', 'shareScreen', 'design']);

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

/** Parse the Design-mode link from LiveKit room.metadata JSON. */
export function parseDesignLinkFromRoomMetadata(
  metadata: string | undefined | null,
): StoredDesignLink | null {
  if (!metadata || !metadata.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!parsed || typeof parsed !== 'object') return null;
    return parseStoredDesignLink((parsed as { designLink?: unknown }).designLink);
  } catch {
    return null;
  }
}

/** Set (or clear with null) the Design-mode link, optionally with the view, keeping other fields. */
export function mergeRoomMetadataWithDesignLink(
  existing: string | undefined | null,
  designLink: StoredDesignLink | null,
  view?: MeetingRoomView,
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
  if (designLink) base.designLink = designLink;
  else delete base.designLink;
  if (view) base.currentView = view;
  return JSON.stringify(base);
}
