/**
 * RtasrHelper.ts — OpenAI Realtime Transcription API (gpt-4o-transcribe)
 *
 * 流程：
 *   1. GET /api/transcripts/realtime-token  →  获取 ephemeral key (ek_xxx)
 *   2. navigator.mediaDevices.getUserMedia  →  获取麦克风流
 *   3. new AudioContext({ sampleRate: 24000 }) → 使用 OpenAI 要求的 PCM 采样率
 *   4. 连接 wss://api.openai.com/v1/realtime
 *      鉴权：WebSocket subprotocol ["realtime", "openai-insecure-api-key.{ek_xxx}"]
 *   5. ScriptProcessor → base64 PCM16 → input_audio_buffer.append
 *
 * 服务端 VAD 自动检测句子边界，转写事件：
 *   conversation.item.input_audio_transcription.delta      → 中间结果（增量文字）
 *   conversation.item.input_audio_transcription.completed  → 最终结果
 *
 * 语言：支持 ISO-639-1 标准代码（zh/en/ja/ko…）
 *       传入空字符串或 'auto' 时由 OpenAI 自动检测语言
 */

export interface RtasrMessage {
  id: string | number;
  src: string;
  type: 0 | 1; // 0 = final, 1 = intermediate
  /** OpenAI 返回的实际识别语言（ISO-639-1），用于翻译 from 参数 */
  detectedLanguage?: string;
}

const TARGET_SAMPLE_RATE = 24000;

export class RtasrHelper {
  public OnMessage?: (msg: RtasrMessage) => void;

  /** ISO-639-1 语言代码（zh/en/ja/ko/fr/de/es/pt/ru/ar/hi/vi 等）
   *  空字符串或 'auto' 表示自动检测 */
  public languageCode: string = 'zh';

  /** 转写模型，可选 gpt-4o-transcribe / gpt-4o-mini-transcribe / whisper-1 */
  public speechModel: string = 'gpt-4o-transcribe';

  private _ws: WebSocket | null = null;
  private _context: AudioContext | null = null;
  private _stream: MediaStream | null = null;
  private _processor: ScriptProcessorNode | null = null;
  private _source: MediaStreamAudioSourceNode | null = null;
  private _running = false;

  /** 累积每个 item_id 的增量文字，用于 partial 显示 */
  private _partialTexts = new Map<string, string>();

  SetServerID(_id: number) {}
  SetSpeakingLanguageID(_id: number) {}

