import type { RecordingWriting } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH } from '@/app/api/recordings/[id]/writing/route';
import { writingRevision, writingState } from '@/lib/replayWriting.server';
import { buildReplayWriting } from '@/lib/replayWriting';

const { rows, prepare } = vi.hoisted(() => ({
  rows: new Map<string, RecordingWriting>(),
  prepare: vi.fn(),
}));

vi.mock('next/server', async importOriginal => ({
  ...await importOriginal<typeof import('next/server')>(),
  after: (task: () => void) => task(),
}));
vi.mock('@/lib/replaySpokenNames.server', () => ({ loadReplaySpokenNames: async () => (text: string) => text }));
vi.mock('@/lib/smartPlayNarration.server', () => ({ prepareSmartPlayVoice: prepare }));
vi.mock('@/lib/recordingShare', () => ({
  loadManagedRecording: async () => ({ recording: { id: 1, status: 'READY' } }),
  isRecordingResponse: () => false,
}));
vi.mock('@/lib/db', () => {
  const recordingWriting = {
    findUnique: async ({ where }: { where: { recordingId_id: { id: string } } }) => rows.get(where.recordingId_id.id) ?? null,
    findMany: async () => [...rows.values()],
    create: async ({ data }: { data: RecordingWriting }) => rows.set(data.id, data),
    update: async ({ where, data }: { where: { recordingId_id: { id: string } }; data: Partial<RecordingWriting> }) => {
      const id = where.recordingId_id.id;
      rows.set(id, { ...rows.get(id)!, ...data });
    },
  };
  return { prisma: { recordingWriting, $transaction: (run: (tx: { recordingWriting: typeof recordingWriting }) => unknown) =>
    run({ recordingWriting }) } };
});

const originalId = 'legacy-5';
const repairId = '11111111-1111-4111-8111-111111111111';
const lines = [
  { id: 1, speakerName: 'tierenz', speakerKey: 'member:1', verifiedAttendee: true, offsetSeconds: 10, content: '可能需要关机。' },
  { id: 2, speakerName: 'guifu', speakerKey: 'member:2', verifiedAttendee: true, offsetSeconds: 12, content: '关机没问题。' },
];

function apply() {
  const request = new Request('https://example.test/recording', {
    method: 'PATCH', body: JSON.stringify({ id: repairId, applyRepair: true }),
  });
  return PATCH(request as Parameters<typeof PATCH>[0], { params: Promise.resolve({ id: 'recording' }) });
}

describe('Apply speaker repair to the original AI Write', () => {
  beforeEach(() => {
    rows.clear();
    prepare.mockClear();
    const original = buildReplayWriting({ sections: [{ title: '会后与贵妇确认关机事项', text: 'tierenz 让贵妇稍等。' }] }, lines, 'Standup')!;
    const repaired = buildReplayWriting({ sections: [
      { title: '关机安排', text: '[[speaker:member:1]] 说明可能需要关机。', speakerKey: 'member:1', sourceLineIds: [1] },
      { title: '确认回复', text: '[[speaker:member:2]] 表示关机没问题。', speakerKey: 'member:2', sourceLineIds: [2] },
    ] }, lines, 'Repaired')!;
    const row: RecordingWriting = {
      id: originalId, recordingId: 1, name: 'Standup', description: null, minutes: 5, voice: 'marin',
      status: 'READY', startedAt: new Date(), content: JSON.parse(JSON.stringify(original)),
    };
    rows.set(originalId, row);
    rows.set(repairId, {
      ...row, id: repairId, name: 'Repaired', voice: 'cedar',
      content: JSON.parse(JSON.stringify({ ...repaired, sourceId: originalId, sourceRevision: writingRevision(writingState(row)!) })),
    });
  });

  it('updates the existing ID and backs up the original with its voice', async () => {
    const response = await apply();
    expect(response.status).toBe(200);
    expect((await response.json()).selectedId).toBe(originalId);
    const applied = writingState(rows.get(originalId)!)!;
    expect(applied.presentation?.slides.map(slide => slide.title)).toEqual(['tierenz：关机安排', 'guifu：确认回复']);
    expect(applied.voice).toBe('marin');
    const backup = [...rows.values()].find(row => row.id !== originalId && row.id !== repairId)!;
    expect(writingState(backup)?.presentation?.slides[0].title).toContain('贵妇');
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Standup' }), 'marin', expect.any(Function)));
    expect((await apply()).status).toBe(409);
    expect(rows.size).toBe(3);
  });

  it('leaves a newer original alone', async () => {
    rows.get(originalId)!.name = 'Updated original';
    expect((await apply()).status).toBe(409);
    expect(rows.size).toBe(2);
    expect(prepare).not.toHaveBeenCalled();
  });
});
