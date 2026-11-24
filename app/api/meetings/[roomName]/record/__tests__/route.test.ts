import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

/** Set before the route module reads its configuration. */
const env = vi.hoisted(() => {
  Object.assign(process.env, {
    LIVEKIT_URL: 'wss://livekit.test',
    LIVEKIT_API_KEY: 'key',
    LIVEKIT_API_SECRET: 'secret',
    S3_ACCESS_KEY: 'access',
    S3_SECRET: 'secret',
    S3_REGION: 'us-west-1',
    S3_BUCKET: 'bucket',
  });
  delete process.env.S3_ENDPOINT;
  delete process.env.AI_NOTES_CAPTURE;
  return {};
});
void env;

const db = vi.hoisted(() => {
  const state = { meeting: {} as Row, recordings: [] as Row[], nextId: 1 };
  const prisma = {
    meeting: {
      findUnique: async () => ({ ...state.meeting }),
      update: async ({ data }: { data: Row }) => Object.assign(state.meeting, data),
    },
    recording: {
      findUnique: async ({ where }: { where: { id: number } }) =>
        state.recordings.find((row) => row.id === where.id) ?? null,
      findFirst: async ({ where }: { where: Row }) =>
        [...state.recordings].reverse().find((row) =>
          row.status === where.status && !row.deletedAt
          && (where.storageProvider === undefined || row.storageProvider === where.storageProvider)
          && (where.createdAt === undefined || (row.createdAt as Date) >= (where.createdAt as { gte: Date }).gte)) ?? null,
      findMany: async ({ where }: { where: Row }) => state.recordings.filter((row) => row.status === where.status),
      create: async ({ data }: { data: Row }) => {
        const row = { id: state.nextId++, createdAt: new Date(), pausedAt: null, pauseSpans: null, deletedAt: null, kind: 'screen_share', livedocRecordingId: null, livedocToken: null, ...data };
        state.recordings.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: number }; data: Row }) =>
        Object.assign(state.recordings.find((row) => row.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.recordings.filter((row) => Object.entries(where).every(([key, value]) => {
          if (value && typeof value === 'object' && 'in' in value) return (value.in as unknown[]).includes(row[key]);
          return row[key] === value;
        }));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    recordingSection: { updateMany: async () => ({ count: 0 }) },
  };
  return { state, prisma };
});

const egress = vi.hoisted(() => ({
  startWebEgress: vi.fn(),
  stopEgress: vi.fn(async (_id: string) => undefined),
}));
const notes = vi.hoisted(() => ({
  askRecorderToFlush: vi.fn(async (_room: string) => undefined),
  finishLiveNotes: vi.fn(async (_recording: { id: number }, _opts: object) => undefined),
}));

vi.mock('@/lib/db', () => ({ prisma: db.prisma }));
vi.mock('livekit-server-sdk', async (original) => ({
  ...(await original<typeof import('livekit-server-sdk')>()),
  EgressClient: class {
    startWebEgress = egress.startWebEgress;
    stopEgress = egress.stopEgress;
  },
}));
vi.mock('@/lib/apiAuth', () => ({
  requireSession: async () => ({ id: 11 }),
  isAuthError: () => false,
}));
vi.mock('@/lib/livekitParticipantAuth', () => ({ verifyParticipant: async () => null }));
vi.mock('@/lib/billing/limits', () => ({ checkReplayQuota: async () => null }));
vi.mock('@/lib/livedoc/kloudRecording', () => ({
  startKloudRecording: vi.fn(), endKloudRecording: vi.fn(), finishLivedocRecording: vi.fn(),
  closePendingLivedocAttachment: async (scope: Row) => {
    await db.prisma.recording.updateMany({
      where: { ...scope, status: 'PROCESSING', livedocRecordingId: null },
      data: { livedocToken: '' },
    });
  },
}));
vi.mock('@/lib/livedoc/screenSections', () => ({ startScreenSectionsForRoom: vi.fn(), stopScreenSections: vi.fn() }));
vi.mock('@/lib/livedoc/presenceRecord', () => ({ snapshotPresence: vi.fn(async () => undefined) }));
vi.mock('@/lib/liveNotesServer', () => notes);

import { EncodedFileOutput, StreamOutput } from 'livekit-server-sdk';
import { endKloudRecording, finishLivedocRecording, startKloudRecording } from '@/lib/livedoc/kloudRecording';
import { GET, POST } from '../route';

const params = { params: Promise.resolve({ roomName: 'room-1' }) };

async function post(body: Row) {
  const request = new NextRequest('https://meet.kloud.cn/api/meetings/room-1/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', host: 'meet.kloud.cn' },
    body: JSON.stringify(body),
  });
  const response = await POST(request, params);
  return { status: response.status, body: (await response.json()) as Row & { state?: Row } };
}