  async Start(deviceId = '') {
    if (this._running) return;
    this._running = true;

    try {
      // ── Step 1: 拿 ephemeral key（语言写到服务端 transcription session）──
      const lang0 = (this.languageCode || '').trim().toLowerCase();
      const tokenUrl = lang0 && lang0 !== 'auto'
        ? `/api/transcripts/realtime-token?lang=${encodeURIComponent(lang0)}`
        : '/api/transcripts/realtime-token';
      const tokenRes = await fetch(tokenUrl);
      if (!tokenRes.ok) {
        throw new Error(`Token fetch failed: ${tokenRes.status} ${await tokenRes.text()}`);
      }
      const { token, error: tokenErr } = await tokenRes.json();
      if (tokenErr || !token) throw new Error(`Token error: ${tokenErr || 'empty'}`);
      // ── Step 2: 打开麦克风 ──────────────────────────────────────────────
      const baseConstraints: MediaTrackConstraints = {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      const audioConstraints: MediaTrackConstraints = deviceId
        ? { ...baseConstraints, deviceId: { exact: deviceId } }
        : baseConstraints;

      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });

      // 直接以 24kHz 创建 AudioContext，由浏览器做高质量重采样
      // 大多数浏览器会接受这个 hint；若不接受会自己挑就近采样率
      try {
        this._context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      } catch {
        this._context = new AudioContext();
      }
      const srcSampleRate = this._context.sampleRate;
      // ── Step 3: 用 ephemeral key 连 OpenAI Realtime ─────────────────────
      // URL 不带 model，session 配置在服务端创建 ek 时已锁死为 transcription
      const wsUrl = 'wss://api.openai.com/v1/realtime';
      this._ws = new WebSocket(wsUrl, [
        'realtime',
        `openai-insecure-api-key.${token}`,
      ]);

      this._ws.onopen = () => {
        this._startProcessor(srcSampleRate);
      };

      this._ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          const type: string = msg.type || '';

          // 增量转写（gpt-4o-transcribe 才有；whisper-1 不发 delta）
          if (type === 'conversation.item.input_audio_transcription.delta') {
            const itemId: string = msg.item_id || 'default';
            const accumulated = (this._partialTexts.get(itemId) ?? '') + (msg.delta ?? '');
            this._partialTexts.set(itemId, accumulated);
            if (accumulated.trim()) {
              this.OnMessage?.({ id: itemId, src: accumulated, type: 1 });
            }
            return;
          }

          // 最终转写结果
          if (type === 'conversation.item.input_audio_transcription.completed') {
            const itemId: string = msg.item_id || 'default';
            const text: string = msg.transcript ?? this._partialTexts.get(itemId) ?? '';
            const detectedLanguage: string = msg.language || this.languageCode || '';
            this._partialTexts.delete(itemId);
            if (text.trim()) {
              this.OnMessage?.({ id: itemId, src: text, type: 0, detectedLanguage });
            }
            return;
          }

          if (type === 'input_audio_buffer.speech_started') {
            return;
          }

          if (type === 'input_audio_buffer.speech_stopped') {
            return;
          }

          if (type === 'input_audio_buffer.committed') {
            return;
          }

          if (type === 'conversation.item.input_audio_transcription.failed') {
            return;
          }

          if (type === 'error') {
            return;
          }

          if (type === 'session.created' || type === 'session.updated') {
            return;
          }
          if (type === 'conversation.item.added' || type === 'conversation.item.done') {
            const transcript = msg.item?.content?.find((c: { type?: string; transcript?: string }) => c.type === 'input_audio')?.transcript;
            if (type === 'conversation.item.done' && typeof transcript === 'string' && transcript.trim()) {
              this.OnMessage?.({
                id: msg.item?.id || Date.now(),
                src: transcript,
                type: 0,
                detectedLanguage: this.languageCode || undefined,
              });
            }
            return;
          }
        } catch (_) {}
      };

      this._ws.onerror = () => {};
      this._ws.onclose = () => {
        this._running = false;
      };
    } catch (_) {
      this._stopMic();
      this._running = false;
    }
  }

  Stop() {
    this._running = false;
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._partialTexts.clear();
    this._stopMic();
  }

  // ── ScriptProcessor：采集麦克风 PCM，重采样后 base64 发送 ───────────────

  private _startProcessor(srcRate: number) {
    if (!this._context || !this._stream) return;

    this._source = this._context.createMediaStreamSource(this._stream);

    this._processor = this._context.createScriptProcessor(4096, 1, 1);
    this._source.connect(this._processor);
    this._processor.connect(this._context.destination);

    this._processor.onaudioprocess = (e) => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
      const float32 = e.inputBuffer.getChannelData(0);
      const resampled =
        srcRate !== TARGET_SAMPLE_RATE
          ? this._resample(float32, srcRate, TARGET_SAMPLE_RATE)
          : float32;
      const pcm16Buffer = this._float32ToInt16(resampled);
      const b64 = this._arrayBufferToBase64(pcm16Buffer);
      this._ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
    };
  }

  private _stopMic() {
    if (this._processor) { this._processor.disconnect(); this._processor = null; }
    if (this._source)    { this._source.disconnect();    this._source = null; }
    if (this._stream)    { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
    if (this._context)   { this._context.close().catch(() => {}); this._context = null; }
  }

  // ── 线性插值重采样 Float32 srcRate → TARGET_RATE ──────────────────────

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

  // ── Float32 [-1,1] → Int16 PCM ───────────────────────────────────────

  private _float32ToInt16(input: Float32Array): ArrayBuffer {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const n = Math.max(-1, Math.min(1, input[i]));
      out[i] = n < 0 ? n * 32768 : n * 32767;
    }
    return out.buffer;
  }

  // ── ArrayBuffer → base64 ─────────────────────────────────────────────

  private _arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const CHUNK = 8192;
    for (let i = 0; i < bytes.byteLength; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
}
