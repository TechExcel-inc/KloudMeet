import type { CaptionEngine, RtasrMessage } from './RtasrHelper';
import { CaptionEngineError, httpFailure, micFailure, toCaptionError } from './captionErrors';
import { defaultMicSource, type CaptionMicSource } from './captionMic';

const TARGET_SAMPLE_RATE = 16000;
/** ~30 s of 16 kHz PCM16 the stream has not taken: the connection is stuck though not closed. */
const MAX_BUFFERED_BYTES = 1_000_000;

interface StreamingEvent {
  type?: string;
  turn_order?: number;
  transcript?: string;
  end_of_turn?: boolean;
  language_code?: string;
  error?: string;
}

function streamingUrl(token: string): string {
  const url = new URL('wss://streaming.assemblyai.com/v3/ws');
  url.search = new URLSearchParams({
    token,
    sample_rate: String(TARGET_SAMPLE_RATE),
    speech_model: 'whisper-rt',
    language_detection: 'true',
  }).toString();
  return url.toString();
}

export class AssemblyAiHelper implements CaptionEngine {
  public OnMessage?: (msg: RtasrMessage) => void;
  public OnDropped?: (err: CaptionEngineError) => void;
  public micSource?: CaptionMicSource;
  public languageCode = 'zh';

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
      const res = await fetch('/api/transcripts/assemblyai-token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.getToken()}` },
      });
      if (gen !== this._gen) return;
      if (!res.ok) throw new CaptionEngineError(httpFailure(res.status), `AssemblyAI token failed: ${res.status}`);
      const data: unknown = await res.json();
      const token = data && typeof data === 'object' && 'token' in data && typeof data.token === 'string'
        ? data.token
        : '';
      if (!token) throw new CaptionEngineError('unavailable', 'AssemblyAI token is empty');

      if (gen !== this._gen) return;
      this._socket = new WebSocket(streamingUrl(token));
      await new Promise<void>((resolve, reject) => {
        if (!this._socket) {
          reject(new Error('AssemblyAI socket was not created'));
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
        const timer = setTimeout(() => finish(new Error('AssemblyAI stream timed out')), 12000);
        this._socket.onmessage = (event) => {
          let parsed: StreamingEvent | null;
          try {
            parsed = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (!parsed) return;
          if (parsed.type === 'Begin') {
            finish();
          } else if (typeof parsed.error === 'string') {
            if (settled && gen === this._gen) this._drop('reported an error');
            finish(new Error('AssemblyAI streaming failed'));
          } else if (gen === this._gen) {
            this._takeEvent(parsed);
          }
        };
        this._socket.onerror = () => {
          finish(new Error('AssemblyAI stream connection failed'));
        };
        this._socket.onclose = () => {
          finish(new Error('AssemblyAI stream closed before ready'));
        };
      });
      if (gen !== this._gen) return;

      // Ready: from now on a close or error is a drop mid-meeting.
      this._socket.onerror = null;
      this._socket.onclose = (event) => {
        if (gen === this._gen) this._drop(`stream closed (${event.code})`);
      };

      try {
        // The meeting's own microphone (captionMic.ts).
        const stream = await (this.micSource ?? defaultMicSource)();
        if (gen !== this._gen) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        this._stream = stream;
      } catch (err) {
        throw new CaptionEngineError(micFailure(err), err instanceof Error ? err.message : 'microphone failed');
      }
      try {
        this._context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      } catch (err) {
        console.warn('[AssemblyAI] AudioContext sample rate fallback', err);
        this._context = new AudioContext();
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
    const socket = this._socket;
    this._socket = null;
    if (socket?.readyState === WebSocket.OPEN) {
      const stoppedGen = this._gen;
      const timer = setTimeout(() => socket.close(), 2000);
      socket.onclose = () => clearTimeout(timer);
      socket.onmessage = (event) => {
        let parsed: StreamingEvent | null;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (parsed?.type === 'Termination') socket.close();
        if (parsed?.end_of_turn === true && this._gen === stoppedGen) this._takeEvent(parsed);
      };
      socket.send(JSON.stringify({ type: 'Terminate' }));
    } else {
      socket?.close();
    }
    this._stopMic();
  }

  /** The stream went away after it was ready: release the mic and tell the supervisor. */
  private _drop(reason: string) {
    this._socket?.close();
    this.Stop();
    this.OnDropped?.(new CaptionEngineError('network', `AssemblyAI ${reason}`));
  }

  private _takeEvent(event: StreamingEvent) {
    if (event.type !== 'Turn' || typeof event.transcript !== 'string' || !event.transcript.trim()) return;
    this.OnMessage?.({
      id: typeof event.turn_order === 'number' ? event.turn_order : Date.now(),
      src: event.transcript,
      type: event.end_of_turn === true ? 0 : 1,
      detectedLanguage: typeof event.language_code === 'string' ? event.language_code : undefined,
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
        this._drop('stream stalled');
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
        console.warn('[AssemblyAI] audio context close', err);
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
