/**
 * RtasrHelper.ts — AssemblyAI v3 实时语音转写
 *
 * 修复：先启动麦克风/AudioContext，获取实际采样率后再连接 WebSocket，
 *       避免 sampleRate 写死导致音频数据与声明不符。
 *
 * 流程：
 *   1. GET /api/transcripts/realtime-token  →  获取短期 token
 *   2. navigator.mediaDevices.getUserMedia  →  获取麦克风流
 *   3. new AudioContext()                   →  读取真实 sampleRate
 *   4. 连接 wss://streaming.assemblyai.com/v3/ws
 *        ?speech_model=u3-rt-pro&sample_rate={实际值}&token={token}
 *   5. WS onopen → 开始发送 PCM 数据
 *
 * v3 消息类型：
 *   { type: "Begin" }
 *   { type: "Turn", transcript: string, end_of_turn: boolean }
 *   { type: "Termination" }
 *
 * 关闭：发送 { type: "Terminate" }
 */

export interface RtasrMessage {
  id: string | number;
  src: string;
  type: 0 | 1; // 0 = final, 1 = intermediate
}

export class RtasrHelper {
  public OnMessage?: (msg: RtasrMessage) => void;
  public OnLog?: (txt: string) => void;

  /** AssemblyAI speech_model
   *  - 'whisper-rt' : Whisper-Streaming，支持 99+ 语言（含中文/日/韩），自动识别语言
   *  - 'u3-rt-pro'  : Universal-3 Pro，仅限英语及少数欧洲语言
   */
  public speechModel: string = 'whisper-rt';

  /** 识别语言代码 (zh, en, ja, ko) */
  public languageCode: string = 'zh';

  private _ws: WebSocket | null = null;
  private _context: AudioContext | null = null;
  private _stream: MediaStream | null = null;
  private _processor: ScriptProcessorNode | null = null;
  private _source: MediaStreamAudioSourceNode | null = null;
  private _running = false;

  SetServerID(_id: number) {}
  SetSpeakingLanguageID(_id: number) {}

  async Start(deviceId = '') {
    if (this._running) return;
    this._running = true;

    try {
      // ── Step 1: 获取临时 token ────────────────────────────────────────
      this.log('Fetching AssemblyAI v3 token...');
      const tokenRes = await fetch('/api/transcripts/realtime-token');
      if (!tokenRes.ok) {
        throw new Error(`Token fetch failed: ${tokenRes.status} ${await tokenRes.text()}`);
      }
      const { token, error: tokenErr } = await tokenRes.json();
      if (tokenErr || !token) throw new Error(`Token error: ${tokenErr || 'empty'}`);
      this.log('Token acquired.');

      // ── Step 2: 先打开麦克风，获取真实 sampleRate ─────────────────────
      const audioConstraints: MediaTrackConstraints = deviceId
        ? { deviceId: { exact: deviceId }, channelCount: 1 }
        : { channelCount: 1, echoCancellation: true, noiseSuppression: true };

      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });

      // 让浏览器使用其默认（或设备端）采样率，然后读取真实值
      this._context = new AudioContext();
      const actualSampleRate = this._context.sampleRate;
      this.log(`AudioContext sampleRate = ${actualSampleRate}`);

      // ── Step 3: 用真实 sampleRate 连接 AssemblyAI v3 WS ──────────────
      let wsUrl =
        `wss://streaming.assemblyai.com/v3/ws` +
        `?speech_model=${encodeURIComponent(this.speechModel)}` +
        `&sample_rate=${Math.round(actualSampleRate)}` +
        `&format_turns=true` +             // 加标点符号
        `&end_of_turn_silence_threshold=500` +  // 500ms 静音即触发 end_of_turn
        `&token=${encodeURIComponent(token)}`;

      // AssemblyAI v3 对 language_code 有严格枚举限制。
      // 当前产品语言可能是 zh/ja/ko，需映射为 multi 才能被服务端接受。
      const normalizedLanguage = this._normalizeAssemblyLanguageCode(this.languageCode);
      if (normalizedLanguage && normalizedLanguage !== 'auto') {
        wsUrl += `&language_code=${encodeURIComponent(normalizedLanguage)}`;
        this.log(`Language fixed to: ${normalizedLanguage} (from ${this.languageCode || 'empty'})`);
      } else {
        wsUrl += `&language_detection=true`;
        this.log('Language detection enabled (auto)');
      }