const start = (mode: string) => post({ action: 'start', mode, pageUrl: 'https://meet.kloud.cn/rooms/room-1?x=1' });
const attach = () => post({ action: 'attach-livedoc', recordingId: 1, livedocInstanceId: '42', livedocToken: 'token' });

beforeEach(() => {
  delete process.env.AI_NOTES_CAPTURE;
  db.state.meeting = {
    id: 3, roomName: 'room-1', createdByMemberId: 11, meetingRoles: null, kloudMeetingId: null,
    recordingMode: 'full', recordingHostOnly: true, recordingSyncTranscript: true,
  };
  db.state.recordings = [];
  db.state.nextId = 1;
  egress.startWebEgress.mockReset();
  egress.startWebEgress.mockImplementation(async () => ({ egressId: 'EG_1' }));
  egress.stopEgress.mockClear();
  notes.askRecorderToFlush.mockClear();
  notes.finishLiveNotes.mockClear();
  vi.mocked(startKloudRecording).mockReset().mockResolvedValue(73);
  vi.mocked(endKloudRecording).mockClear();
  vi.mocked(finishLivedocRecording).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('starting AI Notes Only', () => {
  it('starts independently of a bound LiveDoc and retries attaching it on the same notes session', async () => {
    db.state.meeting.kloudMeetingId = 42;
    vi.mocked(startKloudRecording).mockRejectedValueOnce(new Error('LiveDoc is not ready'));
    const started = await post({ action: 'start', mode: 'ai_notes', pageUrl: 'https://meet.kloud.cn/rooms/room-1', livedocToken: 'token' });
    expect(started.status).toBe(200);
    expect(started.body.state).toMatchObject({ active: true, recordingId: 1, livedocRecordingId: null });
    expect(startKloudRecording).not.toHaveBeenCalled();

    expect((await attach()).status).toBe(202);
    expect(db.state.recordings[0]).toMatchObject({ status: 'PROCESSING', livedocToken: null });
    const attached = await attach();
    expect(attached.body).toMatchObject({ attached: true, state: { recordingId: 1, livedocRecordingId: 73, notesLive: true } });
    expect((await attach()).body.state).toMatchObject({ livedocRecordingId: 73 });
    expect(startKloudRecording).toHaveBeenCalledTimes(2);
    expect(egress.startWebEgress).toHaveBeenCalledTimes(1);

    await post({ action: 'stop' });
    expect(finishLivedocRecording).toHaveBeenCalledWith(expect.objectContaining({ livedocToken: 'token' }), 42, null);
  });

  it('cleans up an attachment that completes after the recording stops', async () => {
    await start('ai_notes');
    expect((await attach()).status).toBe(202);
    db.state.meeting.kloudMeetingId = 42;
    let resolveStart!: (id: number) => void;
    vi.mocked(startKloudRecording).mockImplementationOnce(() => new Promise((resolve) => { resolveStart = resolve; }));
    const pending = attach();
    await vi.waitFor(() => expect(startKloudRecording).toHaveBeenCalledTimes(1));
    expect((await attach()).status).toBe(202);
    expect((await post({ action: 'stop' })).status).toBe(200);
    resolveStart(73);
    expect((await pending).status).toBe(202);
    expect(endKloudRecording).toHaveBeenCalledWith(42, 'token');
    expect(db.state.recordings[0]).toMatchObject({ livedocRecordingId: null });
  });

  it('runs the recorder with no file and no stream destination, and marks the session as having no media', async () => {
    const { status, body } = await start('ai_notes');
    expect(status).toBe(200);
    expect(egress.startWebEgress).toHaveBeenCalledTimes(1);
    const [url, output, options] = egress.startWebEgress.mock.calls[0];
    expect(output).toBeInstanceOf(StreamOutput);
    expect((output as StreamOutput).urls).toEqual([]);
    expect(options).toEqual({ audioOnly: true, videoOnly: false });
    const page = new URL(url as string);
    expect(page.searchParams.get('isBot')).toBe('true');
    expect(page.searchParams.get('recToken')).toBe(db.state.recordings[0].activityToken);

    expect(db.state.recordings[0]).toMatchObject({
      storageProvider: 'NONE', storageKey: 'EG_1', status: 'PROCESSING', mode: 'ai_notes', fileName: expect.not.stringMatching(/\.mp4$/),
    });
    expect(body.state).toMatchObject({ active: true, mode: 'ai_notes', notesLive: true });
  });

  it('records an audio file instead when the recorder cannot start without one', async () => {
    egress.startWebEgress.mockRejectedValueOnce(new Error('stream output needs a url'));
    const { status, body } = await start('ai_notes');
    expect(status).toBe(200);
    expect(egress.startWebEgress).toHaveBeenCalledTimes(2);
    expect(egress.startWebEgress.mock.calls[1][1]).toBeInstanceOf(EncodedFileOutput);
    expect(egress.startWebEgress.mock.calls[1][2]).toEqual({ audioOnly: true, videoOnly: false });
    expect(db.state.recordings[0]).toMatchObject({ storageProvider: 'S3', fileName: expect.stringMatching(/\.mp4$/) });
    expect(body.state).toMatchObject({ mode: 'ai_notes', notesLive: false });
  });

  it('records an audio file for a while after a live notes session of the meeting broke', async () => {
    db.state.recordings.push({ id: 90, status: 'FAILED', storageProvider: 'NONE', createdAt: new Date(Date.now() - 5 * 60 * 1000), deletedAt: null });
    await start('ai_notes');
    expect(egress.startWebEgress).toHaveBeenCalledTimes(1);
    expect(egress.startWebEgress.mock.calls[0][1]).toBeInstanceOf(EncodedFileOutput);

    // An old failure no longer counts.
    db.state.recordings = [{ id: 91, status: 'FAILED', storageProvider: 'NONE', createdAt: new Date(Date.now() - 2 * 3600 * 1000), deletedAt: null }];
    egress.startWebEgress.mockClear();
    await start('ai_notes');
    expect(egress.startWebEgress.mock.calls[0][1]).toBeInstanceOf(StreamOutput);
  });

  it('keeps AI Notes Only when a later start requests Full Recording', async () => {
    await start('ai_notes');
    const duplicate = await start('full');
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toMatchObject({ alreadyActive: true, state: { active: true, mode: 'ai_notes' } });
    expect(egress.startWebEgress).toHaveBeenCalledTimes(1);
    expect(db.state.recordings).toHaveLength(1);
  });

  it('records an audio file when the server is set to keep one', async () => {
    process.env.AI_NOTES_CAPTURE = 'file';
    const { body } = await start('ai_notes');
    expect(egress.startWebEgress).toHaveBeenCalledTimes(1);
    expect(egress.startWebEgress.mock.calls[0][1]).toBeInstanceOf(EncodedFileOutput);
    expect(db.state.recordings[0].storageProvider).toBe('S3');
    expect(body.state?.notesLive).toBe(false);
  });
});

describe('Full Recording', () => {
  it('is unchanged: a video file', async () => {
    await start('full');
    expect(egress.startWebEgress).toHaveBeenCalledTimes(1);
    expect(egress.startWebEgress.mock.calls[0][1]).toBeInstanceOf(EncodedFileOutput);
    expect(egress.startWebEgress.mock.calls[0][2]).toEqual({ audioOnly: false, videoOnly: false });
    expect(db.state.recordings[0]).toMatchObject({ storageProvider: 'S3', mode: 'full' });
  });

  it('stops without the notes steps', async () => {
    await start('full');
    const { status } = await post({ action: 'stop' });
    expect(status).toBe(200);
    expect(egress.stopEgress).toHaveBeenCalledWith('EG_1');
    expect(notes.askRecorderToFlush).not.toHaveBeenCalled();
    expect(notes.finishLiveNotes).not.toHaveBeenCalled();
  });
});

describe('stopping AI Taking Notes', () => {
  it('asks the recorder for its last sentence, stops it, then closes the session', async () => {
    await start('ai_notes');
    const order: string[] = [];
    notes.askRecorderToFlush.mockImplementationOnce(async () => void order.push('flush'));
    egress.stopEgress.mockImplementationOnce(async () => void order.push('stop'));
    notes.finishLiveNotes.mockImplementationOnce(async () => void order.push('finish'));

    const { status, body } = await post({ action: 'stop' });
    expect(status).toBe(200);
    expect(order).toEqual(['flush', 'stop', 'finish']);
    expect(notes.askRecorderToFlush).toHaveBeenCalledWith('room-1');
    expect(notes.finishLiveNotes.mock.calls[0][0]).toMatchObject({ id: 1, storageProvider: 'NONE' });
    expect(body.state).toMatchObject({ active: false });
  });

  it('does not wait for a last sentence when notes are paused', async () => {
    await start('ai_notes');
    await post({ action: 'pause' });
    expect(db.state.recordings[0].pausedAt).toBeInstanceOf(Date);
    await post({ action: 'stop' });
    expect(notes.askRecorderToFlush).not.toHaveBeenCalled();
    expect(notes.finishLiveNotes).toHaveBeenCalledTimes(1);
    expect(db.state.recordings[0].pausedAt).toBeNull();
  });
});

describe('recording state for the meeting', () => {
  it('says whether AI Notes keeps audio, before and during a session', async () => {
    const state = async () => {
      const request = new NextRequest('https://meet.kloud.cn/api/meetings/room-1/record', { headers: { authorization: 'Bearer x' } });
      return ((await (await GET(request, params)).json()) as { state: Row }).state;
    };
    expect(await state()).toMatchObject({ active: false, notesLive: true });
    process.env.AI_NOTES_CAPTURE = 'file';
    expect(await state()).toMatchObject({ active: false, notesLive: false });
    delete process.env.AI_NOTES_CAPTURE;
    await start('ai_notes');
    // A running session answers for itself, whatever the setting is now.
    process.env.AI_NOTES_CAPTURE = 'file';
    expect(await state()).toMatchObject({ active: true, notesLive: true });
  });

  it('reports AI Notes Only when a live notes row still has the old full mode', async () => {
    db.state.recordings.push({
      id: 7,
      status: 'PROCESSING',
      storageProvider: 'NONE',
      mode: 'full',
      deletedAt: null,
      pausedAt: null,
      kind: 'screen_share',
    });
    const request = new NextRequest('https://meet.kloud.cn/api/meetings/room-1/record', { headers: { authorization: 'Bearer x' } });
    const body = (await (await GET(request, params)).json()) as { state: Row };
    expect(body.state).toMatchObject({ active: true, mode: 'ai_notes', notesLive: true });
  });
});
