export const SPEAK_TOKEN_PARAM = 'recToken';

export const SPEAK_ACTIVITY_PATH = '/api/recordings/speak-activity';

export const SPEAK_BATCH_MAX = 500;

/** LiveKit egress 时间戳为纳秒；0 表示尚未开始 */
export function egressTimeToDate(ns: bigint): Date | null {
  return ns > 0n ? new Date(Number(ns / 1_000_000n)) : null;
}

export interface SpeakInterval {
  identity: string;
  name: string;
  /** 采集端 Date.now()，与 egress 同机同钟 */
  startMs: number;
  endMs: number;
  avgLevel: number;
  peakLevel: number;
}

export interface SpeakBatch {
  token: string;
  intervals: SpeakInterval[];
}

function readInterval(value: unknown): SpeakInterval | null {
  if (typeof value !== 'object' || value === null) return null;
  const identity = Reflect.get(value, 'identity');
  const name = Reflect.get(value, 'name');
  const startMs = Reflect.get(value, 'startMs');
  const endMs = Reflect.get(value, 'endMs');
  const avgLevel = Reflect.get(value, 'avgLevel');
  const peakLevel = Reflect.get(value, 'peakLevel');
  if (typeof identity !== 'string' || !identity) return null;
  if (typeof name !== 'string') return null;
  if (typeof startMs !== 'number' || typeof endMs !== 'number') return null;
  if (typeof avgLevel !== 'number' || typeof peakLevel !== 'number') return null;
  if (![startMs, endMs, avgLevel, peakLevel].every(Number.isFinite)) return null;
  if (endMs < startMs) return null;
  return { identity, name, startMs, endMs, avgLevel, peakLevel };
}

export function readSpeakBatch(value: unknown): SpeakBatch | null {
  if (typeof value !== 'object' || value === null) return null;
  const token = Reflect.get(value, 'token');
  const intervals = Reflect.get(value, 'intervals');
  if (typeof token !== 'string' || !token) return null;
  if (!Array.isArray(intervals) || intervals.length > SPEAK_BATCH_MAX) return null;
  const parsed = intervals.map(readInterval);
  if (parsed.some((item) => item === null)) return null;
  return {
    token,
    intervals: parsed.filter((item): item is SpeakInterval => item !== null),
  };
}
