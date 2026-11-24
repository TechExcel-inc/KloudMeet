import { prisma } from '@/lib/db';
import type { Recording } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

/** One in-memory recording row behind a minimal stand-in for the Prisma calls the module makes. */
const db = vi.hoisted(() => {
  const same = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, want]) => {
      if (key === 'OR') return (want as Row[]).some((option) => matches(row, option));
      const have = row[key];
      if (want !== null && typeof want === 'object' && !(want instanceof Date)) {
        const rule = want as { lt?: Date; in?: unknown[] };
        if (rule.lt) return have instanceof Date && have.getTime() < rule.lt.getTime();
        if (rule.in) return rule.in.includes(have);
      }
      return same(have, want);
    });
  const state = { row: {} as Row };
  const recording = {
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      if (!matches(state.row, where)) return { count: 0 };
      Object.assign(state.row, data);
      return { count: 1 };
    },
    update: async ({ data }: { data: Row }) => Object.assign(state.row, data),
    findUnique: async () => ({ ...state.row }),
    findUniqueOrThrow: async () => ({ ...state.row }),
  };
  return { state, prisma: { recording, meetingTranscript: { count: vi.fn(async () => 1) } } };
});

vi.mock('@/lib/speechSettings.server', () => ({ assemblyAiKey: async () => process.env.ASSEMBLYAI_API_KEY }));
vi.mock('@/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {},
  GetObjectCommand: class {},
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: async () => 'https://storage.example/signed-recording',
}));

import {
  SUBMIT_STALE_MS,
  advanceRecordingTranscription,
  startAutomaticRecordingTranscription,
  startRecordingTranscription,
  transcribeStateOf,
} from '@/lib/recordingTranscription';

function recording(fields: Partial<Recording>): Recording {
  return { id: 1, sttStatus: null, sttError: null, sttStartedAt: null, durationSeconds: 60, ...fields } as Recording;
}

describe('transcribeStateOf', () => {
  it('reports a recording with no speech as done, not failed', () => {
    const state = transcribeStateOf(
      recording({ sttStatus: 'FAILED', sttError: 'DashScope task failed: SUCCESS_WITH_NO_VALID_FRAGMENT' }),
    );
    expect(state).toEqual({ status: 'SUCCEEDED', progress: 100, error: null });
  });

  it('keeps other failures', () => {
    const state = transcribeStateOf(
      recording({ sttStatus: 'FAILED', sttError: 'DashScope task failed: FILE_DOWNLOAD_FAILED' }),
    );
    expect(state.status).toBe('FAILED');
    expect(state.error).toContain('FILE_DOWNLOAD_FAILED');
  });
});

