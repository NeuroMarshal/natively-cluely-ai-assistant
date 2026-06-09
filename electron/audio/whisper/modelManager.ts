import path from 'path';
import fs from 'fs';
import type { WhisperModelId, WhisperModelInfo } from './types';
import { isMultilingualWhisperModel } from './generationOptions';

// env is configured lazily via configureTransformersCache()
// We import the type only here; the actual require() happens at runtime.

const MODEL_CATALOG: WhisperModelInfo[] = [
  // ── Moonshine — streaming-native ASR. ~100× lower latency than Whisper Large v3.
  //     Encoder caching + decoder state reuse. English-only. Best choice for live use.
  { id: 'onnx-community/moonshine-tiny-ONNX', name: 'Moonshine Tiny',  sizeMb: 26,   speed: 'very-fast', accuracy: 'good',      multilingual: false, status: 'missing', streaming: true },
  { id: 'onnx-community/moonshine-base-ONNX', name: 'Moonshine Base',  sizeMb: 60,   speed: 'very-fast', accuracy: 'very-high', multilingual: false, status: 'missing', streaming: true },

  // ── Distil-Whisper — same architecture as Whisper, distilled to 1/2 layers,
  //     ~6× faster CPU/GPU at near-equivalent WER. English-only.
  { id: 'distil-whisper/distil-small.en',    name: 'Distil Small EN',  sizeMb: 164,  speed: 'very-fast', accuracy: 'high',      multilingual: false, status: 'missing', distilled: true },
  { id: 'distil-whisper/distil-medium.en',   name: 'Distil Medium EN', sizeMb: 383,  speed: 'fast',      accuracy: 'very-high', multilingual: false, status: 'missing', distilled: true },
  { id: 'distil-whisper/distil-large-v3',    name: 'Distil Large v3',  sizeMb: 731,  speed: 'medium',    accuracy: 'very-high', multilingual: false, status: 'missing', distilled: true },
  { id: 'distil-whisper/distil-large-v2',    name: 'Distil Large v2',  sizeMb: 731,  speed: 'medium',    accuracy: 'very-high', multilingual: false, status: 'missing', distilled: true },

  // NOTE: onnx-community/whisper-large-v3-turbo-ONNX was removed. Its decoder
  // export requires a `cache_position` input that @huggingface/transformers
  // (3.8.1 AND 4.2.0) never supplies, so it LOADS but every transcribe throws
  // "Missing the following inputs: cache_position". No compatible turbo export
  // exists (Xenova/whisper-large-v3-turbo 404s). Multilingual high-accuracy is
  // served by the Xenova whisper-small/medium entries below, which work.

  // ── Standard Whisper
  { id: 'Xenova/whisper-tiny.en',    name: 'Tiny English',    sizeMb: 39,   speed: 'very-fast', accuracy: 'decent',   multilingual: false, status: 'missing' },
  { id: 'Xenova/whisper-tiny',       name: 'Tiny Multilingual', sizeMb: 74, speed: 'very-fast', accuracy: 'decent',   multilingual: true,  status: 'missing' },
  { id: 'Xenova/whisper-base.en',    name: 'Base English',    sizeMb: 142,  speed: 'fast',      accuracy: 'good',     multilingual: false, status: 'missing' },
  { id: 'Xenova/whisper-base',       name: 'Base Multilingual', sizeMb: 145, speed: 'fast',     accuracy: 'good',     multilingual: true,  status: 'missing' },
  { id: 'Xenova/whisper-small.en',   name: 'Small English',   sizeMb: 244,  speed: 'medium',    accuracy: 'high',     multilingual: false, status: 'missing' },
  { id: 'Xenova/whisper-small',      name: 'Small Multilingual', sizeMb: 466, speed: 'medium',  accuracy: 'high',     multilingual: true,  status: 'missing' },
  { id: 'Xenova/whisper-medium.en',  name: 'Medium English',  sizeMb: 1500, speed: 'slow',      accuracy: 'very-high', multilingual: false, status: 'missing' },
  { id: 'Xenova/whisper-medium',     name: 'Medium Multilingual', sizeMb: 1530, speed: 'slow',  accuracy: 'very-high', multilingual: true,  status: 'missing' },
];

export const DEFAULT_LOCAL_WHISPER_MODEL_ID: WhisperModelId = 'Xenova/whisper-base';

export function isKnownWhisperModel(id: unknown): id is WhisperModelId {
  return typeof id === 'string' && MODEL_CATALOG.some(model => model.id === id);
}

