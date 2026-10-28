'use client';

/**
 * Development-only preview of the Doc AI panel (lib/LiveDocAiPanel.tsx) in each state: no documents,
 * a list, the design link, a read-only attendee, an upload in progress, several files queued, files
 * not added, summary and transcript. Fake data, no LiveDoc bridge. Not served in production.
 *
 * /dev/docai shows every case side by side; /dev/docai?case=<id> shows one.
 * ?case=live runs the real upload queue against a fake LiveDoc: names with "big" are too large,
 * "bad" fail to convert, "lost" lose the connection, anything else is added after ~1.5 s.
 */

import React from 'react';
import { notFound } from 'next/navigation';
import { LiveDocAiPanel, type LiveDocDesignItem } from '@/lib/LiveDocAiPanel';
import {
  LIVE_DOC_AI_CHANNEL,
  LIVE_DOC_AI_VERSION,
  type LiveDocAiState,
  type LiveDocAiTab,
  type LiveDocAiUploadFailReason,
  type LiveDocAiUploadResultMessage,
} from '@/lib/liveDocAiProtocol';
import { useLiveDocUploadQueue, type LiveDocUploadQueue } from '@/lib/useLiveDocUploadQueue';

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
  /** Several files picked: the second of five is uploading */
  queue?: boolean;
  /** Files that LiveDoc did not add */
  failures?: boolean;
  /** The real upload queue against a fake LiveDoc */
  live?: boolean;
  /** "From Space" picker open */
  picker?: boolean;
  summary?: 'items' | 'empty' | 'loading';
  connecting?: boolean;
};

