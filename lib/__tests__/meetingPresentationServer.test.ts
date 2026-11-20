import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SummaryDraft } from '@/lib/meetingSummary';

type Row = Record<string, unknown>;

/** In-memory tables behind a stand-in for the Prisma calls the generator and summary writer make. */
const db = vi.hoisted(() => {
  const state = {
    presentation: null as Row | null,
    summary: null as Row | null,
    items: [] as Row[],
    transcripts: [] as Row[],
    meeting: { title: 'Weekly sync', roomName: 'room-1' } as Row | null,
    tableMissing: false,
  };
  const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, want]) => same(row[key], want));
  const presentationTable = () => {
    if (state.tableMissing) throw new Error("The table `MeetingPresentation` does not exist in the current database.");
  };
  const tx = {
    meetingSummaryItem: {
      deleteMany: async () => { state.items = []; },
      createMany: async ({ data }: { data: Row[] }) => { state.items = data.map((item, index) => ({ id: index + 1, ...item })); },
      findMany: async () => [...state.items],
    },
    meetingSummary: {
      upsert: async ({ create, update }: { create: Row; update: Row }) => {
        state.summary = state.summary ? { ...state.summary, ...update } : { ...create };
        return { ...state.summary, updatedAt: new Date() };
      },
      findUnique: async () => (state.summary ? { ...state.summary } : null),
    },
  };
  const prisma = {
    ...tx,
    meeting: { findUnique: async () => state.meeting },
    meetingTranscript: { findMany: async () => state.transcripts.map((row) => ({ ...row })) },
    meetingPresentation: {
      findUnique: async () => { presentationTable(); return state.presentation ? { ...state.presentation } : null; },
      create: async ({ data }: { data: Row }) => {
        presentationTable();
        state.presentation = { content: null, model: null, error: null, ...data };
        return state.presentation;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        presentationTable();
        if (!state.presentation || !matches(state.presentation, where)) return { count: 0 };
        Object.assign(state.presentation, data);
        return { count: 1 };
      },
    },
    $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
  };
  return { state, prisma };
});

const billing = vi.hoisted(() => ({
  quota: null as object | null,
  metered: [] as Array<[number, number]>,
}));

vi.mock('@/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/lib/billing/limits', () => ({ checkAiSummaryQuota: async () => billing.quota }));
vi.mock('@/lib/billing/usage', () => ({
  meterSafely: async (_label: string, task: () => Promise<unknown>) => { await task(); },
  meterAiSummary: async (memberId: number, meetingId: number) => { billing.metered.push([memberId, meetingId]); },
}));

import { PRESENTATION_SYSTEM_PROMPT } from '@/lib/meetingPresentation';
import {
  ensureMeetingPresentation,
  loadPresentation,
  PRESENTATION_STALE_MS,
  schedulePresentation,
} from '@/lib/meetingPresentationServer';

const transcript = [
  [60, 'Ana', 'First, the launch. Marketing needs two more weeks for the campaign.'],
  [95, 'Ben', 'Then we move the launch to March the third, I am fine with that.'],
  [300, 'Chen', 'On pricing, the survey says most teams would pay twelve dollars a seat.'],
  [640, 'Ana', 'Ben, can you send the onboarding plan by Friday?'],
  [650, 'Ben', 'Yes, I will send it by Friday.'],
].map(([offsetSeconds, speakerName, content]) => ({ offsetSeconds, speakerName, content }));

const summaryDraft = {
  topic: 'Launch date and pricing',
  overview: 'The launch moves to March 3. Pricing stays at twelve dollars.',
  sections: [
    { title: 'Launch date', startSec: 60, speaker: 'Ana', points: [{ text: 'Launch moves to March 3', sec: 95 }] },
    { title: 'Pricing', startSec: 300, speaker: 'Chen', points: [{ text: 'Twelve dollars a seat', sec: 300 }] },
  ],
  todos: [{ task: 'Send the onboarding plan', owner: 'Ben', due: 'by Friday', sec: 650 }],
};
const directionDraft = {
  hook: 'The launch moves to March 3.',
  sections: [
    { index: 0, headline: 'Launch moves to March 3', narration: 'Ben agreed to move the launch.', importance: 5, skip: false,
      quote: { text: 'Then we move the launch to March the third, I am fine with that.', sec: 95 } },
    { index: 1, headline: 'Twelve dollars a seat', narration: 'Chen shared the survey.', importance: 3, skip: false, quote: null },
  ],
  decisions: [{ text: 'Launch on March 3', sec: 95 }],
  closing: 'Ben sends the plan by Friday.',
};

