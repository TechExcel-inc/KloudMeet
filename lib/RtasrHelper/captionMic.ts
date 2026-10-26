/**
 * Which microphone captions listen to (William, 2026-10-26: "option A").
 *
 * Captions reuse the meeting's own published mic track — a clone, so stopping captions never
 * stops the meeting's mic. Same device the person picked, same noise filter, one capture (no
 * second "microphone in use", no Bluetooth headset dropping to call quality). Before that track
 * is published, captions capture the device the meeting has selected, and the system default
 * if that device is gone. Nothing reads the old, never-written `DefaultMic` setting any more.
 */
import { Track } from 'livekit-client';

/** Returns a stream with one audio track; the caller stops its tracks when done. */
export type CaptionMicSource = () => Promise<MediaStream>;

const CAPTURE_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** What captions need from the LiveKit room (kept narrow so tests can fake it). */
export interface CaptionMicRoom {
  localParticipant: {
    getTrackPublication(source: Track.Source): { track?: { mediaStreamTrack?: MediaStreamTrack } } | undefined;
  };
  getActiveDevice(kind: MediaDeviceKind): string | undefined;
}

/** The meeting's published, still-running mic track (processed by the noise filter if one is on). */
export function publishedMicTrack(room: CaptionMicRoom): MediaStreamTrack | null {
  const media = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
  return media && media.readyState === 'live' ? media : null;
}

function capture(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { ...CAPTURE_CONSTRAINTS, deviceId: { exact: deviceId } } : CAPTURE_CONSTRAINTS,
    video: false,
  });
}

/** The system default microphone (captions outside a meeting room, and the last fallback). */
export const defaultMicSource: CaptionMicSource = () => capture();

export interface MeetingMicSource extends CaptionMicSource {
  /** The last stream came from a stand-in capture, not the meeting's published track. */
  usingStandIn(): boolean;
}

/**
 * @param waitForTrackMs Turning the mic on publishes its track a moment after captions are
 *   asked to start; wait that long for it before falling back to a capture of the same device.
 */
export function meetingMicSource(room: CaptionMicRoom, waitForTrackMs = 1500): MeetingMicSource {
  let standIn = false;
  const source = async () => {
    let published = publishedMicTrack(room);
    for (let waited = 0; !published && waited < waitForTrackMs; waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      published = publishedMicTrack(room);
    }
    if (published) {
      standIn = false;
      const clone = published.clone();
      // Captions start once the mic is on; don't inherit a mute the meeting is just lifting.
      clone.enabled = true;
      return new MediaStream([clone]);
    }
    standIn = true;
    const deviceId = room.getActiveDevice('audioinput');
    if (deviceId && deviceId !== 'default') {
      try {
        return await capture(deviceId);
      } catch (err) {
        // The chosen device was unplugged: use the default rather than failing captions.
        if (!(err instanceof Error && err.name === 'OverconstrainedError')) throw err;
      }
    }
    return capture();
  };
  return Object.assign(source, { usingStandIn: () => standIn });
}
