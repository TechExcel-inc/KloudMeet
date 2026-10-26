import { beforeEach, describe, expect, it, vi } from 'vitest';
import { followOwnerLiveRoom, otherLiveMeetingOfHost } from './oneMeetingPerHost';

const { resolveRoomEntry, resolveHostActiveMeeting, listActiveRoomNames } = vi.hoisted(() => ({
  resolveRoomEntry: vi.fn(),
  resolveHostActiveMeeting: vi.fn(),
  listActiveRoomNames: vi.fn(),
}));

vi.mock('@/lib/resolvePersonalRoomJoin', () => ({ resolveRoomEntry: (...a: unknown[]) => resolveRoomEntry(...a) }));
vi.mock('@/lib/hostActiveMeeting', () => ({
  resolveHostActiveMeeting: (...a: unknown[]) => resolveHostActiveMeeting(...a),
}));
vi.mock('@/lib/livekitRooms', () => ({ listActiveRoomNames: () => listActiveRoomNames() }));
vi.mock('@/lib/meetingRoomIsActive', () => ({
  isRoomLiveInList: (name: string, list: string[]) => list.some((n) => n.toLowerCase() === name.toLowerCase()),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('followOwnerLiveRoom', () => {
  it("sends a personal ID to the meeting its owner is hosting", async () => {
    resolveRoomEntry.mockResolvedValue({ kind: 'join_live', personalRoomId: 'm5888', effectiveRoomName: 'uzf-dfxb-smf' });
    expect(await followOwnerLiveRoom('m5888')).toBe('uzf-dfxb-smf');
  });

  it('keeps the room when the live session is the personal room itself', async () => {
    resolveRoomEntry.mockResolvedValue({ kind: 'join_live', personalRoomId: 'm5888', effectiveRoomName: 'M5888' });
    expect(await followOwnerLiveRoom('m5888')).toBeNull();
  });

  it('leaves ordinary codes and idle personal rooms alone, and never blocks on errors', async () => {
    resolveRoomEntry.mockResolvedValueOnce({ kind: 'direct_join', roomName: 'abc-defg-hij' });
    expect(await followOwnerLiveRoom('abc-defg-hij')).toBeNull();
    resolveRoomEntry.mockResolvedValueOnce({ kind: 'open_personal_idle', personalRoomId: 'm5888' });
    expect(await followOwnerLiveRoom('m5888')).toBeNull();
    resolveRoomEntry.mockRejectedValueOnce(new Error('db down'));
    expect(await followOwnerLiveRoom('m5888')).toBeNull();
  });
});

describe('otherLiveMeetingOfHost', () => {
  const live = { id: 1929, roomName: 'uzf-dfxb-smf', title: null, status: 'ACTIVE' };

  it('reports the live meeting when the host starts another one', async () => {
    listActiveRoomNames.mockResolvedValue(['uzf-dfxb-smf']);
    resolveHostActiveMeeting.mockResolvedValue(live);
    expect(await otherLiveMeetingOfHost(2, 'mmi-filo-tjy')).toEqual(live);
    expect(resolveHostActiveMeeting).toHaveBeenCalledWith(2, 'mmi-filo-tjy');
  });

  it('lets the host back into a meeting that is already running', async () => {
    listActiveRoomNames.mockResolvedValue(['uzf-dfxb-smf', 'mmi-filo-tjy']);
    expect(await otherLiveMeetingOfHost(2, 'mmi-filo-tjy')).toBeNull();
    expect(resolveHostActiveMeeting).not.toHaveBeenCalled();
  });

  it('passes when nothing else is live, LiveKit is unreachable, or the check fails', async () => {
    listActiveRoomNames.mockResolvedValueOnce(['uzf-dfxb-smf']);
    resolveHostActiveMeeting.mockResolvedValueOnce(null);
    expect(await otherLiveMeetingOfHost(2, 'mmi-filo-tjy')).toBeNull();
    listActiveRoomNames.mockResolvedValueOnce([]);
    expect(await otherLiveMeetingOfHost(2, 'mmi-filo-tjy')).toBeNull();
    listActiveRoomNames.mockRejectedValueOnce(new Error('livekit down'));
    expect(await otherLiveMeetingOfHost(2, 'mmi-filo-tjy')).toBeNull();
  });
});