/**
 * The model the STT pipeline should actually load: the stored selection when it
 * is still a known catalog model, otherwise the default. Guards against a stale
 * setting pointing at a removed/renamed model (e.g. the dropped large-v3-turbo)
 * — without this the worker would try to load a model that no longer exists and
 * fail every transcribe. Mirrors resolveActiveEmbeddingModelId in RAG.
 */
export function resolveActiveWhisperModelId(selected: string | undefined | null): WhisperModelId {
  return isKnownWhisperModel(selected) ? selected : DEFAULT_LOCAL_WHISPER_MODEL_ID;
}

export function getWhisperModelEntry(id: string): WhisperModelInfo | undefined {
  return MODEL_CATALOG.find(model => model.id === id);
}

export function getWhisperModelName(id: string): string {
  return getWhisperModelEntry(id)?.name ?? id;
}

/**
 * Returns the directory where Whisper models are stored.
 * Uses electron app.getPath('userData') so models persist across updates.
 */
export function getModelsDir(): string {
  // Use require to avoid issues with circular imports / early init
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'whisper-models');
}

/**
 * Configures @huggingface/transformers to use our custom cache directory
 * so models are stored in the user's data directory, not node_modules.
 */
export function configureTransformersCache(): void {
  // Workers configure env.cacheDir themselves via msg.cacheDir.
  // This main-thread call is a fire-and-forget best-effort so any code that
  // runs transformers directly (outside a worker) also picks up the right cache.
  // @huggingface/transformers is ESM-only; use new Function to avoid TypeScript
  // rewriting import() → require() in the CommonJS output.
  (new Function('return import("@huggingface/transformers")')() as Promise<{ env: any }>)
    .then(({ env }) => {
      env.cacheDir = getModelsDir();
      env.allowRemoteModels = false;
    })
    .catch(() => {});
}

/**
 * Converts a model ID like 'Xenova/whisper-tiny.en' to its directory under
 * the local cache. @huggingface/transformers v3+ uses a FLAT layout when
 * `env.cacheDir` is set: `<cacheDir>/<org>/<name>/...` — NOT the HF Hub v2
 * convention `models--{org}--{name}/snapshots/{rev}/...`. Earlier code here
 * assumed the v2 convention and silently returned isModelCached=false for
 * every model, which masked the path bug because the loader doesn't depend
 * on this check (it reads files directly via env.cacheDir).
 */
function modelIdToCacheDir(modelId: WhisperModelId): string {
  return modelId; // already in `<org>/<name>` shape
}

// Maps `dtype` keyword to the ONNX filename suffix the loader will look for.
// Mirrors @huggingface/transformers' DEFAULT_DTYPE_SUFFIX_MAPPING.
const DTYPE_SUFFIX: Record<string, string> = {
  fp32: '',
  fp16: '_fp16',
  int8: '_int8',
  uint8: '_uint8',
  q8: '_quantized',
  q4: '_q4',
  q4f16: '_q4f16',
  bnb4: '_bnb4',
};

function dtypeForFile(file: string, dtype: string | Record<string, string>): string {
  if (typeof dtype === 'string') return dtype;
  return dtype[file] ?? 'fp32'; // matches loader default
}

function onnxFilename(basename: string, dt: string): string {
  return `${basename}${DTYPE_SUFFIX[dt] ?? ''}.onnx`;
}

/**
 * Computes the ONNX files that the active dtype will load. Whisper-family
 * pipelines accept EITHER the merged decoder OR the (decoder + decoder_with_past)
 * pair — so we list both decoder layouts and require either to be complete.
 * Moonshine uses the same naming, so this works uniformly.
 */
function expectedOnnxFiles(dtype: string | Record<string, string>) {
  const enc = onnxFilename('encoder_model', dtypeForFile('encoder_model', dtype));
  const merged = onnxFilename('decoder_model_merged', dtypeForFile('decoder_model_merged', dtype));
  const split = [
    onnxFilename('decoder_model', dtypeForFile('decoder_model', dtype)),
    onnxFilename('decoder_with_past_model', dtypeForFile('decoder_with_past_model', dtype)),
  ];
  return { encoder: enc, decoderOptions: [[merged], split] };
}

const EXTERNAL_DATA_SCAN_LIMIT_BYTES = 8 * 1024 * 1024;

