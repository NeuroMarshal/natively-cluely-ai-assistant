/**
 * SherpaStreamingSTT — local STT provider backed by sherpa-onnx-node.
 *
 * Implements the same EventEmitter surface as LocalWhisperSTT
 * (start/stop/write/finalize/setSampleRate/setRecognitionLanguage/setChannel/
 * setContext; emits 'transcript' {text,isFinal,confidence} and 'error') so it
 * drops into the createSTTProvider() factory in main.ts unchanged.
 *
 * Two execution paths, chosen by the model's `sherpaKind`:
 *
 *   ONLINE (T-one CTC, streaming zipformer transducer/ctc) — true streaming.
 *     audio chunks -> recognizer.acceptWaveform -> decode loop -> getResult()
 *     yields a GROWING partial (emitted as isFinal:false). The engine's own
 *     endpoint detector (isEndpoint) closes a phrase -> emit isFinal:true +
 *     reset(). No VAD, no LocalAgreement — the engine does it. First partial
 *     lands in ~50-60ms (measured).
 *
 *   OFFLINE (GigaAM NeMo CTC) — no streaming export. We VAD-segment the audio
 *     (reusing whisper/VadProcessor) and run a one-shot OfflineRecognizer pass
 *     per closed segment, emitting isFinal:true. ~19x realtime, SOTA RU WER.
 */

import { EventEmitter } from 'events';
import { resampleToF32 } from './whisper/audioResampler';
import { VadProcessor } from './whisper/vadProcessor';
import {
  getNativeSttModel,
  type NativeSttModelInfo,
} from './native-stt/catalog';
import {
  getNativeSttModelDir,
  resolveSherpaFiles,
  isNativeSttModelCached,
} from './native-stt/modelDownloader';

// sherpa-onnx-node is a CommonJS native addon; require lazily so a missing/
// broken install can't crash module load for the whole app.
type SherpaModule = typeof import('sherpa-onnx-node');

export class SherpaStreamingSTT extends EventEmitter {
  private readonly modelId: string;
  private readonly model: NativeSttModelInfo;
  private inputSampleRate = 48000;
  private language = 'auto';
  private channelLabel = '';
  private isActive = false;

  private sherpa: SherpaModule | null = null;
  private online: any = null;        // OnlineRecognizer
  private onlineStream: any = null;
  private offline: any = null;       // OfflineRecognizer
  private vad: VadProcessor | null = null;

  private readonly isStreaming: boolean;
  private lastPartial = '';
  private gapFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly GAP_FLUSH_MS = 400;

  constructor(modelId: string) {
    super();
    const m = getNativeSttModel(modelId);
    if (!m || m.engine !== 'sherpa') {
      throw new Error(`SherpaStreamingSTT: unknown sherpa model "${modelId}"`);
    }
    this.modelId = modelId;
    this.model = m;
    this.isStreaming = m.streaming;
  }

  setSampleRate(rate: number): void { this.inputSampleRate = rate; }
  setAudioChannelCount(_count: number): void {}
  setRecognitionLanguage(key: string): void { this.language = key || 'auto'; }
  setCredentials(_p: string): void {}
  setChannel(label: string): void { this.channelLabel = (label ?? '').trim(); }
  setContext(_prompt: string): void { /* sherpa hotwords not wired yet */ }

  start(): void {
    if (this.isActive) return;
    try {
      this.sherpa = require('sherpa-onnx-node');
    } catch (e) {
      this.emitFatal('SHERPA_ADDON_MISSING', `sherpa-onnx-node failed to load: ${(e as Error).message}`);
      return;
    }
    if (!isNativeSttModelCached(this.model)) {
      this.emitFatal('NATIVE_STT_MODEL_MISSING', `Model not downloaded: ${this.model.name}`);
      return;
    }
    const dir = getNativeSttModelDir(this.modelId);
    const files = resolveSherpaFiles(this.model, dir);
    if (!files) {
      this.emitFatal('NATIVE_STT_MODEL_INCOMPLETE', `Model files missing for ${this.model.name}`);
      return;
    }

    try {
      if (this.isStreaming) {
        this.online = new this.sherpa.OnlineRecognizer(this.buildOnlineConfig(files));
        this.onlineStream = this.online.createStream();
      } else {
        this.offline = new this.sherpa.OfflineRecognizer(this.buildOfflineConfig(files));
        this.vad = new VadProcessor();
      }
    } catch (e) {
      this.emitFatal('NATIVE_STT_INIT_FAILED', `Failed to init sherpa recognizer: ${(e as Error).message}`);
      return;
    }

    this.isActive = true;
    this.lastPartial = '';
    console.log(`[SherpaStreamingSTT] started ${this.modelId} (${this.isStreaming ? 'online' : 'offline'})${this.channelLabel ? ' · ' + this.channelLabel : ''}`);
  }

