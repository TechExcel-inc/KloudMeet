export type SttStatus = 'SUBMITTING' | 'QUEUED' | 'RUNNING' | 'ALIGNING' | 'SUCCEEDED' | 'FAILED';

export interface TranscribeState {
  status: SttStatus | null;
  /** 0–100。排队不显示；识别中按录像时长估算，速度为原先的一半 */
  progress: number;
  error: string | null;
}

export const IDLE_TRANSCRIBE: TranscribeState = { status: null, progress: 0, error: null };

const STATUSES: readonly SttStatus[] = ['SUBMITTING', 'QUEUED', 'RUNNING', 'ALIGNING', 'SUCCEEDED', 'FAILED'];

export function toSttStatus(value: unknown): SttStatus | null {
  return STATUSES.find((status) => status === value) ?? null;
}

/** 任务仍在进行，需要继续轮询 */
export function isSttActive(status: SttStatus | null): boolean {
  return status === 'SUBMITTING' || status === 'QUEUED' || status === 'RUNNING' || status === 'ALIGNING';
}

export function readTranscribeState(value: unknown): TranscribeState | null {
  if (typeof value !== 'object' || value === null) return null;
  const progress = Reflect.get(value, 'progress');
  const error = Reflect.get(value, 'error');
  return {
    status: toSttStatus(Reflect.get(value, 'status')),
    progress: typeof progress === 'number' && Number.isFinite(progress) ? progress : 0,
    error: typeof error === 'string' ? error : null,
  };
}
