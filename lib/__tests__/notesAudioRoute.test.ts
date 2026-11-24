import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/recordings/[id]/notes-audio/route';
import { PRESENTATION_VERSION } from '@/lib/meetingPresentation';

const { state, tasks, prepare, transcript, generate } = vi.hoisted(() => ({
  state: { row: null as Record<string, unknown> | null, mode: 'ai_notes' },
  tasks: [] as Array<() => Promise<void>>,
  prepare: vi.fn(async () => true),
  transcript: vi.fn(async () => [] as unknown[]),
  generate: vi.fn(),
}));

vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => tasks.push(task),
}));
vi.mock('@/lib/billing/limits', () => ({ checkAiSummaryQuota: async () => null }));
vi.mock('@/lib/recordingShare', () => {
  const recording = () => ({ id: 14, meetingId: 12, status: 'READY', storageProvider: 'S3', mode: state.mode });
  return {
    findRecordingByKey: async () => recording(),
    authorizeRecordingView: async () => ({ memberId: null }),
    loadManagedRecording: async () => ({ memberId: 2, recording: recording() }),
    isRecordingResponse: () => false,
  };
});
vi.mock('@/lib/db', () => ({ prisma: { recordingWriting: {
  findUnique: async () => state.row && { ...state.row },
  create: async ({ data }: { data: Record<string, unknown> }) => { state.row = { ...data }; },
  updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (!state.row || !Object.entries(where).every(([key, value]) => state.row?.[key] === value)) return { count: 0 };
    Object.assign(state.row, data);
    return { count: 1 };
  },
} } }));
vi.mock('@/lib/replayWriting.server', async (original) => ({
  ...(await original<typeof import('@/lib/replayWriting.server')>()),
  loadWritingTranscript: transcript,
  generateReplayWriting: generate,
}));
vi.mock('@/lib/smartPlayNarration.server', () => ({ prepareSmartPlayVoice: prepare }));

const endpoint = 'https://meet.example/api/recordings/rec/notes-audio';
const params = { params: Promise.resolve({ id: 'rec' }) };
const script = {
  version: PRESENTATION_VERSION, language: 'en',
  slides: [{ kind: 'topic', title: 'Decision', narration: 'The team agreed to test the replay.', bullets: [], seconds: 7 }],
};

const post = (voice: string, language?: string) => POST(new NextRequest(endpoint, {
  method: 'POST', body: JSON.stringify({ voice, language }), headers: { 'Content-Type': 'application/json' },
}), params);

const get = async () => (await GET(new NextRequest(endpoint), params)).json();

beforeEach(() => {
  state.mode = 'ai_notes';
  state.row = null;
  tasks.length = 0;
  prepare.mockReset().mockResolvedValue(true);
  transcript.mockReset().mockResolvedValue([]);
  generate.mockClear();
});

it('requires a transcript before starting a new AI speech', async () => {
  expect((await post('marin')).status).toBe(409);
  expect(tasks).toHaveLength(0);
  expect(await get()).toEqual({ notesAudio: null });
  transcript.mockResolvedValue([{ content: 'The team agreed to test the replay.' }]);
  expect((await post('marin')).status).toBe(202);
  expect(await get()).toMatchObject({ notesAudio: { status: 'GENERATING', voice: 'marin', language: 'auto', presentation: null } });
  await tasks[0]();
  expect(generate).toHaveBeenCalledTimes(1);
});

it('rewrites the saved script before preparing audio when the language changes', async () => {
  state.row = { recordingId: 14, id: 'notes-audio', status: 'READY', voice: 'marin', content: script, startedAt: new Date(0) };
  transcript.mockResolvedValue([{ content: 'The team agreed to test the replay.' }]);
  expect((await post('marin', 'fr')).status).toBe(400);
  expect((await post('marin', 'ja')).status).toBe(202);
  await tasks[0]();
  expect(generate).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.any(Date), 2,
    expect.any(Array), expect.objectContaining({ language: 'ja', edit: expect.objectContaining({ presentation: script }) }));
  expect(prepare).not.toHaveBeenCalled();
});

it('keeps a new voice pending for viewers until all clips are stored and ignores duplicate starts', async () => {
  state.row = { recordingId: 14, id: 'notes-audio', status: 'READY', voice: 'marin', content: script, startedAt: new Date(0) };
  expect((await post('cedar')).status).toBe(202);
  expect((await post('alloy')).status).toBe(200);
  expect(tasks).toHaveLength(1);
  expect(await get()).toMatchObject({ notesAudio: { status: 'GENERATING', voice: 'cedar', presentation: null } });
  await tasks[0]();
  expect(prepare).toHaveBeenCalledWith(14, script, 'cedar');
  expect(await get()).toMatchObject({ notesAudio: { status: 'READY', voice: 'cedar', presentation: script } });
});

it('keeps the script for retry when audio generation fails', async () => {
  state.row = { recordingId: 14, id: 'notes-audio', status: 'READY', voice: 'marin', content: script, startedAt: new Date(0) };
  prepare.mockResolvedValueOnce(false);
  expect((await post('cedar')).status).toBe(202);
  await tasks[0]();
  expect(await get()).toMatchObject({ notesAudio: { status: 'FAILED', presentation: null } });
  expect(state.row.content).toEqual(script);
});
