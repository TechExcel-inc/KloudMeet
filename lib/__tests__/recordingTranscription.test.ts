import type { Recording } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import { transcribeStateOf } from '@/lib/aliyunRecordingTranscription';

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
