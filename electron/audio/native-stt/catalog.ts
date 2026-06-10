/**
 * Native-STT engine catalog — sherpa-onnx (T-one streaming CTC, GigaAM offline
 * NeMo CTC, streaming zipformer transducers) and VOSK.
 *
 * These engines run as native providers ALONGSIDE the transformers.js Whisper /
 * Moonshine pipeline (see electron/audio/LocalWhisperSTT.ts). Each ships its own
 * model format (sherpa = .tar.bz2 of .onnx + tokens.txt; vosk = .zip), so they
 * get their own catalog + downloader (see ./modelDownloader.ts) instead of the
 * HuggingFace cache used by Whisper.
 */

export type NativeSttEngine = 'sherpa' | 'vosk';

/**
 * How the sherpa model is wired into the recognizer. 'online-*' use
 * OnlineRecognizer (true streaming, word-by-word partials + built-in endpoint
 * detection). 'offline-nemo-ctc' uses OfflineRecognizer (GigaAM) — no streaming,
 * so the provider VAD-segments the audio like Whisper does.
 */
export type SherpaModelKind =
  | 'online-tone-ctc'         // T-one (RU): modelConfig.toneCtc.model
  | 'online-transducer'       // zipformer streaming: encoder/decoder/joiner
  | 'online-zipformer2-ctc'   // streaming zipformer CTC: single model
  | 'online-nemo-transducer'  // Parakeet streaming: transducer + modelType nemo
  | 'offline-nemo-ctc'        // GigaAM (RU): OfflineRecognizer nemoCtc
  | 'offline-nemo-transducer' // Parakeet TDT (multi): transducer + modelType nemo
  | 'offline-sense-voice'     // SenseVoice (zh/en/ja/ko/yue): senseVoice.model
  | 'offline-whisper';        // Whisper via sherpa: whisper.encoder/decoder

/**
 * UI architecture grouping (one tab per value). Independent of `engine`: several
 * sherpa architectures get their own tab so the model list per tab stays short.
 */
export type NativeSttArchitecture =
  | 'sherpa'       // T-one, GigaAM, Zipformer (the general sherpa bucket)
  | 'sensevoice'   // SenseVoice multilingual
  | 'parakeet'     // NVIDIA Parakeet TDT
  | 'vosk';        // VOSK / Kaldi

export interface NativeSttModelInfo {
  /** Stable id used in settings + IPC. Mirrors the archive's top-level dir. */
  id: string;
  engine: NativeSttEngine;
  /** UI tab this model appears under. Defaults to engine when omitted. */
  architecture?: NativeSttArchitecture;
  /** Display name shown in the UI tab. */
  name: string;
  /** BCP-47-ish language tag(s) the model covers ('ru', 'en', 'zh-en', 'multi'). */
  language: string;
  /** Short human language label for the UI badge ('RU', 'EN', 'ZH+EN'). */
  languageLabel: string;
  sizeMb: number;
  speed: 'very-fast' | 'fast' | 'medium' | 'slow';
  accuracy: 'decent' | 'good' | 'high' | 'very-high';
  /** True for OnlineRecognizer models (live partials); false = offline/segmented. */
  streaming: boolean;
  /** Download URL of the archive. */
  url: string;
  /** 'tar.bz2' (sherpa) | 'zip' (vosk). */
  archive: 'tar.bz2' | 'zip';

  // ── sherpa-only wiring ────────────────────────────────────────────────
  sherpaKind?: SherpaModelKind;
  /**
   * Filenames inside the (flattened) model dir the recognizer needs. For
   * single-model kinds: { model, tokens }. For transducer: { encoder, decoder,
   * joiner, tokens }. Resolved against the model dir at provider-construction
   * time. Prefer .int8.onnx variants where present (smaller, ~same WER).
   */
  files?: {
    model?: string;
    encoder?: string;
    decoder?: string;
    joiner?: string;
    tokens?: string;
  };

  // ── filesystem status (filled by the catalog at read time) ────────────
  status?: 'available' | 'missing' | 'downloading' | 'error';
  partial?: boolean;
  partialBytes?: number;
}

const SHERPA_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';
const VOSK_BASE = 'https://alphacephei.com/vosk/models';

/** Compact constructor for a VOSK small-model catalog entry. */
function vosk(id: string, langName: string, language: string, languageLabel: string, sizeMb: number): NativeSttModelInfo {
  return {
    id, engine: 'vosk', architecture: 'vosk',
    name: `Vosk Small (${langName})`, language, languageLabel,
    sizeMb, speed: 'fast', accuracy: 'good', streaming: true,
    url: `${VOSK_BASE}/${id}.zip`, archive: 'zip',
  };
}

/**
 * Catalog of native-STT models. `files` lists what the recognizer loads; the
 * downloader flattens the archive's single top dir (strip:1) so these are
 * relative to the model's own directory.
 */
