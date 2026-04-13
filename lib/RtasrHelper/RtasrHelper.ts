export interface RtasrMessage {
  id: string | number;
  src: string;
  type: 0 | 1; // 0 = final, 1 = intermediate
}

export class RtasrHelper {
  public OnMessage?: (msg: RtasrMessage) => void;
  public OnLog?: (txt: string) => void;

  private _ws: WebSocket | null = null;
  private _worker: Worker | null = null;
  private _context: AudioContext | null = null;
  private _stream: MediaStream | null = null;
  private _recorder: ScriptProcessorNode | null = null;
  private _streamSource: MediaStreamAudioSourceNode | null = null;

  // Compatibility with useCaptions.ts calls
  SetServerID(id: number) {}
  SetSpeakingLanguageID(id: number) {}

  Start(deviceId = '') {
    this.log(`Starting Whisper RTASR with generic WebSocket: wss://whisper.kloud.cn:443/ (device: ${deviceId})`);

    // 1. Setup WebSocket
    this._ws = new WebSocket('wss://whisper.kloud.cn:443/');
    
    this._ws.onopen = () => {
      this.log('WebSocket connected to Whisper server.');
    };

    this._ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log('[Whisper Server Data]', data);

        // Try to map generically based on common Whisper WebSocket server responses
        const src = data.src || data.text || data.result || '';
        if (!src) return;
        
        let type: 0 | 1 = 1;
        // Check for final result indicators
        if (data.type === 0 || data.is_final === true || data.is_final === 'true' || data.final === true || data.isFinal === true) {
          type = 0;
        }

        const id = data.id || data.seg_id || Date.now().toString();

        if (this.OnMessage) {
          this.OnMessage({ id, src, type });
        }
      } catch (err) {
        // If it's not JSON, maybe it's raw text?
        if (typeof e.data === 'string' && e.data.trim()) {
           this.log('Raw text received: ' + e.data);
           if (this.OnMessage) {
             this.OnMessage({ id: Date.now().toString(), src: e.data, type: 0 });
           }
        }
      }
    };

    this._ws.onerror = (e) => this.log('WebSocket error: ' + e);
    this._ws.onclose = () => this.log('WebSocket closed.');

    // 2. Setup Web Worker (Xfyun PCM compression algorithm from transformpcm.worker.js)
    this._worker = new Worker('/rtasr/transformpcm.worker.js');
    this._worker.onmessage = (e) => {
      // The worker responds with downsampled 16bit PCM array. Send immediately to socket.
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        const pcmData = new Int8Array(e.data.buffer);
        this._ws.send(pcmData);
      }
    };

    // 3. Setup Audio Capture
    const audioConstraints = deviceId 
      ? { deviceId, channelCount: 1, sampleRate: 16000 } 
      : { channelCount: 1, sampleRate: 16000 };

    navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false })
      .then(stream => {
        this._stream = stream;
        this._context = new AudioContext({ sampleRate: 16000 });
        this._streamSource = this._context.createMediaStreamSource(stream);
        
        // 2048 roughly equals 128ms of audio at 16kHz
        this._recorder = this._context.createScriptProcessor(2048, 1, 1);
        
        this._streamSource.connect(this._recorder);
        this._recorder.connect(this._context.destination);

        if (this._worker) {
          this._worker.postMessage({ command: 'setSampleRate', val: this._context.sampleRate });
        }

        this._recorder.onaudioprocess = (e) => {
          const audioData = e.inputBuffer.getChannelData(0);
          if (this._worker) {
            // Using "whisper" command as defined in the worker script
            this._worker.postMessage({ command: 'whisper', buffer: audioData });
          }
        };
      })
      .catch(err => {
        this.log('Failed to open microphone: ' + err);
      });
  }

  Stop() {
    this.log('Stopping Whisper RTASR...');
    if (this._ws) {
      // Clean close
      this._ws.close();
      this._ws = null;
    }
    if (this._recorder) {
      this._recorder.disconnect();
      this._recorder = null;
    }
    if (this._streamSource) {
      this._streamSource.disconnect();
      this._streamSource = null;
    }
    if (this._context) {
      this._context.close();
      this._context = null;
    }
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
  }

  private log(txt: string) {
    console.log('[RtasrHelper]', txt);
    if (this.OnLog) this.OnLog(txt);
  }
}