/** A scripted model: answers the summary prompt and the direction prompt, counting each. */
function model(options: { summary?: unknown; direction?: unknown | Error } = {}) {
  const calls = { summary: 0, direction: 0 };
  const call = async (system: string): Promise<SummaryDraft> => {
    if (system === PRESENTATION_SYSTEM_PROMPT) {
      calls.direction += 1;
      const direction = 'direction' in options ? options.direction : directionDraft;
      if (direction instanceof Error) throw direction;
      return { raw: direction, model: 'deepseek-chat', fallbackReason: null };
    }
    calls.summary += 1;
    return { raw: 'summary' in options ? options.summary : summaryDraft, model: 'deepseek-chat', fallbackReason: null };
  };
  return { call, calls };
}

beforeEach(() => {
  db.state.presentation = null;
  db.state.summary = null;
  db.state.items = [];
  db.state.transcripts = transcript.map((row) => ({ ...row }));
  db.state.meeting = { title: 'Weekly sync', roomName: 'room-1' };
  db.state.tableMissing = false;
  billing.quota = null;
  billing.metered = [];
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('ensureMeetingPresentation', () => {
  it('writes the summary when the meeting has none, then the presentation, and meters the summary once', async () => {
    const ai = model();
    const state = await ensureMeetingPresentation(3, { memberId: 11 }, ai.call);
    expect(state.status).toBe('READY');
    expect(state.content?.slides.map((slide) => slide.kind)).toEqual(['title', 'topic', 'topic', 'decisions', 'actions', 'closing']);
    expect(state.content?.slides[1]).toMatchObject({ title: 'Launch moves to March 3', quote: { speaker: 'Ben', sec: 95 } });
    expect(ai.calls).toEqual({ summary: 1, direction: 1 });
    // The summary tab is ready too.
    expect(db.state.summary).toMatchObject({ topic: 'Launch date and pricing' });
    expect(db.state.items).toHaveLength(2);
    expect(billing.metered).toEqual([[11, 3]]);
    expect(db.state.presentation).toMatchObject({ status: 'READY', model: 'deepseek-chat', error: null });
  });

  it('reuses a summary that is already stored, and does not charge for one', async () => {
    await ensureMeetingPresentation(3, { memberId: 11 }, model().call);
    billing.metered = [];
    const ai = model();
    const again = await ensureMeetingPresentation(3, { force: true, memberId: 11 }, ai.call);
    expect(again.status).toBe('READY');
    expect(ai.calls).toEqual({ summary: 0, direction: 1 });
    expect(billing.metered).toEqual([]);
  });

  it('does nothing when a presentation is ready, unless asked to make it again', async () => {
    await ensureMeetingPresentation(3, {}, model().call);
    const ai = model();
    expect((await ensureMeetingPresentation(3, {}, ai.call)).status).toBe('READY');
    expect(ai.calls).toEqual({ summary: 0, direction: 0 });
  });

  it('still presents the meeting when the direction call fails', async () => {
    const ai = model({ direction: new Error('timeout') });
    const state = await ensureMeetingPresentation(3, {}, ai.call);
    expect(state.status).toBe('READY');
    expect(state.content?.slides.filter((slide) => slide.kind === 'topic').map((slide) => slide.title)).toEqual(['Launch date', 'Pricing']);
    expect(db.state.presentation?.model).toBe('deepseek-chat+none');
  });

  it('fails cleanly when there is too little transcript, no usable summary, or no allowance left', async () => {
    db.state.transcripts = transcript.slice(0, 2);
    expect((await ensureMeetingPresentation(3, {}, model().call)).status).toBe('FAILED');
    expect(db.state.presentation).toMatchObject({ status: 'FAILED', error: 'not enough transcript' });

    db.state.transcripts = transcript.map((row) => ({ ...row }));
    const empty = model({ summary: { sections: [] } });
    expect((await ensureMeetingPresentation(3, {}, empty.call)).status).toBe('FAILED');
    expect(db.state.presentation?.error).toBe('summary unusable');
    expect(empty.calls.direction).toBe(0);

    billing.quota = { status: 402 };
    const blocked = model();
    expect((await ensureMeetingPresentation(3, { memberId: 11 }, blocked.call)).status).toBe('FAILED');
    expect(blocked.calls).toEqual({ summary: 0, direction: 0 });
    expect(db.state.presentation?.error).toBe('AI summary allowance used up');

    // A later try, with allowance again, succeeds.
    billing.quota = null;
    expect((await ensureMeetingPresentation(3, { memberId: 11 }, model().call)).status).toBe('READY');
  });

  it('runs one generation at a time for a meeting', async () => {
    let release: (draft: SummaryDraft) => void = () => undefined;
    const slow = { calls: 0 };
    const call = async (system: string): Promise<SummaryDraft> => {
      if (system !== PRESENTATION_SYSTEM_PROMPT) return { raw: summaryDraft, model: 'deepseek-chat', fallbackReason: null };
      slow.calls += 1;
      return new Promise((resolve) => { release = resolve; });
    };
    const first = ensureMeetingPresentation(3, {}, call);
    await vi.waitFor(() => expect(slow.calls).toBe(1));
    const second = await ensureMeetingPresentation(3, { force: true }, call);
    expect(second.status).toBe('GENERATING');
    expect(slow.calls).toBe(1);
    release({ raw: directionDraft, model: 'deepseek-chat', fallbackReason: null });
    expect((await first).status).toBe('READY');
  });

  it('takes over a generation that was abandoned, and the abandoned one cannot overwrite it', async () => {
    let releaseOld: (draft: SummaryDraft) => void = () => undefined;
    let directions = 0;
    const call = async (system: string): Promise<SummaryDraft> => {
      if (system !== PRESENTATION_SYSTEM_PROMPT) return { raw: summaryDraft, model: 'deepseek-chat', fallbackReason: null };
      directions += 1;
      if (directions === 1) return new Promise((resolve) => { releaseOld = resolve; });
      return { raw: directionDraft, model: 'newer-model', fallbackReason: null };
    };
    const abandoned = ensureMeetingPresentation(3, {}, call);
    await vi.waitFor(() => expect(directions).toBe(1));
    // The first run started long ago and never finished.
    db.state.presentation!.startedAt = new Date(Date.now() - PRESENTATION_STALE_MS - 1000);
    expect((await loadPresentation(3)).status).toBe('FAILED');

    // The takeover reuses the summary the first run had already stored.
    expect((await ensureMeetingPresentation(3, {}, call)).status).toBe('READY');
    expect(db.state.presentation?.model).toBe('newer-model');

    releaseOld({ raw: { ...directionDraft, hook: 'A stale result.' }, model: 'old-model', fallbackReason: null });
    await abandoned;
    expect(db.state.presentation?.model).toBe('newer-model');
    expect((await loadPresentation(3)).content?.slides[0].narration).toBe('The launch moves to March 3.');
  });
});

describe('loadPresentation', () => {
  it('reports no presentation, without failing, before the table has been created', async () => {
    db.state.tableMissing = true;
    expect(await loadPresentation(3)).toEqual({ status: 'NONE', content: null });
    await expect(ensureMeetingPresentation(3, {}, model().call)).rejects.toThrow(/does not exist/);
  });

  it('treats stored content this version cannot play as failed', async () => {
    db.state.presentation = { meetingId: 3, status: 'READY', content: { version: 0, slides: [] }, startedAt: new Date() };
    expect(await loadPresentation(3)).toEqual({ status: 'FAILED', content: null });
  });
});

describe('schedulePresentation', () => {
  it('runs in the background, and a newer ask replaces one that has not started', async () => {
    vi.useFakeTimers();
    try {
      db.state.transcripts = [];
      schedulePresentation(3, { delayMs: 5000 });
      schedulePresentation(3, { delayMs: 1000 });
      expect(db.state.presentation).toBeNull();
      await vi.advanceTimersByTimeAsync(1100);
      // It ran once (and failed for lack of a transcript, which is all this test needs).
      expect(db.state.presentation).toMatchObject({ status: 'FAILED', error: 'not enough transcript' });
      db.state.presentation = null;
      await vi.advanceTimersByTimeAsync(6000);
      expect(db.state.presentation).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