export const NATIVE_STT_CATALOG: NativeSttModelInfo[] = [
  // ── sherpa · streaming (OnlineRecognizer) ─────────────────────────────
  {
    id: 'sherpa-onnx-streaming-t-one-russian-2025-09-08',
    engine: 'sherpa', name: 'T-one (Russian)', language: 'ru', languageLabel: 'RU',
    sizeMb: 167, speed: 'very-fast', accuracy: 'very-high', streaming: true,
    url: `${SHERPA_BASE}/sherpa-onnx-streaming-t-one-russian-2025-09-08.tar.bz2`,
    archive: 'tar.bz2', sherpaKind: 'online-tone-ctc',
    files: { model: 'model.onnx', tokens: 'tokens.txt' },
  },
  {
    id: 'sherpa-onnx-streaming-zipformer-en-20M-2023-02-17',
    engine: 'sherpa', name: 'Zipformer EN (20M)', language: 'en', languageLabel: 'EN',
    sizeMb: 122, speed: 'very-fast', accuracy: 'good', streaming: true,
    url: `${SHERPA_BASE}/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17.tar.bz2`,
    archive: 'tar.bz2', sherpaKind: 'online-transducer',
    files: {
      encoder: 'encoder-epoch-99-avg-1.int8.onnx',
      decoder: 'decoder-epoch-99-avg-1.onnx',
      joiner: 'joiner-epoch-99-avg-1.int8.onnx',
      tokens: 'tokens.txt',
    },
  },
  {
    id: 'sherpa-onnx-streaming-zipformer-en-2023-06-26',
    engine: 'sherpa', name: 'Zipformer EN (large)', language: 'en', languageLabel: 'EN',
    sizeMb: 340, speed: 'fast', accuracy: 'very-high', streaming: true,
    url: `${SHERPA_BASE}/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2`,
    archive: 'tar.bz2', sherpaKind: 'online-transducer',
    files: {
      encoder: 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
      decoder: 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx',
      joiner: 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
      tokens: 'tokens.txt',
    },
  },
  {
    id: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
    engine: 'sherpa', name: 'Zipformer ZH+EN (bilingual)', language: 'zh-en', languageLabel: 'ZH+EN',
    sizeMb: 350, speed: 'fast', accuracy: 'high', streaming: true,
    url: `${SHERPA_BASE}/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2`,
    archive: 'tar.bz2', sherpaKind: 'online-transducer',
    files: {
      encoder: 'encoder-epoch-99-avg-1.int8.onnx',
      decoder: 'decoder-epoch-99-avg-1.onnx',
      joiner: 'joiner-epoch-99-avg-1.int8.onnx',
      tokens: 'tokens.txt',
    },
  },
  {
    id: 'sherpa-onnx-streaming-zipformer-korean-2024-06-16',
    engine: 'sherpa', name: 'Zipformer Korean', language: 'ko', languageLabel: 'KO',
    sizeMb: 320, speed: 'fast', accuracy: 'high', streaming: true,
    url: `${SHERPA_BASE}/sherpa-onnx-streaming-zipformer-korean-2024-06-16.tar.bz2`,
    archive: 'tar.bz2', sherpaKind: 'online-transducer',
    files: {
      encoder: 'encoder-epoch-99-avg-1.int8.onnx',
      decoder: 'decoder-epoch-99-avg-1.onnx',
      joiner: 'joiner-epoch-99-avg-1.int8.onnx',
      tokens: 'tokens.txt',
    },
  },

  // ── sherpa · offline (OfflineRecognizer · GigaAM NeMo CTC) ─────────────
  {
    id: 'sherpa-onnx-nemo-ctc-giga-am-v2-russian-2025-04-19',
    engine: 'sherpa', name: 'GigaAM v2 (Russian)', language: 'ru', languageLabel: 'RU',
    sizeMb: 270, speed: 'fast', accuracy: 'very-high', streaming: false,
    url: `${SHERPA_BASE}/sherpa-onnx-nemo-ctc-giga-am-v2-russian-2025-04-19.tar.bz2`,
    archive: 'tar.bz2', sherpaKind: 'offline-nemo-ctc',
    files: { model: 'model.int8.onnx', tokens: 'tokens.txt' },
  },
  {
    id: 'sherpa-onnx-nemo-ctc-giga-am-v3-russian-2025-12-16',
    engine: 'sherpa', name: 'GigaAM v3 (Russian)', language: 'ru', languageLabel: 'RU',
    sizeMb: 290, speed: 'fast', accuracy: 'very-high', streaming: false,
    url: `${SHERPA_BASE}/sherpa-onnx-nemo-ctc-giga-am-v3-russian-2025-12-16.tar.bz2`,
    archive: 'tar.bz2', sherpaKind: 'offline-nemo-ctc',
    files: { model: 'model.int8.onnx', tokens: 'tokens.txt' },
  },

  // additional streaming-zipformer languages (general sherpa tab)
  {
    id: 'sherpa-onnx-streaming-zipformer-fr-2023-04-14',
    engine: 'sherpa', name: 'Zipformer French', language: 'fr', languageLabel: 'FR',
    sizeMb: 380, speed: 'fast', accuracy: 'high', streaming: true,
    url: `${SHERPA_BASE}/sherpa-onnx-streaming-zipformer-fr-2023-04-14.tar.bz2`,
    archive: 'tar.bz2', sherpaKind: 'online-transducer',
    files: { tokens: 'tokens.txt' },
  },
  {
    id: 'sherpa-onnx-streaming-zipformer-multi-zh-hans-int8-2023-12-13',
    engine: 'sherpa', name: 'Zipformer Chinese (multi)', language: 'zh', languageLabel: 'ZH',
    sizeMb: 60, speed: 'very-fast', accuracy: 'high', streaming: true,
    url: `${SHERPA_BASE}/sherpa-onnx-streaming-zipformer-multi-zh-hans-int8-2023-12-13.tar.bz2`,
    archive: 'tar.bz2', sherpaKind: 'online-transducer',
    files: { tokens: 'tokens.txt' },
  },

  // ── SenseVoice (architecture tab) · multilingual offline ──────────────
  {
    id: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17',
    engine: 'sherpa', architecture: 'sensevoice',
    name: 'SenseVoice (multilingual)', language: 'zh-en-ja-ko-yue', languageLabel: 'ZH·EN·JA·KO·YUE',
    sizeMb: 155, speed: 'very-fast', accuracy: 'very-high', streaming: false,
    url: `${SHERPA_BASE}/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2`,
    archive: 'tar.bz2', sherpaKind: 'offline-sense-voice',
    files: { model: 'model.int8.onnx', tokens: 'tokens.txt' },
  },

  // ── Parakeet (architecture tab) · NVIDIA TDT ──────────────────────────
  {
    id: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    engine: 'sherpa', architecture: 'parakeet',
    name: 'Parakeet TDT v3 (25 langs)', language: 'multi', languageLabel: 'MULTI',
    sizeMb: 465, speed: 'fast', accuracy: 'very-high', streaming: false,
    url: `${SHERPA_BASE}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`,
    archive: 'tar.bz2', sherpaKind: 'offline-nemo-transducer',
    files: { tokens: 'tokens.txt' },
  },
  {
    id: 'sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-streaming-560ms',
    engine: 'sherpa', architecture: 'parakeet',
    name: 'Parakeet EN (streaming, 560ms)', language: 'en', languageLabel: 'EN',
    sizeMb: 465, speed: 'fast', accuracy: 'very-high', streaming: true,
    url: `${SHERPA_BASE}/sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-streaming-560ms.tar.bz2`,
    archive: 'tar.bz2', sherpaKind: 'online-nemo-transducer',
    files: { tokens: 'tokens.txt' },
  },

  // ── VOSK (architecture tab) ───────────────────────────────────────────
  vosk('vosk-model-small-ru-0.22', 'Russian', 'ru', 'RU', 45),
  vosk('vosk-model-small-en-us-0.15', 'English', 'en', 'EN', 40),
  vosk('vosk-model-small-de-0.15', 'German', 'de', 'DE', 45),
  vosk('vosk-model-small-fr-0.22', 'French', 'fr', 'FR', 41),
  vosk('vosk-model-small-es-0.42', 'Spanish', 'es', 'ES', 39),
  vosk('vosk-model-small-it-0.22', 'Italian', 'it', 'IT', 48),
  vosk('vosk-model-small-nl-0.22', 'Dutch', 'nl', 'NL', 39),
  vosk('vosk-model-small-pl-0.22', 'Polish', 'pl', 'PL', 50),
  vosk('vosk-model-small-tr-0.3', 'Turkish', 'tr', 'TR', 35),
  vosk('vosk-model-small-ja-0.22', 'Japanese', 'ja', 'JA', 48),
  vosk('vosk-model-small-ko-0.22', 'Korean', 'ko', 'KO', 82),
  vosk('vosk-model-small-hi-0.22', 'Hindi', 'hi', 'HI', 42),
];

export function getNativeSttModel(id: string): NativeSttModelInfo | undefined {
  return NATIVE_STT_CATALOG.find(m => m.id === id);
}

export function isKnownNativeSttModel(id: unknown): id is string {
  return typeof id === 'string' && NATIVE_STT_CATALOG.some(m => m.id === id);
}

export function nativeSttModelsForEngine(engine: NativeSttEngine): NativeSttModelInfo[] {
  return NATIVE_STT_CATALOG.filter(m => m.engine === engine);
}

/** The UI architecture tab a model belongs to (falls back to its engine). */
export function nativeSttArchitecture(m: NativeSttModelInfo): NativeSttArchitecture {
  return m.architecture ?? (m.engine === 'vosk' ? 'vosk' : 'sherpa');
}
