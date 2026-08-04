export const LIVE_DOC_AI_CHANNEL = 'kloud-livedoc-ai' as const;
export const LIVE_DOC_AI_VERSION = 1 as const;

export type LiveDocAiTab = 'file' | 'summary' | 'transcript';
export type LiveDocAiPickerKind = 'space' | 'favorite';
export type LiveDocAiSummaryPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface LiveDocAiDocument {
  itemId: number;
  attachmentId: number;
  title: string;
  fileName: string;
  fileImg: string;
  fileType: number;
  isCurrent: boolean;
}

export interface LiveDocAiTranscriptItem {
  id: string | number;
  captionTime: number | string;
  captionContent: string;
  userName: string;
  pageNumber?: number;
  attachmentId?: number;
}

export interface LiveDocAiPickerItem {
  id: number;
  title: string;
  fileName: string;
  date: string;
  fileType: string;
  selected: boolean;
}

export interface LiveDocAiPickerOption {
  id: number;
  name: string;
}

export interface LiveDocAiState {
  ready: boolean;
  activeTab: LiveDocAiTab;
  documents: {
    items: LiveDocAiDocument[];
    currentItemId: number;
    upload: {
      active: boolean;
      percent: number;
      fileName: string;
    };
    annotation: {
      enabled: boolean;
      canToggle: boolean;
    };
  };
  summary: {
    phase: LiveDocAiSummaryPhase;
    templateTitle: string;
    title: string;
    roadmap: Array<{
      title: string;
      time: string;
      summary: string;
      isActive: boolean;
    }>;
    progress: number;
    error: string;
  };
  transcript: {
    items: LiveDocAiTranscriptItem[];
    selfUserName: string;
    loading: boolean;
    error: string;
  };
  picker: {
    kind: LiveDocAiPickerKind | null;
    open: boolean;
    loading: boolean;
    search: string;
    page: number;
    total: number;
    items: LiveDocAiPickerItem[];
    teams: LiveDocAiPickerOption[];
    spaces: LiveDocAiPickerOption[];
    selectedTeamId: number;
    selectedSpaceId: number;
  };
}

interface LiveDocAiEnvelope {
  channel: typeof LIVE_DOC_AI_CHANNEL;
  version: typeof LIVE_DOC_AI_VERSION;
  sessionId: string;
}

export interface LiveDocAiSubscribeMessage extends LiveDocAiEnvelope {
  type: 'Kloud-LiveDocAiSubscribe';
}

export interface LiveDocAiUnsubscribeMessage extends LiveDocAiEnvelope {
  type: 'Kloud-LiveDocAiUnsubscribe';
}

export interface LiveDocAiActionMessage extends LiveDocAiEnvelope {
  type: 'Kloud-LiveDocAiAction';
  requestId: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface LiveDocAiSnapshotMessage extends LiveDocAiEnvelope {
  type: 'Kloud-LiveDocAiSnapshot';
  revision: number;
  state: LiveDocAiState;
}

export interface LiveDocAiActionResultMessage extends LiveDocAiEnvelope {
  type: 'Kloud-LiveDocAiActionResult';
  requestId: string;
  ok: boolean;
  error?: string;
}

export type LiveDocAiInboundMessage = LiveDocAiSnapshotMessage | LiveDocAiActionResultMessage;

export type LiveDocAiOutboundMessage =
  | LiveDocAiSubscribeMessage
  | LiveDocAiUnsubscribeMessage
  | LiveDocAiActionMessage;

export function isLiveDocAiInboundMessage(value: unknown): value is LiveDocAiInboundMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<LiveDocAiInboundMessage>;
  return (
    message.channel === LIVE_DOC_AI_CHANNEL &&
    message.version === LIVE_DOC_AI_VERSION &&
    typeof message.sessionId === 'string' &&
    (message.type === 'Kloud-LiveDocAiSnapshot' || message.type === 'Kloud-LiveDocAiActionResult')
  );
}
