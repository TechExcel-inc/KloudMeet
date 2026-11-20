import type { Recording } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

/** In-memory tables behind a stand-in for the Prisma calls lib/liveNotesServer.ts makes. */
const db = vi.hoisted(() => {
  const state = {
    transcripts: [] as Row[],
    intervals: [] as Row[],
    recording: {} as Row,
    nextId: 1,
  };
  const value = (v: unknown) => (v instanceof Date ? v.getTime() : v);
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, want]) => {
      const have = row[key];
      if (want !== null && typeof want === 'object' && !(want instanceof Date)) {
        const rule = want as { startsWith?: string; in?: unknown[]; gte?: Date };
        if (rule.startsWith !== undefined) return typeof have === 'string' && have.startsWith(rule.startsWith);
        if (rule.in) return rule.in.includes(have);
        if (rule.gte) return have instanceof Date && have.getTime() >= rule.gte.getTime();
      }
      return value(have) === value(want);
    });
  const byTime = (key: string) => (a: Row, b: Row) => (a[key] as Date).getTime() - (b[key] as Date).getTime();
  const prisma = {
    meetingTranscript: {
      findMany: async ({ where }: { where: Row }) => state.transcripts.filter((row) => matches(row, where)).sort(byTime('captionTime')).map((row) => ({ ...row })),
      count: async ({ where }: { where: Row }) => state.transcripts.filter((row) => matches(row, where)).length,
      createMany: async ({ data }: { data: Row[] }) => {
        for (const item of data) state.transcripts.push({ id: state.nextId++, ...item });
        return { count: data.length };
      },
      update: async ({ where, data }: { where: { id: number }; data: Row }) =>
        Object.assign(state.transcripts.find((row) => row.id === where.id)!, data),
    },
    recordingSpeakInterval: {
      findMany: async ({ where }: { where: Row }) => state.intervals.filter((row) => matches(row, where)).sort(byTime('startedAt')),
    },
    recording: {
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (!matches(state.recording, where)) return { count: 0 };
        Object.assign(state.recording, data);
        return { count: 1 };
      },
      findUnique: async () => ({ ...state.recording }),
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  };
  return { state, prisma };
});

const billing = vi.hoisted(() => ({ onRecordingReady: vi.fn(async (_recording: { id: number; durationSeconds: number | null }) => undefined) }));
const rooms = vi.hoisted(() => ({ sendData: vi.fn(async () => undefined), available: true }));

vi.mock('@/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/lib/billing/limits', () => billing);
const presentation = vi.hoisted(() => ({
  PRESENTATION_SETTLE_MS: 8000,
  schedulePresentation: vi.fn((_meetingId: number, _request: object) => undefined),
}));
vi.mock('@/lib/meetingPresentationServer', () => presentation);
vi.mock('@/lib/livekitRooms', () => ({
  getRoomServiceClient: () => (rooms.available ? { sendData: rooms.sendData } : null),
}));

import { NOTES_FINISH_TOPIC } from '@/lib/liveNotes';
import {
  askRecorderToFlush,
  finishLiveNotes,
  realignLiveNotes,
  saveLiveSentences,
  startedWhilePaused,
} from '@/lib/liveNotesServer';

/** The session starts at T; every time below is T plus seconds. */
const T = Date.UTC(2026, 10, 19, 9, 0, 0);
const at = (seconds: number) => T + seconds * 1000;

function session(fields: Partial<Recording> = {}): Recording {
  return {
    id: 7,
    meetingId: 3,
    teamMemberId: 11,
    storageProvider: 'NONE',
    status: 'PROCESSING',
    mediaStartedAt: new Date(T),
    createdAt: new Date(T - 4000),
    pausedAt: null,
    pauseSpans: null,
    ...fields,
  } as Recording;
}

/** A speak interval as the recorder reports it: detection runs about half a second behind the audio. */
function spoke(name: string, fromSeconds: number, toSeconds: number, level = 0.4) {
  db.state.intervals.push({
    recordingId: 7,
    participantIdentity: `id-${name}`,
    displayName: name,
    startedAt: new Date(at(fromSeconds) + 500),
    endedAt: new Date(at(toSeconds) + 500),
    avgLevel: level,
  });
}

const said = (id: number, fromSeconds: number, toSeconds: number, text: string) => ({
  stream: T,
  id,
  startMs: at(fromSeconds),
  endMs: at(toSeconds),
  text,
});

