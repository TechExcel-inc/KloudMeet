export const LIVEDOC_ANONYMOUS_GUID_KEY = 'KloudAnonymousSyncroomID';
const TOKEN_CACHE_PREFIX = 'KloudMeet_instant_token_';

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

function getLiveDocBaseUrl(): string {
  // return 'https://localhost:8082/'.replace(/\/$/, '');//本地调试模式
  return (process.env.NEXT_PUBLIC_LIVEDOC_BASE_URL ?? 'https://kloud.cn').replace(/\/$/, '');
}

export function buildLiveDocIframeSrc(
  livedocInstanceId: string,
  userToken: string,
  languageId: 0 | 1,
): string {
  const base = getLiveDocBaseUrl();
  const id = encodeURIComponent(livedocInstanceId);
  const token = encodeURIComponent(userToken);
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