const CASES: Case[] = [
  { id: 'empty', title: 'Documents · none yet', tab: 'file', docs: 0 },
  { id: 'docs', title: 'Documents · list', tab: 'file', docs: 6 },
  { id: 'picker', title: 'Documents · pick from Space', tab: 'file', docs: 2, picker: true },
  { id: 'design', title: 'Documents · with a design link', tab: 'file', docs: 2, design: true },
  { id: 'uploading', title: 'Documents · uploading', tab: 'file', docs: 3, uploading: true },
  {
    id: 'queue',
    title: 'Documents · uploading 2 of 5',
    tab: 'file',
    docs: 3,
    uploading: true,
    queue: true,
  },
  { id: 'failures', title: 'Documents · 3 files not added', tab: 'file', docs: 4, failures: true },
  {
    id: 'failuresEmpty',
    title: 'Documents · none added yet, 1 failed',
    tab: 'file',
    docs: 0,
    failures: true,
  },
  { id: 'live', title: 'Documents · real queue, fake LiveDoc', tab: 'file', docs: 2, live: true },
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

/** [fileName, title, LiveDoc's older icon path] — the last two have no extension in their names */
const PICKER_FILES = [
  ['交通管理业务介绍 1.pdf', '交通管理业务介绍 1.pdf', ''],
  ['平台功能架构.docx', '平台功能架构.docx', ''],
  ['Factory tour.mp4', 'Factory tour.mp4', ''],
  ['Sales pipeline.xlsx', 'Sales pipeline.xlsx', ''],
  ['', 'Brand guide', '../../../static/assets/images/ppt.svg'],
  ['', 'Contract scan', '../../../static/assets/images/no.svg'],
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
      kind: c.picker ? 'space' : null,
      open: Boolean(c.picker),
      loading: false,
      search: '',
      page: 1,
      total: c.picker ? PICKER_FILES.length : 0,
      items: c.picker
        ? PICKER_FILES.map(([fileName, title, fileType], i) => ({
            id: 200 + i,
            title,
            fileName,
            date: '2026-10-2' + (i % 9),
            fileType,
            selected: i === 1,
          }))
        : [],
      teams: c.picker ? [{ id: 1, name: 'Marketing Team Cn' }] : [],
      spaces: c.picker ? [{ id: 11, name: '2025 数字人-studio' }] : [],
      selectedTeamId: c.picker ? 1 : 0,
      selectedSpaceId: c.picker ? 11 : 0,
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

const NO_UPLOADS: LiveDocUploadQueue = {
  active: false,
  position: 0,
  total: 0,
  currentName: '',
  failures: [],
  enqueue: () => {},
  retry: () => {},
  dismissFailures: () => {},
};

function staticUploads(c: Case): LiveDocUploadQueue {
  if (c.queue) {
    return { ...NO_UPLOADS, active: true, position: 2, total: 5, currentName: 'Board deck.pptx' };
  }
  if (c.failures) {
    const failures = [
      { id: 'f1', name: 'Factory walkthrough 4K.mov', reason: 'tooLarge' as const, retryable: false },
      { id: 'f2', name: 'Supplier contract (scanned).pdf', reason: 'convert' as const, retryable: true },
      { id: 'f3', name: 'Q3 numbers.xlsx', reason: 'network' as const, retryable: true },
    ];
    return { ...NO_UPLOADS, failures: c.docs ? failures : failures.slice(1, 2) };
  }
  return NO_UPLOADS;
}

/** Stands in for the meeting's LiveDoc: one upload at a time, then its result */
function useFakeLiveDoc(initial: LiveDocAiState) {
  const [state, setState] = React.useState(initial);
  const listeners = React.useRef(new Set<(result: LiveDocAiUploadResultMessage) => void>());
  const nextItemId = React.useRef(100);

  const sendAction = React.useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      if (action !== 'document.uploadLocal') return;
      const fileName = String(payload.fileName || '');
      const uploadId = String(payload.uploadId || '');
      const emit = (status: 'added' | 'failed', itemId: number, reason: LiveDocAiUploadFailReason | '') =>
        listeners.current.forEach((listener) =>
          listener({
            type: 'Kloud-LiveDocAiUploadResult',
            channel: LIVE_DOC_AI_CHANNEL,
            version: LIVE_DOC_AI_VERSION,
            sessionId: 'dev',
            uploadId,
            fileName,
            status,
            itemId,
            reason,
          }),
        );
      if (/big/i.test(fileName)) {
        window.setTimeout(() => emit('failed', 0, 'tooLarge'), 100);
        return;
      }
      const setUpload = (active: boolean, percent: number) =>
        setState((current) => ({
          ...current,
          documents: { ...current.documents, upload: { ...current.documents.upload, active, percent, fileName } },
        }));
      setUpload(true, 0);
      [20, 45, 70, 90].forEach((percent, i) => window.setTimeout(() => setUpload(true, percent), 300 * (i + 1)));
      window.setTimeout(() => {
        const reason: LiveDocAiUploadFailReason | '' = /bad/i.test(fileName)
          ? 'convert'
          : /lost/i.test(fileName)
            ? 'network'
            : '';
        const itemId = reason ? 0 : (nextItemId.current += 1);
        setState((current) => ({
          ...current,
          documents: {
            ...current.documents,
            upload: { ...current.documents.upload, active: false, percent: 0, fileName: '' },
            items: reason
              ? current.documents.items
              : [
                  ...current.documents.items,
                  {
                    itemId,
                    attachmentId: itemId,
                    title: fileName.replace(/\.[^.]+$/, ''),
                    fileName,
                    fileImg: '',
                    fileType: 0,
                    isCurrent: false,
                  },
                ],
          },
        }));
        emit(reason ? 'failed' : 'added', itemId, reason);
      }, 1500);
    },
    [],
  );
  const onUploadResult = React.useCallback(
    (listener: (result: LiveDocAiUploadResultMessage) => void) => {
      listeners.current.add(listener);
      return () => {
        listeners.current.delete(listener);
      };
    },
    [],
  );
  return { state, connected: true, sendAction, onUploadResult };
}

function LiveCase({ c }: { c: Case }) {
  const [initial] = React.useState(() => {
    const state = makeState(c);
    return {
      ...state,
      documents: { ...state.documents, upload: { ...state.documents.upload, reportsResults: true } },
    };
  });
  const liveDoc = useFakeLiveDoc(initial);
  const uploads = useLiveDocUploadQueue(liveDoc);
  // For scripted checks: window.__docaiUploads.enqueue([new File(['x'], 'a.pdf')])
  React.useEffect(() => {
    (window as unknown as { __docaiUploads: LiveDocUploadQueue }).__docaiUploads = uploads;
  }, [uploads]);
  return <PanelCase c={c} state={liveDoc.state} uploads={uploads} onAction={liveDoc.sendAction} />;
}

function OneCase({ c }: { c: Case }) {
  const [state] = React.useState(() => makeState(c));
  if (c.live) return <LiveCase c={c} />;
  return <PanelCase c={c} state={state} uploads={staticUploads(c)} onAction={async () => {}} />;
}

function PanelCase({
  c,
  state,
  uploads,
  onAction,
}: {
  c: Case;
  state: LiveDocAiState;
  uploads: LiveDocUploadQueue;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
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
      onAction={onAction}
      uploads={uploads}
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