function externalDataRequirements(onnxFile: string): Map<string, number> {
  const stat = fs.statSync(onnxFile);
  if (stat.size > EXTERNAL_DATA_SCAN_LIMIT_BYTES) return new Map();

  const body = fs.readFileSync(onnxFile).toString('latin1');
  const requirements = new Map<string, number>();
  const re = /location[\s\S]{0,80}?([A-Za-z0-9_.-]+\.onnx_data)[\s\S]{0,80}?offset[\s\S]{0,30}?(\d+)[\s\S]{0,80}?length[\s\S]{0,30}?(\d+)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(body))) {
    const fileName = match[1];
    const offset = Number(match[2]);
    const length = Number(match[3]);
    if (!Number.isFinite(offset) || !Number.isFinite(length)) continue;
    requirements.set(fileName, Math.max(requirements.get(fileName) ?? 0, offset + length));
  }

  return requirements;
}

export function hasRequiredExternalData(onnxFile: string): boolean {
  try {
    const requirements = externalDataRequirements(onnxFile);
    if (requirements.size === 0) return true;

    const dir = path.dirname(onnxFile);
    for (const [fileName, requiredBytes] of requirements) {
      const dataPath = path.join(dir, fileName);
      if (!fs.existsSync(dataPath)) return false;
      if (fs.statSync(dataPath).size < requiredBytes) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function hasOnnxFile(onnxDir: string, fileName: string): boolean {
  const filePath = path.join(onnxDir, fileName);
  return fs.existsSync(filePath) && hasRequiredExternalData(filePath);
}

/**
 * Returns true when the cache contains the ONNX files the active dtype will
 * actually load. When `dtype` is omitted (legacy callers), falls back to a
 * directory-non-empty check — preserves the previous contract.
 *
 * This guards against the "available in panel but downloads mid-recording"
 * regression: a v2-cached model has only `_quantized.onnx` files, while the
 * new dtype config (Apple Silicon = fp32 encoder, mixed elsewhere) requires
 * a different filename. Without this check the loader silently fetches the
 * missing variant on first use, blocking start() for 30–90s.
 */
export function isModelCached(modelId: WhisperModelId, dtype?: string | Record<string, string>): boolean {
  const cacheDir = getModelsDir();
  const modelDir = path.join(cacheDir, modelIdToCacheDir(modelId));
  if (!fs.existsSync(modelDir)) return false;

  if (!dtype) {
    try { return fs.readdirSync(modelDir).length > 0; } catch { return false; }
  }

  const onnxDir = path.join(modelDir, 'onnx');
  if (!fs.existsSync(onnxDir)) return false;

  const { encoder, decoderOptions } = expectedOnnxFiles(dtype);
  if (!hasOnnxFile(onnxDir, encoder)) return false;
  return decoderOptions.some(opt => opt.every(f => hasOnnxFile(onnxDir, f)));
}

/**
 * Returns the full catalog with live status based on the filesystem.
 * Status reflects whether the files for the platform's active dtype are
 * cached — not just "any file in the directory".
 */
export function getAvailableModels(): WhisperModelInfo[] {
  // Resolve the active dtype lazily — avoids importing inferenceConfig at
  // module top (which would break the modelPreloader → modelManager require
  // chain on platforms where process info isn't yet available).
  return MODEL_CATALOG.map(m => {
    let dtype: string | Record<string, string> | undefined;
    try {
      const { resolveInferenceConfig } = require('./inferenceConfig');
      dtype = resolveInferenceConfig(undefined, m.id).dtype;
    } catch {
      dtype = undefined;
    }
    const modelDir = path.join(getModelsDir(), modelIdToCacheDir(m.id));
    const partialBytes = directorySize(modelDir);
    const available = isModelCached(m.id, dtype);
    return {
      ...m,
      status: available ? 'available' : 'missing',
      partial: !available && partialBytes > 0,
      partialBytes,
      multilingual: isMultilingualWhisperModel(m.id),
    };
  });
}

function directorySize(root: string): number {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    try {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(fullPath);
        else if (entry.isFile()) total += fs.statSync(fullPath).size;
      }
    } catch {
      // A concurrent downloader may be replacing a temporary file.
    }
  }
  return total;
}

/**
 * Deletes a downloaded model from the cache directory.
 */
export function deleteModel(modelId: WhisperModelId): void {
  const cacheDir = getModelsDir();
  const modelDir = path.join(cacheDir, modelIdToCacheDir(modelId));
  if (fs.existsSync(modelDir)) {
    fs.rmSync(modelDir, { recursive: true, force: true });
    console.log(`[modelManager] Deleted model: ${modelId}`);
  }
}