describe('submitting a recording', () => {
  let submissions: number;
  let release: () => void;
  let fail: (err: Error) => void;
  const row = () => db.state.row as unknown as Recording;

  beforeEach(() => {
    vi.stubEnv('S3_BUCKET', 'bucket');
    vi.stubEnv('ASSEMBLYAI_API_KEY', 'test-key');
    db.state.row = { ...recording({ storageKey: 'rooms/a/meeting.mp4', sttTaskId: null }) };
    submissions = 0;
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.assemblyai.com/v2/transcript');
      expect(JSON.parse(String(init.body)).audio_url).toBe('https://storage.example/signed-recording');
      submissions += 1;
      return new Promise<Response>((resolve, reject) => {
        release = () => resolve(Response.json({ id: 'task-1' }));
        fail = reject;
      });
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Starts a submit and waits until its download from S3 is in flight. */
  async function startSubmit() {
    const submit = startRecordingTranscription(row());
    await vi.waitFor(() => expect(submissions).toBe(1));
    return { submit };
  }

  /** Another request claims the recording while the first submission is still running. */
  function takeOver(): Date {
    const newer = new Date(Date.now() + 5000);
    db.state.row.sttStartedAt = newer;
    return newer;
  }

  it('submits a signed recording URL and records the task', async () => {
    const { submit } = await startSubmit();
    release();
    const state = await submit;
    expect(state.status).toBe('RUNNING');
    expect(row().sttTaskId).toBe('assemblyai:task-1');
  });

  it('automatically submits AI Notes audio even when transcript sync is off and captions exist', async () => {
    Object.assign(db.state.row, { mode: 'ai_notes', syncTranscript: false, meetingId: 2 });
    const submit = startAutomaticRecordingTranscription(row());
    await vi.waitFor(() => expect(submissions).toBe(1));
    release();
    await submit;
    expect(db.state.row).toMatchObject({ sttStatus: 'RUNNING', sttTaskId: 'assemblyai:task-1' });
  });

  it('claims a finished legacy job for fresh AssemblyAI transcription', async () => {
    db.state.row.sttStatus = 'SUCCEEDED';
    db.state.row.sttTaskId = 'legacy-task';
    const original = { ...row() };
    const submit = startRecordingTranscription(original, { regenerate: true });
    await vi.waitFor(() => expect(submissions).toBe(1));
    expect(db.state.row.sttTaskId).toBeNull();

    const duplicate = await startRecordingTranscription(original, { regenerate: true });
    expect(duplicate.status).toBe('SUBMITTING');
    expect(submissions).toBe(1);
    release();
    expect((await submit).status).toBe('RUNNING');
    expect(row().sttTaskId).toBe('assemblyai:task-1');
  });

  it('is not submitted again while a slow submission is still in progress', async () => {
    db.state.row.sttStatus = 'SUBMITTING';
    db.state.row.sttStartedAt = new Date(Date.now() - 10 * 60 * 1000);
    const state = await advanceRecordingTranscription(row());
    expect(state.status).toBe('SUBMITTING');
    expect(submissions).toBe(0);
  });

  it('is submitted again once the earlier submit has clearly been abandoned', async () => {
    db.state.row.sttStatus = 'SUBMITTING';
    db.state.row.sttStartedAt = new Date(Date.now() - SUBMIT_STALE_MS - 1000);
    const submit = advanceRecordingTranscription(row());
    await vi.waitFor(() => expect(submissions).toBe(1));
    release();
    expect((await submit).status).toBe('RUNNING');
  });

  it('leaves a newer submit alone when an older one finishes late', async () => {
    const { submit } = await startSubmit();
    const newer = takeOver();
    release();
    const state = await submit;
    expect(state.status).toBe('SUBMITTING');
    expect(row().sttTaskId).toBeNull();
    expect(row().sttStartedAt).toEqual(newer);
  });

  it('does not mark a newer submit failed when an older one fails late', async () => {
    const { submit } = await startSubmit();
    takeOver();
    fail(new Error('S3 unreachable'));
    const state = await submit;
    expect(state).toMatchObject({ status: 'SUBMITTING', error: null });
  });

  it('records the failure of the submit that still holds the claim', async () => {
    const { submit } = await startSubmit();
    fail(new Error('S3 unreachable'));
    const state = await submit;
    expect(state.status).toBe('FAILED');
    expect(state.error).toContain('S3 unreachable');
    expect(row().sttTaskId).toBeNull();
  });
});

describe('advanceRecordingTranscription', () => {
  it('saves timed AssemblyAI sentences even when the last recorded state was queued', async () => {
    const current = recording({
      sttStatus: 'QUEUED',
      sttTaskId: 'assemblyai:meeting-test',
      meetingId: 7,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: 'completed', text: '你好。' }))
      .mockResolvedValueOnce(Response.json({ sentences: [{ start: 1250, end: 2000, text: '你好。' }] }));
    const findUniqueOrThrow = vi.fn().mockResolvedValue({ ...current, sttStatus: 'SUCCEEDED' });
    const claim = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn();
    Object.assign(prisma, {
      recording: { findUnique: vi.fn().mockResolvedValue(current), findUniqueOrThrow, updateMany: claim, update: vi.fn() },
      recordingSpeakInterval: { findMany: vi.fn().mockResolvedValue([]) },
      meetingTranscript: { deleteMany: vi.fn(), createMany },
      $transaction: vi.fn(async (write: (client: typeof prisma) => Promise<void>) => write(prisma)),
    });
    vi.stubEnv('ASSEMBLYAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(advanceRecordingTranscription(current)).resolves.toMatchObject({ status: 'SUCCEEDED' });
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        'https://api.assemblyai.com/v2/transcript/meeting-test',
        'https://api.assemblyai.com/v2/transcript/meeting-test/sentences',
      ]);
      expect(claim.mock.calls[0][0].where.OR[0].sttStatus.in).toContain('QUEUED');
      expect(createMany).toHaveBeenCalledWith({ data: [{
        meetingId: 7,
        speakerName: 'Speaker 1',
        content: '你好。',
        captionTime: new Date('2026-01-01T00:00:01.250Z'),
        offsetSeconds: 1,
        sourceId: 'assemblyai-1-0',
      }] });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
