import { describe, expect, it } from 'vitest';
import {
  RECORDER_PARTICIPANT_METADATA,
  isRecorderParticipant,
  visibleRemoteParticipants,
} from './recorderParticipant';

describe('isRecorderParticipant', () => {
  it('recognises the metadata the server gives the recording bot', () => {
    expect(isRecorderParticipant({ metadata: RECORDER_PARTICIPANT_METADATA })).toBe(true);
  });

  it('ignores members, guests and broken metadata', () => {
    expect(isRecorderParticipant({ metadata: JSON.stringify({ kloudMemberId: 7, kloudDeviceId: 'abc' }) })).toBe(false);
    expect(isRecorderParticipant({ metadata: '' })).toBe(false);
    expect(isRecorderParticipant({})).toBe(false);
    expect(isRecorderParticipant(null)).toBe(false);
    expect(isRecorderParticipant({ metadata: '{"kloudRecorder":' })).toBe(false);
    expect(isRecorderParticipant({ metadata: JSON.stringify({ kloudRecorder: 'yes' }) })).toBe(false);
  });

  it('does not go by the display name', () => {
    expect(isRecorderParticipant({ metadata: '', name: 'KloudMeet Recorder' } as { metadata: string })).toBe(false);
  });
});

describe('visibleRemoteParticipants', () => {
  it('leaves out only the recording bot', () => {
    const people = [
      { identity: 'km_1_a', metadata: JSON.stringify({ kloudMemberId: 1 }) },
      { identity: 'guest_KloudMeet Recorder__x', metadata: RECORDER_PARTICIPANT_METADATA },
      { identity: 'guest_Ann__y', metadata: '' },
    ];
    expect(visibleRemoteParticipants(new Map(people.map((p) => [p.identity, p])).values()).map((p) => p.identity)).toEqual([
      'km_1_a',
      'guest_Ann__y',
    ]);
  });
});
