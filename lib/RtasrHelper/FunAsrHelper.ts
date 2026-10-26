/**
 * FunAsrHelper — 阿里云百炼 Fun-ASR Realtime
 *
 * 浏览器通过一条长连接把 16kHz PCM16 推到 SkyMeet 中继，
 * 中继再通过另一条长连接转发给百炼，长期密钥不进入浏览器。
 */

import type { CaptionEngine, RtasrMessage } from './RtasrHelper';
import { CaptionEngineError, httpFailure, micFailure, toCaptionError } from './captionErrors';
import { defaultMicSource, type CaptionMicSource } from './captionMic';

const TARGET_SAMPLE_RATE = 16000;
/** ~30 s of 16 kHz PCM16 the relay has not taken: the connection is stuck though not closed. */
const MAX_BUFFERED_BYTES = 1_000_000;

interface FunLine {
  type?: string;
  id?: number;
  text?: string;
  message?: string;
}

function isFunLine(value: unknown): value is FunLine {
  return typeof value === 'object' && value !== null;
}

function relayUrl(token: string): string {
  const configured = process.env.NEXT_PUBLIC_FUNASR_WS_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    url.searchParams.set('token', token);
    return url.toString();
  }

  const local = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = local
    ? `${window.location.hostname}:${process.env.NEXT_PUBLIC_FUNASR_WS_PORT || '3202'}`
    : window.location.host;
  return `${protocol}//${host}/ws/funasr?token=${encodeURIComponent(token)}`;
}

export class FunAsrHelper implements CaptionEngine {
  public OnMessage?: (msg: RtasrMessage) => void;
  public OnDropped?: (err: CaptionEngineError) => void;
  public micSource?: CaptionMicSource;
  public languageCode = 'zh';
  public roomName?: string;

  private _running = false;
  private _gen = 0;
  private _socket: WebSocket | null = null;
  private _context: AudioContext | null = null;
  private _stream: MediaStream | null = null;
  private _processor: ScriptProcessorNode | null = null;
  private _source: MediaStreamAudioSourceNode | null = null;

  /** @param getToken 每次取最新的 LiveKit 参会 token（会中会续期） */
  constructor(private readonly getToken: () => string) {}