const lines = () =>
  [...db.state.transcripts]
    .sort((a, b) => (a.captionTime as Date).getTime() - (b.captionTime as Date).getTime())
    .map((row) => [row.speakerName, row.content, row.offsetSeconds]);

beforeEach(() => {
  db.state.transcripts = [];
  db.state.intervals = [];
  db.state.recording = { ...session() };
  db.state.nextId = 1;
  billing.onRecordingReady.mockClear();
  presentation.schedulePresentation.mockClear();
  rooms.sendData.mockClear();
  rooms.available = true;
});

describe('saveLiveSentences', () => {
  it('stores sentences with who was speaking and when, on the session clock', async () => {
    spoke('Ana', 4, 9);
    spoke('Ben', 10, 14);
    const count = await saveLiveSentences(session(), [said(1, 5, 8, 'Good morning'), said(2, 10.5, 13, 'Hi Ana')]);
    expect(count).toBe(2);
    expect(lines()).toEqual([['Ana', 'Good morning', 5], ['Ben', 'Hi Ana', 10]]);
    expect(db.state.transcripts[0]).toMatchObject({ meetingId: 3, sourceId: `live-7-${T}-1-3000`, captionTime: new Date(at(5)) });
  });

  it('does not store a sentence twice when the recorder retries', async () => {
    spoke('Ana', 4, 9);
    await saveLiveSentences(session(), [said(1, 5, 8, 'Good morning')]);
    const again = await saveLiveSentences(session(), [said(1, 5, 8, 'Good morning'), said(1, 5, 8, 'Good morning'), said(2, 8.5, 9, 'Next')]);
    expect(again).toBe(1);
    expect(lines().map((line) => line[1])).toEqual(['Good morning', 'Next']);
  });

  it('names a sentence once its speak interval arrives', async () => {
    await saveLiveSentences(session(), [said(1, 5, 8, 'Good morning')]);
    expect(lines()).toEqual([['Unknown', 'Good morning', 5]]);
    spoke('Ana', 4, 9);
    expect(await realignLiveNotes(session(), { fromMs: at(4) + 500 })).toBe(1);
    expect(lines()).toEqual([['Ana', 'Good morning', 5]]);
  });

  it('keeps a name already found when a later, partial look finds nobody', async () => {
    spoke('Ana', 4, 9);
    await saveLiveSentences(session(), [said(1, 5, 8, 'Good morning')]);
    db.state.intervals = [];
    expect(await realignLiveNotes(session(), { fromMs: at(5) })).toBe(0);
    expect(lines()[0][0]).toBe('Ana');
  });

  it('picks the louder speaker when two people overlap', async () => {
    spoke('Ana', 4, 9, 0.1);
    spoke('Ben', 5, 8, 0.8);
    await saveLiveSentences(session(), [said(1, 5, 8, 'Both at once')]);
    expect(lines()[0][0]).toBe('Ben');
  });

  it('drops what was said while notes were paused', async () => {
    spoke('Ana', 0, 60);
    const spans = [{ from: new Date(at(20)).toISOString(), to: new Date(at(30)).toISOString() }];
    const paused = session({ pauseSpans: spans as unknown as Recording['pauseSpans'], pausedAt: new Date(at(50)) });
    const count = await saveLiveSentences(paused, [
      said(1, 18, 21, 'started before the pause'),
      said(2, 22, 25, 'during the first pause'),
      said(3, 31, 33, 'between pauses'),
      said(4, 51, 53, 'during the open pause'),
    ]);
    expect(count).toBe(2);
    expect(lines().map((line) => line[1])).toEqual(['started before the pause', 'between pauses']);
    expect(startedWhilePaused(at(30), null, spans)).toBe(false);
  });

  it('never gives a sentence a negative offset', async () => {
    await saveLiveSentences(session(), [{ stream: T - 5000, id: 1, startMs: T - 2000, endMs: T - 500, text: 'early' }]);
    expect(lines()[0][2]).toBe(0);
  });
});

