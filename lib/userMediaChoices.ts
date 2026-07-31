/** localStorage key shared with LiveKit PreJoin (`usePersistentUserChoices`). */
export const LK_USER_CHOICES_KEY = 'lk-user-choices';

export type StoredUserMediaChoices = {
  username?: string;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
};

/** Empty / "default" → undefined so LiveKit uses system default device. */
export function normalizeCaptureDeviceId(
  deviceId: string | undefined | null,
): string | undefined {
  if (typeof deviceId !== 'string') return undefined;
  const trimmed = deviceId.trim();
  if (!trimmed || trimmed === 'default') return undefined;
  return trimmed;
}

export function readStoredUserMediaChoices(): StoredUserMediaChoices {
  try {
    const raw = localStorage.getItem(LK_USER_CHOICES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as StoredUserMediaChoices;
  } catch {
    return {};
  }
}

/** Merge-patch last mic/cam preferences (survives refresh / auto-rejoin). */
export function patchStoredUserMediaChoices(
  patch: Partial<StoredUserMediaChoices>,
): void {
  try {
    const base = readStoredUserMediaChoices();
    localStorage.setItem(
      LK_USER_CHOICES_KEY,
      JSON.stringify({
        ...base,
        ...patch,
      }),
    );
  } catch {
    /* ignore */
  }
}
