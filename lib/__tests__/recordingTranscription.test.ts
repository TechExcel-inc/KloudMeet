import { Readable } from 'node:stream';
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
  return { state, prisma: { recording } };
});

/** The S3 download, held open by a test until it calls release() or fail(). */
const s3 = vi.hoisted(() => ({ send: (): Promise<unknown> => Promise.resolve(null) }));

vi.mock('@/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send() {
      return s3.send();
    }
  },
  GetObjectCommand: class {},
}));

import {
  SUBMIT_STALE_MS,
  advanceRecordingTranscription,
  startRecordingTranscription,
  transcribeStateOf,
} from '@/lib/aliyunRecordingTranscription';

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
  let downloads: number;
  let release: () => void;
  let fail: (err: Error) => void;
  const row = () => db.state.row as unknown as Recording;

  beforeEach(() => {
    process.env.S3_BUCKET = 'bucket';
    process.env.DASHSCOPE_API_KEY = 'test-key';
    db.state.row = { ...recording({ storageKey: 'rooms/a/meeting.mp4', sttTaskId: null }) };
    downloads = 0;
    s3.send = () => {
      downloads += 1;
      return new Promise((resolve, reject) => {
        release = () => resolve({ Body: Readable.from([Buffer.from('audio')]) });
        fail = reject;
      });
    };
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const target = String(url);
      if (target.includes('/uploads?action=getPolicy')) {
        return Response.json({
          data: {
            upload_host: 'https://upload.example',
            upload_dir: 'tmp/dir',
            oss_access_key_id: 'id',
            signature: 'sig',
            policy: 'policy',
            x_oss_object_acl: 'private',
            x_oss_forbid_overwrite: 'true',
            max_file_size_mb: 100,
          },
        });
      }
      if (target === 'https://upload.example') return new Response('');
      return Response.json({ output: { task_id: 'task-1' } });
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Starts a submit and waits until its download from S3 is in flight. */
  async function startSubmit() {
    const submit = startRecordingTranscription(row());
    await vi.waitFor(() => expect(downloads).toBe(1));
    return { submit };
  }

  /** Another request claims the recording while the first upload is still running. */
  function takeOver(): Date {
    const newer = new Date(Date.now() + 5000);
    db.state.row.sttStartedAt = newer;
    return newer;
  }

  it('uploads the file and records the task', async () => {
    const { submit } = await startSubmit();
    release();
    const state = await submit;
    expect(state.status).toBe('RUNNING');
    expect(row().sttTaskId).toBe('task-1');
  });

  it('is not submitted again while a slow upload is still in progress', async () => {
    db.state.row.sttStatus = 'SUBMITTING';
    db.state.row.sttStartedAt = new Date(Date.now() - 10 * 60 * 1000);
    const state = await advanceRecordingTranscription(row());
    expect(state.status).toBe('SUBMITTING');
    expect(downloads).toBe(0);
  });

  it('is submitted again once the earlier submit has clearly been abandoned', async () => {
    db.state.row.sttStatus = 'SUBMITTING';
    db.state.row.sttStartedAt = new Date(Date.now() - SUBMIT_STALE_MS - 1000);
    const submit = advanceRecordingTranscription(row());
    await vi.waitFor(() => expect(downloads).toBe(1));
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