describe('finishLiveNotes', () => {
  it('makes the session ready with its length from the clock, and bills it once without the pauses', async () => {
    spoke('Ana', 4, 9);
    await saveLiveSentences(session(), [said(1, 5, 8, 'Good morning')]);
    db.state.recording.pauseSpans = [{ from: new Date(at(100)).toISOString(), to: new Date(at(160)).toISOString() }];

    await finishLiveNotes(session(), { endedAt: new Date(at(600)) });
    expect(db.state.recording).toMatchObject({ status: 'READY', durationSeconds: 600, mediaStartedAt: new Date(T) });
    expect(billing.onRecordingReady).toHaveBeenCalledTimes(1);
    expect(billing.onRecordingReady.mock.calls[0][0]).toMatchObject({ id: 7, teamMemberId: 11, meetingId: 3, durationSeconds: 540 });
    // The AI presentation is started right away, once, on the recorder's AI allowance.
    expect(presentation.schedulePresentation.mock.calls).toEqual([[3, { memberId: 11, delayMs: 8000 }]]);

    // LiveKit's egress_ended and the dashboard's sync arrive later: nothing changes twice.
    await finishLiveNotes(session(), { endedAt: new Date(at(900)) });
    await finishLiveNotes(session({ status: 'READY' }), { endedAt: new Date(at(900)) });
    expect(db.state.recording.durationSeconds).toBe(600);
    expect(billing.onRecordingReady).toHaveBeenCalledTimes(1);
    expect(presentation.schedulePresentation).toHaveBeenCalledTimes(1);
  });

  it('matches sentences and intervals that arrived after the session ended', async () => {
    await finishLiveNotes(session(), { endedAt: new Date(at(600)) });
    await saveLiveSentences(session({ status: 'READY' }), [said(9, 590, 594, 'the last words')]);
    spoke('Ben', 589, 595);
    await finishLiveNotes(session({ status: 'READY' }), {});
    expect(lines()).toEqual([['Ben', 'the last words', 590]]);
  });

  it('uses one name when the recorder reported no speak intervals at all', async () => {
    await saveLiveSentences(session(), [said(1, 5, 8, 'Good morning')]);
    await finishLiveNotes(session(), { endedAt: new Date(at(60)) });
    expect(lines()).toEqual([['Speaker 1', 'Good morning', 5]]);
  });

  it('counts from when the row was made when the recorder never reported its clock', async () => {
    const early = session({ mediaStartedAt: null });
    db.state.recording = { ...early };
    await saveLiveSentences(early, [said(1, 5, 8, 'Good morning')]);
    expect(lines()[0][2]).toBe(9);
    await finishLiveNotes(early, { endedAt: new Date(at(56)) });
    expect(db.state.recording).toMatchObject({ status: 'READY', durationSeconds: 60, mediaStartedAt: new Date(T - 4000) });
  });

  it('fails a session whose recorder broke before any notes, but keeps one that has notes', async () => {
    await finishLiveNotes(session(), { endedAt: new Date(at(30)), failed: true });
    expect(db.state.recording.status).toBe('FAILED');
    expect(billing.onRecordingReady).not.toHaveBeenCalled();
    expect(presentation.schedulePresentation).not.toHaveBeenCalled();

    db.state.recording = { ...session() };
    await saveLiveSentences(session(), [said(1, 5, 8, 'Good morning')]);
    await finishLiveNotes(session(), { endedAt: new Date(at(30)), failed: true });
    expect(db.state.recording.status).toBe('READY');
    expect(billing.onRecordingReady).toHaveBeenCalledTimes(1);
  });

  it('leaves a recording that has a media file alone', async () => {
    const file = session({ storageProvider: 'S3' });
    db.state.recording = { ...file };
    await finishLiveNotes(file, { endedAt: new Date(at(600)) });
    expect(db.state.recording.status).toBe('PROCESSING');
    expect(billing.onRecordingReady).not.toHaveBeenCalled();
  });
});

describe('askRecorderToFlush', () => {
  it('tells the recorder page and gives it a moment', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      void askRecorderToFlush('room-1').then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(1900);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(done).toBe(true);
      const [room, payload, , options] = rooms.sendData.mock.calls[0] as unknown as [string, Uint8Array, unknown, { topic: string }];
      expect(room).toBe('room-1');
      expect(new TextDecoder().decode(payload)).toBe('finish');
      expect(options.topic).toBe(NOTES_FINISH_TOPIC);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not hold up stopping when LiveKit cannot be reached', async () => {
    rooms.available = false;
    await askRecorderToFlush('room-1');
    rooms.available = true;
    rooms.sendData.mockRejectedValueOnce(new Error('room closed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await askRecorderToFlush('room-1');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