  private buildOnlineConfig(files: Record<string, string>): any {
    const modelConfig: any = { tokens: files.tokens, numThreads: 2, provider: 'cpu' };
    switch (this.model.sherpaKind) {
      case 'online-tone-ctc':
        modelConfig.toneCtc = { model: files.model };
        break;
      case 'online-zipformer2-ctc':
        modelConfig.zipformer2Ctc = { model: files.model };
        break;
      case 'online-nemo-transducer':
        modelConfig.transducer = { encoder: files.encoder, decoder: files.decoder, joiner: files.joiner };
        modelConfig.modelType = 'nemo_transducer';
        break;
      case 'online-transducer':
      default:
        modelConfig.transducer = { encoder: files.encoder, decoder: files.decoder, joiner: files.joiner };
        break;
    }
    return {
      modelConfig,
      decodingMethod: 'greedy_search',
      enableEndpoint: true,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.0,
      rule3MinUtteranceLength: 20,
    };
  }

  private buildOfflineConfig(files: Record<string, string>): any {
    const modelConfig: any = { tokens: files.tokens, numThreads: 2, provider: 'cpu' };
    switch (this.model.sherpaKind) {
      case 'offline-sense-voice':
        modelConfig.senseVoice = { model: files.model, useInverseTextNormalization: true };
        break;
      case 'offline-nemo-transducer':
        modelConfig.transducer = { encoder: files.encoder, decoder: files.decoder, joiner: files.joiner };
        modelConfig.modelType = 'nemo_transducer';
        break;
      case 'offline-whisper':
        modelConfig.whisper = { encoder: files.encoder, decoder: files.decoder };
        break;
      case 'offline-nemo-ctc':
      default:
        modelConfig.nemoCtc = { model: files.model };
        break;
    }
    return { modelConfig, decodingMethod: 'greedy_search' };
  }

  write(chunk: Buffer): void {
    if (!this.isActive) return;
    const f32 = resampleToF32(chunk, this.inputSampleRate); // -> 16k Float32
    if (this.isStreaming) {
      this.writeOnline(f32);
    } else {
      this.writeOffline(f32);
    }
  }

  private writeOnline(f32: Float32Array): void {
    try {
      this.onlineStream.acceptWaveform({ samples: f32, sampleRate: 16000 });
      while (this.online.isReady(this.onlineStream)) this.online.decode(this.onlineStream);

      const text = (this.online.getResult(this.onlineStream).text || '').trim();
      if (text && text !== this.lastPartial) {
        this.lastPartial = text;
        this.emit('transcript', { text, isFinal: false, confidence: 0.7 });
      }

      if (this.online.isEndpoint(this.onlineStream)) {
        const finalText = (this.online.getResult(this.onlineStream).text || '').trim();
        this.online.reset(this.onlineStream);
        this.lastPartial = '';
        if (finalText) this.emit('transcript', { text: finalText, isFinal: true, confidence: 0.9 });
      }
    } catch (e) {
      console.warn('[SherpaStreamingSTT] online write error:', (e as Error).message);
    }
  }

  private writeOffline(f32: Float32Array): void {
    if (!this.vad) return;
    const segs = this.vad.push(f32);
    segs.forEach(s => this.decodeOffline(s.samples));

    // Gap-flush so a trailing segment closes even if audio stops arriving.
    if (this.gapFlushTimer) clearTimeout(this.gapFlushTimer);
    this.gapFlushTimer = setTimeout(() => {
      this.gapFlushTimer = null;
      if (this.isActive && this.vad) this.vad.flush().forEach(s => this.decodeOffline(s.samples));
    }, SherpaStreamingSTT.GAP_FLUSH_MS);
  }

  private decodeOffline(samples: Float32Array): void {
    if (!this.offline || !this.sherpa) return;
    try {
      const stream = this.offline.createStream();
      stream.acceptWaveform({ samples, sampleRate: 16000 });
      this.offline.decode(stream);
      const text = (this.offline.getResult(stream).text || '').trim();
      if (text) this.emit('transcript', { text, isFinal: true, confidence: 0.9 });
    } catch (e) {
      console.warn('[SherpaStreamingSTT] offline decode error:', (e as Error).message);
    }
  }

  finalize(): void {
    if (!this.isActive) return;
    if (this.isStreaming) {
      try {
        this.onlineStream?.inputFinished?.();
        while (this.online.isReady(this.onlineStream)) this.online.decode(this.onlineStream);
        const finalText = (this.online.getResult(this.onlineStream).text || '').trim();
        if (finalText) this.emit('transcript', { text: finalText, isFinal: true, confidence: 0.9 });
        this.online.reset(this.onlineStream);
        this.lastPartial = '';
      } catch { /* noop */ }
    } else if (this.vad) {
      this.vad.flush().forEach(s => this.decodeOffline(s.samples));
    }
  }

  stop(): void {
    if (!this.isActive) return;
    this.isActive = false;
    if (this.gapFlushTimer) { clearTimeout(this.gapFlushTimer); this.gapFlushTimer = null; }
    // Drain any trailing audio into a final.
    this.finalize();
    // sherpa handles are freed when GC'd; drop refs so the native objects are
    // released and a fresh start() builds new ones.
    this.online = null;
    this.onlineStream = null;
    this.offline = null;
    this.vad = null;
    this.lastPartial = '';
  }

  private emitFatal(code: string, message: string): void {
    const err = new Error(message) as Error & { code?: string; modelId?: string };
    err.code = code;
    err.modelId = this.modelId;
    this.emit('error', err);
  }
}
