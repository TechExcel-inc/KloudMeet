/** The speaker picked on the pre-join page, applied when the room is created. */
const KEY = 'kloud-audio-output-device';

export function loadAudioOutputDeviceId(): string | undefined {
  try {
    return localStorage.getItem(KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function saveAudioOutputDeviceId(deviceId: string | undefined): void {
  try {
    if (deviceId && deviceId !== 'default') localStorage.setItem(KEY, deviceId);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the browser default speaker is used */
  }
}
