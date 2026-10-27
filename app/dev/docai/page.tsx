'use client';

/**
 * Development-only preview of the Doc AI panel (lib/LiveDocAiPanel.tsx) in each state: no documents,
 * a list, the design link, a read-only attendee, an upload in progress, summary and transcript.
 * Fake data, no LiveDoc bridge. Not served in production.
 *
 * /dev/docai shows every case side by side; /dev/docai?case=<id> shows one.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { LiveDocAiPanel, type LiveDocDesignItem } from '@/lib/LiveDocAiPanel';
import type { LiveDocAiState, LiveDocAiTab } from '@/lib/liveDocAiProtocol';

const W = 560;
const H = 520;

type Case = {
  id: string;
  title: string;
  tab: LiveDocAiTab;
  docs?: number;
  canManage?: boolean;
  design?: boolean;
  uploading?: boolean;
  summary?: 'items' | 'empty' | 'loading';
  connecting?: boolean;
};

const CASES: Case[] = [
  { id: 'empty', title: 'Documents · none yet', tab: 'file', docs: 0 },
  { id: 'docs', title: 'Documents · list', tab: 'file', docs: 6 },
  { id: 'design', title: 'Documents · with a design link', tab: 'file', docs: 2, design: true },
  { id: 'uploading', title: 'Documents · uploading', tab: 'file', docs: 3, uploading: true },
  {
    id: 'viewer',
    title: 'Documents · attendee (read only)',
    tab: 'file',
    docs: 3,
    canManage: false,
  },
  { id: 'summary', title: 'Summary', tab: 'summary', docs: 2, summary: 'items' },
  { id: 'summaryEmpty', title: 'Summary · none yet', tab: 'summary', docs: 2, summary: 'empty' },
  {
    id: 'summaryLoading',
    title: 'Summary · generating',
    tab: 'summary',
    docs: 2,
    summary: 'loading',
  },
  { id: 'transcript', title: 'Transcript', tab: 'transcript', docs: 2 },
  { id: 'connecting', title: 'Connecting', tab: 'file', connecting: true },
];

const DOC_NAMES = [
  ['Q4 product roadmap.pptx', 'Q4 product roadmap'],
  ['Pricing proposal v3.pdf', 'Pricing proposal v3'],
  ['Customer interviews.docx', 'Customer interviews'],
  ['Launch budget.xlsx', 'Launch budget'],
  ['Onboarding flow.png', 'Onboarding flow'],
  ['Whiteboard', 'Whiteboard 1'],
];

const CAPTIONS = [
  ['Ying', 'Let us start with the roadmap. The mini window shipped last night.', 12],
  ['Ying', 'Next up is the Doc AI panel, which still feels crowded.', 18],
  ['Tieren Zhou', 'Agreed. The upload buttons wrap onto three lines on my laptop.', 31],
  ['Xiaoyu Wu', 'I can take the summary prompt once the layout settles.', 47],
  ['Ying', 'Great, I will share the new design in the afternoon.', 63],
] as const;

function makeState(c: Case): LiveDocAiState {
  const count = c.docs ?? 0;
  return {
    ready: true,
    activeTab: c.tab,
    documents: {
      items: DOC_NAMES.slice(0, count).map(([fileName, title], i) => ({
        itemId: i + 1,
        attachmentId: 100 + i,
        title,
        fileName,
        fileImg: '',
        fileType: 0,
        isCurrent: i === 0,
      })),
      currentItemId: count ? 1 : 0,
      upload: { active: Boolean(c.uploading), percent: 45, fileName: 'Board deck.pptx' },
      annotation: { enabled: true, canToggle: true },
    },
    summary: {
      phase: c.summary === 'loading' ? 'loading' : c.summary === 'items' ? 'ready' : 'idle',
      templateTitle: 'Meeting summary',
      title: '',
      roadmap:
        c.summary === 'items'
          ? [
              {
                title: 'Mini window shipped',
                time: '00:00:12',
                summary:
                  'The redesigned mini window went live; tiles fill the window and the share leads.',
                isActive: false,
              },
              {
                title: 'Doc AI panel needs work',
                time: '00:00:18',
                summary: 'The upload actions crowd the footer and wrap on smaller screens.',
                isActive: true,
              },
              {
                title: 'Next steps',
                time: '00:00:47',
                summary:
                  'Xiaoyu takes the summary prompt; Ying shares the new layout in the afternoon.',
                isActive: false,
              },
            ]
          : [],
      progress: 0.42,
      error: '',
    },
    transcript: { items: [], selfUserName: 'Ying', loading: false, error: '' },
    picker: {
      kind: null,
      open: false,
      loading: false,
      search: '',
      page: 1,
      total: 0,
      items: [],
      teams: [],
      spaces: [],
      selectedTeamId: 0,
      selectedSpaceId: 0,
    },
  };
}

const DESIGN: LiveDocDesignItem = {
  label: 'Kloud Meet — mini window',
  kindLabel: 'Figma design',
  kind: 'figma',
  setByName: 'Ying',
  showing: true,
};

/** The transcript tab reads /api/transcripts/<meeting>; answer it with fake captions */
function stubTranscripts() {
  try {
    localStorage.setItem('activeMeetingId', '1');
    localStorage.setItem('activeMeetingStartedAt', new Date(Date.now() - 120_000).toISOString());
  } catch {
    // private mode: the tab shows its empty state
  }
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/transcripts/')) {
      const captions = CAPTIONS.map(([speakerName, content, offsetSeconds], i) => ({
        id: i + 1,
        speakerName,
        content,
        offsetSeconds,
      }));
      return Promise.resolve(new Response(JSON.stringify({ captions }), { status: 200 }));
    }
    return orig(input, init);
  };
}

function OneCase({ c }: { c: Case }) {
  const [state] = React.useState(() => makeState(c));
  return (
    <LiveDocAiPanel
      open
      state={c.connecting ? null : state}
      connected={!c.connecting}
      error=""
      busy={false}
      bubblePos={{ top: 16, left: 16, width: W, height: H, arrowLeft: W / 2 }}
      isLiveDocView
      onClose={() => {}}
      onClearError={() => {}}
      onAction={async () => {}}
      onOpenDocument={() => {}}
      canManage={c.canManage ?? true}
      requestedTab={{ tab: c.tab, nonce: 1 }}
      designItem={c.design ? DESIGN : null}
      onShowDesign={c.design ? () => {} : undefined}
      onAddDesignLink={() => {}}
    />
  );
}

export default function DevDocAiPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [caseId, setCaseId] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    stubTranscripts();
    setCaseId(new URLSearchParams(window.location.search).get('case'));
  }, []);
  if (caseId === undefined) return null;
  const one = caseId ? CASES.find((c) => c.id === caseId) : null;
  if (one) {
    return (
      <div style={{ minHeight: '100vh', background: '#16171b' }}>
        <OneCase c={one} />
      </div>
    );
  }
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#2b2c31',
        padding: 24,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 24,
      }}
    >
      {CASES.map((c) => (
        <figure key={c.id} style={{ margin: 0 }}>
          <figcaption style={{ color: '#aab', font: '600 12px system-ui', margin: '0 0 6px' }}>
            {c.title}
          </figcaption>
          <iframe
            title={c.title}
            src={`/dev/docai?case=${c.id}`}
            style={{ width: W + 32, height: H + 40, border: 0, borderRadius: 12, display: 'block' }}
          />
        </figure>
      ))}
    </div>
  );
}