      this.log(`Connecting: model=${this.speechModel} sampleRate=${Math.round(actualSampleRate)}`);
      this._ws = new WebSocket(wsUrl);
      this._ws.binaryType = 'arraybuffer';

      this._ws.onopen = () => {
        this.log('WS connected — starting PCM streaming');
        this._startProcessor(actualSampleRate);
      };

      this._ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          const type: string = msg.type || '';

          if (type === 'Begin') {
            this.log(`Session started: id=${msg.id}`);
            return;
          }

          if (type === 'Turn') {
            const text: string = msg.transcript || '';
            if (!text.trim()) return;
            const isFinal: boolean = msg.end_of_turn === true;
            // whisper-rt 在 end_of_turn 时的 utterance 字段有完整标点版本
            const display = isFinal && msg.utterance ? msg.utterance : text;
            if (isFinal && msg.language_code) {
              this.log(`Detected language: ${msg.language_code} (${(msg.language_confidence * 100).toFixed(0)}%)`);
            }
            this.log(`[${isFinal ? 'FINAL' : 'PARTIAL'}] ${display}`);
            this.OnMessage?.({ id: Date.now(), src: display, type: isFinal ? 0 : 1 });
            return;
          }

          if (type === 'Termination') {
            this.log(`Session terminated (audio=${msg.audio_duration_seconds}s)`);
          }
        } catch (err) {
          this.log('Parse error: ' + err);
        }
      };

      this._ws.onerror = (e) => this.log('WS error: ' + JSON.stringify(e));
      this._ws.onclose = (e) => {
        this.log(`WS closed: code=${e.code} ${e.reason}`);
        this._running = false;
      };
    } catch (err) {
      this.log('Start failed: ' + err);
      this._stopMic();
      this._running = false;
    }
  }

  Stop() {
    this._running = false;
    this.log('Stopping...');

    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      try { this._ws.send(JSON.stringify({ type: 'Terminate' })); } catch (_) {}
      setTimeout(() => { this._ws?.close(); this._ws = null; }, 150);
    } else {
      this._ws = null;
    }

    this._stopMic();
  }

  // ── ScriptProcessor：在 WS 打开后才启动 ─────────────────────────────

  private _startProcessor(sampleRate: number) {
    if (!this._context || !this._stream) return;

    this._source = this._context.createMediaStreamSource(this._stream);

    // 800 samples @ 任意 sampleRate ≈ 50ms（AssemblyAI 推荐帧长）
    // 注意：WebAudio API 只允许 256/512/1024/2048/4096/8192/16384
    const bufferSize = 4096; // ~85ms@48kHz，稳定不丢包
    this._processor = this._context.createScriptProcessor(bufferSize, 1, 1);
    this._source.connect(this._processor);
    this._processor.connect(this._context.destination);

    this._processor.onaudioprocess = (e) => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
      const float32 = e.inputBuffer.getChannelData(0);
      this._ws.send(this._float32ToInt16(float32));
    };

    this.log(`ScriptProcessor started (bufferSize=${bufferSize}, sampleRate=${sampleRate})`);
  }

  private _stopMic() {
    if (this._processor) { this._processor.disconnect(); this._processor = null; }
    if (this._source)    { this._source.disconnect();    this._source = null; }
    if (this._stream)    { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
    if (this._context)   { this._context.close().catch(() => {}); this._context = null; }
  }

  // ── Float32 → Int16 PCM ──────────────────────────────────────────────

  private _float32ToInt16(input: Float32Array): ArrayBuffer {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const n = Math.max(-1, Math.min(1, input[i]));
      out[i] = n < 0 ? n * 32768 : n * 32767;
    }
    return out.buffer;
  }

  private _normalizeAssemblyLanguageCode(languageCode?: string): string {
    const code = (languageCode || '').trim().toLowerCase();
    if (!code || code === 'auto') return 'auto';

    // AssemblyAI v3 当前可接受值（按报错枚举）：
    // en/fr/de/es/it/pt/multi
    const passthrough = new Set(['en', 'fr', 'de', 'es', 'it', 'pt', 'multi']);
    if (passthrough.has(code)) return code;

    // 现有产品里常用的东亚语种（以及其他非上述枚举）不强行指定 language_code，
    // 交给服务端自动检测，避免“可连接但无结果”的情况。
    if (code === 'zh' || code === 'ja' || code === 'ko') return 'auto';
    return 'auto';
  }

  private log(txt: string) {
    console.log('[AssemblyAI-v3]', txt);
    this.OnLog?.(txt);
  }
}
