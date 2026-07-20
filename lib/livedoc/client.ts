export const LIVEDOC_ANONYMOUS_GUID_KEY = 'KloudAnonymousSyncroomID';
const TOKEN_CACHE_PREFIX = 'KloudMeet_instant_token_';
const DEFAULT_LIVEDOC_BASE_URL = 'https://kloud.cn';
const DEFAULT_LIVEDOC_DEBUG_URL = 'http://localhost:8081';

export type LiveDocRuntimeSettings = {
  debugEnabled: boolean;
  debugUrl?: string | null;
};

/** SkyMeet → LiveDoc iframe 身份（与 Dev MainStage `onRoleChanged` / URL `role` 对齐） */
export type LiveDocEmbedRole = 'host' | 'colhost' | 'presenter' | 'participant';

export function resolveLiveDocEmbedRole({
  isHost,
  isCohost,
  isPresenter,
}: {
  isHost: boolean;
  isCohost: boolean;
  isPresenter: boolean;
}): LiveDocEmbedRole {
  if (isHost) return 'host';
  if (isCohost) return 'colhost';
  if (isPresenter) return 'presenter';
  return 'participant';
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreateKloudAnonymousSyncroomID(): string {
  if (typeof window === 'undefined') {
    return generateUUID();
  }
  let guid = localStorage.getItem(LIVEDOC_ANONYMOUS_GUID_KEY);
  if (!guid) {
    guid = generateUUID();
    localStorage.setItem(LIVEDOC_ANONYMOUS_GUID_KEY, guid);
  }
  return guid;
}

function getConfiguredLiveDocBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_LIVEDOC_BASE_URL ?? DEFAULT_LIVEDOC_BASE_URL).replace(/\/$/, '');
}

function normalizeHttpUrl(input: string): string | null {
  const candidate = input.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Effective LiveDoc iframe origin: debug URL from system settings or env default. */
export function resolveLiveDocBaseUrl(settings?: LiveDocRuntimeSettings | null): string {
  if (process.env.NODE_ENV === 'production') {
    return getConfiguredLiveDocBaseUrl();
  }
  if (settings?.debugEnabled) {
    return (
      normalizeHttpUrl(settings.debugUrl ?? '') ??
      DEFAULT_LIVEDOC_DEBUG_URL
    ).replace(/\/$/, '');
  }
  return getConfiguredLiveDocBaseUrl();
}

export function buildLiveDocIframeSrc(
  livedocInstanceId: string,
  userToken: string,
  languageId: 0 | 1,
  settings?: LiveDocRuntimeSettings | null,
): string {
  const base = resolveLiveDocBaseUrl(settings);
  const id = encodeURIComponent(livedocInstanceId);
  const token = encodeURIComponent(userToken);
  // 注意：不要把 role 写进 URL。身份变更应走 postMessage(onRoleChanged)，避免 iframe 重载闪动。
  return `${base}/GoogleMeet/MainStage/${id}/0?token=${token}&usetoken=1&fromjitsi=1&languageid=${languageId}`;
}

/** MeetingServer `create_meeting_instance` 成功响应：`data` 为数字型 livedoc 实例 ID */
type CreateMeetingInstanceResponse = {
  code: number;
  msg: string;
  data: number;
};

/**
 * Anonymous PeerTime account — calls same-origin API route to avoid third-party CORS.
 */
export async function createOrUpdateInstantAccount(userName: string): Promise<string> {
  if (typeof window === 'undefined') {
    throw new Error('createOrUpdateInstantAccount is client-only');
  }
  const guid = getOrCreateKloudAnonymousSyncroomID();
  const cacheKey = `${TOKEN_CACHE_PREFIX}${guid}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await fetch('/api/livedoc/instant-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Guid: guid, UserName: userName }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`instant-account: ${response.status} ${text}`);
  }

  const result = (await response.json()) as {
    RetData?: { Account?: { UserToken?: string } };
  };
  const token = result?.RetData?.Account?.UserToken;
  if (typeof token !== 'string' || !token) {
    throw new Error('instant-account: missing UserToken in response');
  }
  localStorage.setItem(cacheKey, token);
  return token;
}

/**
 * Personal rooms reuse the same roomName across sessions; suffix meetingId so each
 * session gets its own LiveDoc instance while staying stable within one session.
 */
export function resolveJitsiInstanceId({
  roomName,
  meetingId,
  isPersonalRoom,
}: {
  roomName: string;
  meetingId: number;
  isPersonalRoom: boolean;
}): string {
  if (isPersonalRoom) {
    return `${roomName}_${meetingId}`;
  }
  return roomName;
}

export async function createLivedocInstance({
  userToken,
  jitsiInstanceId,
}: {
  userToken: string;
  jitsiInstanceId: string;
}): Promise<string> {
  const response = await fetch('/api/livedoc/create-meeting-instance', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      UserToken: userToken,
    },
    body: JSON.stringify({
      jitsiInstanceId,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`create_meeting_instance: ${response.status} ${text}`);
  }

  const result = (await response.json()) as CreateMeetingInstanceResponse;
  if (result.code !== 0 || typeof result.data !== 'number' || !Number.isFinite(result.data)) {
    throw new Error(
      `create_meeting_instance: ${result.msg ?? 'error'} (code=${String(result.code)})`,
    );
  }
  return String(result.data);
}

export async function keepLivedocInstanceActive({
  userToken,
  jitsiInstanceId,
  livedocInstanceId,
}: {
  userToken: string;
  jitsiInstanceId: string;
  livedocInstanceId?: string | null;
}): Promise<string> {
  const response = await fetch('/api/livedoc/keepalive', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      UserToken: userToken,
    },
    body: JSON.stringify({
      jitsiInstanceId,
      livedocMeetingId: livedocInstanceId ?? null,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`livedoc_keepalive: ${response.status} ${text}`);
  }

  const result = (await response.json()) as CreateMeetingInstanceResponse;
  if (result.code !== 0 || typeof result.data !== 'number' || !Number.isFinite(result.data)) {
    throw new Error(
      `livedoc_keepalive: ${result.msg ?? 'error'} (code=${String(result.code)})`,
    );
  }
  return String(result.data);
}
