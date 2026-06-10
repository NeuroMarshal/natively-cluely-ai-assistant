/**
 * VoskSTT — local STT provider backed by vosk-koffi.
 *
 * Same EventEmitter surface as LocalWhisperSTT so it slots into the
 * createSTTProvider() factory. VOSK is streaming: feed 16k mono int16, poll
 * partialResult() for the growing text, and when acceptWaveform() returns true
 * (VOSK detected an utterance boundary) read result() as the final.
 *
 * vosk-koffi needs the native libvosk in node_modules/vosk-koffi/bin-<plat>-<arch>/
 * (libvosk.dll + runtime DLLs on Windows). These are bundled by electron-builder;
 * see the require guard in start().
 */

import { EventEmitter } from 'events';
import { resampleToF32 } from './whisper/audioResampler';
import { getNativeSttModel, type NativeSttModelInfo } from './native-stt/catalog';
import { getNativeSttModelDir, isNativeSttModelCached } from './native-stt/modelDownloader';

type VoskModule = typeof import('vosk-koffi');

export class VoskSTT extends EventEmitter {
  private readonly modelId: string;
  private readonly model: NativeSttModelInfo;
  private inputSampleRate = 48000;
  private language = 'auto';
  private channelLabel = '';
  private isActive = false;

  private vosk: VoskModule | null = null;
  private voskModel: any = null;
  private recognizer: any = null;
  private lastPartial = '';

  constructor(modelId: string) {
    super();
    const m = getNativeSttModel(modelId);
    if (!m || m.engine !== 'vosk') {
      throw new Error(`VoskSTT: unknown vosk model "${modelId}"`);
    }
    this.modelId = modelId;
    this.model = m;
  }

  setSampleRate(rate: number): void { this.inputSampleRate = rate; }
  setAudioChannelCount(_count: number): void {}
  setRecognitionLanguage(key: string): void { this.language = key || 'auto'; }
  setCredentials(_p: string): void {}
  setChannel(label: string): void { this.channelLabel = (label ?? '').trim(); }
  setContext(_prompt: string): void { /* vosk grammar not wired */ }

  start(): void {
    if (this.isActive) return;
    try {
      this.vosk = require('vosk-koffi');
      this.vosk!.setLogLevel(-1);
    } catch (e) {
      this.emitFatal('VOSK_ADDON_MISSING', `vosk-koffi failed to load: ${(e as Error).message}`);
      return;
    }
    if (!isNativeSttModelCached(this.model)) {
      this.emitFatal('NATIVE_STT_MODEL_MISSING', `Model not downloaded: ${this.model.name}`);
      return;
    }
    try {
      this.voskModel = new this.vosk!.Model(getNativeSttModelDir(this.modelId));
      this.recognizer = new this.vosk!.Recognizer({ model: this.voskModel, sampleRate: 16000 });
      this.recognizer.setWords(false);
    } catch (e) {
      this.emitFatal('NATIVE_STT_INIT_FAILED', `Failed to init Vosk: ${(e as Error).message}`);
      return;
    }
    this.isActive = true;
    this.lastPartial = '';
    console.log(`[VoskSTT] started ${this.modelId}${this.channelLabel ? ' · ' + this.channelLabel : ''}`);
  }

  write(chunk: Buffer): void {
    if (!this.isActive || !this.recognizer) return;
    const f32 = resampleToF32(chunk, this.inputSampleRate); // -> 16k Float32
    const int16 = Buffer.alloc(f32.length * 2);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      int16.writeInt16LE(Math.round(s * 32767), i * 2);
    }
    try {
      const isFinal = this.recognizer.acceptWaveform(int16);
      if (isFinal) {
        const text = (this.recognizer.result()?.text || '').trim();
        this.lastPartial = '';
        if (text) this.emit('transcript', { text, isFinal: true, confidence: 0.9 });
      } else {
        const partial = (this.recognizer.partialResult()?.partial || '').trim();
        if (partial && partial !== this.lastPartial) {
          this.lastPartial = partial;
          this.emit('transcript', { text: partial, isFinal: false, confidence: 0.7 });
        }
      }
    } catch (e) {
      console.warn('[VoskSTT] write error:', (e as Error).message);
    }
  }

  finalize(): void {
    if (!this.isActive || !this.recognizer) return;
    try {
      const text = (this.recognizer.finalResult()?.text || '').trim();
      this.lastPartial = '';
      if (text) this.emit('transcript', { text, isFinal: true, confidence: 0.9 });
    } catch { /* noop */ }
  }

  stop(): void {
    if (!this.isActive) return;
    this.isActive = false;
    this.finalize();
    try { this.recognizer?.free?.(); } catch { /* noop */ }
    try { this.voskModel?.free?.(); } catch { /* noop */ }
    this.recognizer = null;
    this.voskModel = null;
    this.lastPartial = '';
  }

  private emitFatal(code: string, message: string): void {
    const err = new Error(message) as Error & { code?: string; modelId?: string };
    err.code = code;
    err.modelId = this.modelId;
    this.emit('error', err);
  }
}