  async Start() {
    if (this._running) return;
    const gen = ++this._gen;
    this._running = true;

    try {
      const lang = (this.languageCode || '').trim().toLowerCase();
      const tokenUrl = this.roomName
        ? `/api/transcripts/funasr-token?roomName=${encodeURIComponent(this.roomName)}`
        : '/api/transcripts/funasr-token';
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.getToken()}` },
      });
      if (gen !== this._gen) return;
      if (!res.ok) throw new CaptionEngineError(httpFailure(res.status), `Fun-ASR token failed: ${res.status}`);
      const data: unknown = await res.json();
      const token = data && typeof data === 'object' && 'token' in data && typeof data.token === 'string'
        ? data.token
        : '';
      if (!token) throw new CaptionEngineError('unavailable', 'Fun-ASR token is empty');

      this._socket = new WebSocket(relayUrl(token));
      await new Promise<void>((resolve, reject) => {
        if (!this._socket) {
          reject(new Error('Fun-ASR socket was not created'));
          return;
        }
        let settled = false;
        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        };
        const timer = setTimeout(() => finish(new Error('Fun-ASR relay timed out')), 12000);
        this._socket.onopen = () => {
          this._socket?.send(JSON.stringify({ type: 'start', lang }));
        };
        this._socket.onmessage = (event) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(String(event.data));
          } catch (err) {
            console.warn('[FunAsr] bad event', err);
            return;
          }
          if (!isFunLine(parsed)) return;
          if (parsed.type === 'ready') {
            finish();
            return;
          }
          if (parsed.type === 'error') {
            finish(new Error(parsed.message || 'Fun-ASR relay failed'));
            return;
          }
          this._takeEvent(parsed);
        };
        this._socket.onerror = () => {
          finish(new Error('Fun-ASR relay connection failed'));
        };
        this._socket.onclose = () => {
          finish(new Error('Fun-ASR relay closed before ready'));
        };
      });
      if (gen !== this._gen) return;

      // Ready: from now on a close or error is a drop mid-meeting.
      this._socket.onerror = null;
      this._socket.onclose = (event) => {
        if (gen === this._gen) this._drop(`relay closed (${event.code})`);
      };

      try {
        // The meeting's own microphone (captionMic.ts).
        this._stream = await (this.micSource ?? defaultMicSource)();
      } catch (err) {
        throw new CaptionEngineError(micFailure(err), err instanceof Error ? err.message : 'microphone failed');
      }
      if (gen !== this._gen) {
        this._stopMic();
        return;
      }
      try {
        this._context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      } catch (err) {
        console.warn('[FunAsr] AudioContext sample rate fallback', err);
        this._context = new AudioContext();
      }
      if (gen !== this._gen) {
        this._stopMic();
        return;
      }
      this._startProcessor(this._context.sampleRate);
    } catch (err) {
      if (gen !== this._gen) return;
      this.Stop();
      throw toCaptionError(err);
    }
  }

  Stop() {
    this._gen += 1;
    this._running = false;
    if (this._socket) {
      if (this._socket.readyState === WebSocket.OPEN) {
        this._socket.send(JSON.stringify({ type: 'finish' }));
      }
      this._socket.close();
      this._socket = null;
    }
    this._stopMic();
  }

  /** The relay went away after it was ready: release the mic and tell the supervisor. */
  private _drop(reason: string) {
    this.Stop();
    this.OnDropped?.(new CaptionEngineError('network', `Fun-ASR ${reason}`));
  }

  private _takeEvent(parsed: FunLine) {
    if (parsed.type === 'error') {
      console.warn('[FunAsr]', typeof parsed.message === 'string' ? parsed.message : 'error');
      return;
    }
    if (typeof parsed.text !== 'string' || !parsed.text.trim()) return;
    if (parsed.type !== 'partial' && parsed.type !== 'final') return;
    this.OnMessage?.({
      id: typeof parsed.id === 'number' ? parsed.id : Date.now(),
      src: parsed.text,
      type: parsed.type === 'final' ? 0 : 1,
      detectedLanguage: this.languageCode && this.languageCode !== 'auto' ? this.languageCode : undefined,
    });
  }

  private _startProcessor(srcRate: number) {
    if (!this._context || !this._stream) return;
    this._source = this._context.createMediaStreamSource(this._stream);
    this._processor = this._context.createScriptProcessor(4096, 1, 1);
    this._source.connect(this._processor);
    this._processor.connect(this._context.destination);
    this._processor.onaudioprocess = (e) => {
      if (!this._running || !this._socket || this._socket.readyState !== WebSocket.OPEN) return;
      if (this._socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        this._drop('relay stalled');
        return;
      }
      const float32 = e.inputBuffer.getChannelData(0);
      const resampled = srcRate === TARGET_SAMPLE_RATE
        ? float32
        : this._resample(float32, srcRate, TARGET_SAMPLE_RATE);
      this._socket.send(this._float32ToInt16(resampled));
    };
  }

  private _stopMic() {
    if (this._processor) {
      this._processor.disconnect();
      this._processor = null;
    }
    if (this._source) {
      this._source.disconnect();
      this._source = null;
    }
    if (this._stream) {
      this._stream.getTracks().forEach((track) => track.stop());
      this._stream = null;
    }
    if (this._context) {
      this._context.close().catch((err: unknown) => {
        console.warn('[FunAsr] audio context close', err);
      });
      this._context = null;
    }
  }

  private _resample(input: Float32Array, srcRate: number, dstRate: number): Float32Array {
    const ratio = srcRate / dstRate;
    const outLength = Math.round(input.length / ratio);
    const output = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const srcIdx = i * ratio;
      const lo = Math.floor(srcIdx);
      const hi = Math.min(lo + 1, input.length - 1);
      const frac = srcIdx - lo;
      output[i] = input[lo] * (1 - frac) + input[hi] * frac;
    }
    return output;
  }

  private _float32ToInt16(input: Float32Array): ArrayBuffer {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const n = Math.max(-1, Math.min(1, input[i]));
      out[i] = n < 0 ? n * 32768 : n * 32767;
    }
    return out.buffer;
  }
}
