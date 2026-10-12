/**
 * sttProvider — 选择会议字幕引擎。
 *
 * 每次开启字幕都请求 /api/transcripts/stt-region。
 * 内网地址无法判断时，用系统时区兜底。
 */

export type SttProvider = 'bailian' | 'openai';

const MAINLAND_ZONES = new Set([
  'Asia/Shanghai',
  'Asia/Urumqi',
  'Asia/Chongqing',
  'Asia/Harbin',
]);

function timezoneProvider(): SttProvider {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return MAINLAND_ZONES.has(zone) ? 'bailian' : 'openai';
}

async function fetchRegion(): Promise<SttProvider | 'unknown'> {
  try {
    const res = await fetch('/api/transcripts/stt-region', { cache: 'no-store' });
    if (!res.ok) return 'unknown';
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object' || !('provider' in data)) return 'unknown';
    const provider = data.provider;
    if (provider === 'bailian' || provider === 'openai' || provider === 'unknown') return provider;
  } catch (err) {
    console.warn('[sttProvider] region request failed', err);
  }
  return 'unknown';
}

/** resolveSttProvider — 按当前网络重新选择字幕引擎，不读缓存。 */
export async function resolveSttProvider(): Promise<SttProvider> {
  const hinted = await fetchRegion();
  if (hinted === 'unknown') return timezoneProvider();
  return hinted;
}
