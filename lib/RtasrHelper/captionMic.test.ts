import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { meetingMicSource, publishedMicTrack, type CaptionMicRoom } from './captionMic';

class FakeTrack {
  enabled = false;
  readyState: 'live' | 'ended' = 'live';
  cloned: FakeTrack[] = [];
  clone() {
    const c = new FakeTrack();
    c.enabled = this.enabled;
    this.cloned.push(c);
    return c;
  }
  stop() {
    this.readyState = 'ended';
  }
}

function roomWith(track: FakeTrack | null, device?: string): CaptionMicRoom {
  return {
    localParticipant: {
      getTrackPublication: () =>
        track ? { track: { mediaStreamTrack: track as unknown as MediaStreamTrack } } : undefined,
    },
    getActiveDevice: () => device,
  };
}

const getUserMedia = vi.fn();

beforeEach(() => {
  getUserMedia.mockReset().mockResolvedValue({ kind: 'captured' });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal(
    'MediaStream',
    class {
      constructor(public tracks: unknown[]) {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('captions use the meeting microphone', () => {
  it('clones the published mic track (never the original) and opens no second capture', async () => {
    const track = new FakeTrack();
    const source = meetingMicSource(roomWith(track), 0);
    const stream = (await source()) as unknown as { tracks: FakeTrack[] };
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(stream.tracks).toEqual([track.cloned[0]]);
    expect(stream.tracks[0]).not.toBe(track);
    expect(stream.tracks[0].enabled).toBe(true);
    expect(source.usingStandIn()).toBe(false);
  });

  it('ignores a mic track that has ended', () => {
    const track = new FakeTrack();
    track.readyState = 'ended';
    expect(publishedMicTrack(roomWith(track))).toBeNull();
  });

  it('before the track is published, captures the device the meeting selected', async () => {
    const source = meetingMicSource(roomWith(null, 'usb-mic'), 0);
    await source();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0].audio.deviceId).toEqual({ exact: 'usb-mic' });
    expect(source.usingStandIn()).toBe(true);
  });

  it('falls back to the default device when the selected one is gone', async () => {
    getUserMedia
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'OverconstrainedError' }))
      .mockResolvedValueOnce({ kind: 'default' });
    const stream = await meetingMicSource(roomWith(null, 'unplugged'), 0)();
    expect(stream).toEqual({ kind: 'default' });
    expect(getUserMedia.mock.calls[1][0].audio.deviceId).toBeUndefined();
  });

  it('passes on other capture errors (e.g. permission denied)', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    await expect(meetingMicSource(roomWith(null, 'usb-mic'), 0)()).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('waits briefly for the track the meeting is about to publish', async () => {
    vi.useFakeTimers();
    let track: FakeTrack | null = null;
    const room: CaptionMicRoom = {
      localParticipant: {
        getTrackPublication: () => (track ? { track: { mediaStreamTrack: track as unknown as MediaStreamTrack } } : undefined),
      },
      getActiveDevice: () => undefined,
    };
    const pending = meetingMicSource(room, 1500)();
    await vi.advanceTimersByTimeAsync(300);
    track = new FakeTrack();
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(track.cloned).toHaveLength(1);
    vi.useRealTimers();
  });
});
