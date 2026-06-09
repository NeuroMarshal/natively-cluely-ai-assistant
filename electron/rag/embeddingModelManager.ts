// electron/rag/embeddingModelManager.ts
//
// Local embedding-model catalog + filesystem manager. Mirrors the local-Whisper
// model system (electron/audio/whisper/modelManager.ts): a curated set of
// transformers.js (Xenova ONNX) feature-extraction models that are downloaded
// DIRECTLY into the user's data dir — NOT pulled through Ollama. This keeps the
// embedding model fully internal to RAG/knowledge search: it powers semantic
// search over the local knowledge DB and can never leak into the chat ("active")
// model selector the way an Ollama-pulled nomic-embed-text did.
//
// Each model is its own embedding "space" (provider+model+dims); switching the
// active model changes the space, which the existing re-index machinery detects
// and re-embeds against automatically.

import path from 'path';
import fs from 'fs';
import { hasRequiredExternalData } from '../audio/whisper/modelManager';

export type EmbeddingPooling = 'mean' | 'cls';

export interface EmbeddingModelInfo {
  /** transformers.js model id, e.g. 'Xenova/multilingual-e5-base'. */
  id: string;
  /** Human label for the UI. */
  name: string;
  /** Output vector dimensionality. Drives the per-dimension vec table. */
  dimensions: number;
  /** Approximate on-disk download size (quantized ONNX), in MB. */
  sizeMb: number;
  /** Whether the model is genuinely multilingual. */
  multilingual: boolean;
  /** Short language descriptor for the UI. */
  languages: string;
  /** Pooling strategy transformers.js should apply over token embeddings. */
  pooling: EmbeddingPooling;
  /**
   * Prefixes for asymmetric models (e5 family). Documents are embedded with
   * passagePrefix, queries with queryPrefix. Empty string = symmetric model.
   */
  queryPrefix: string;
  passagePrefix: string;
  /** Bundled in app resources/models → always available offline, never deletable. */
  bundled?: boolean;
  /** Live status, filled by getAvailableEmbeddingModels(). */
  status?: 'available' | 'missing' | 'downloading' | 'error';
  partial?: boolean;
  partialBytes?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  currentFile?: string;
}

// The bundled offline-guarantee model. Shipped under resources/models so the
// knowledge search always works on first launch with zero downloads.
export const BUNDLED_EMBEDDING_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

// Default ACTIVE model. Multilingual; downloaded on demand. Until it is present,
// the resolver transparently falls back to the bundled model above.
export const DEFAULT_EMBEDDING_MODEL_ID = 'Xenova/multilingual-e5-base';

const MODEL_CATALOG: EmbeddingModelInfo[] = [
  // Bundled — English-centric but works offline immediately. Symmetric.
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    name: 'MiniLM L6 v2',
    dimensions: 384, sizeMb: 25, multilingual: false, languages: 'English',
    pooling: 'mean', queryPrefix: '', passagePrefix: '', bundled: true,
  },
  // multilingual-e5-small — asymmetric (query:/passage: prefixes).
  {
    id: 'Xenova/multilingual-e5-small',
    name: 'Multilingual E5 Small',
    dimensions: 384, sizeMb: 120, multilingual: true, languages: '100+ languages',
    pooling: 'mean', queryPrefix: 'query: ', passagePrefix: 'passage: ',
  },
  // paraphrase-multilingual-MiniLM — symmetric, strong sentence similarity.
  {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    name: 'Paraphrase Multilingual MiniLM',
    dimensions: 384, sizeMb: 135, multilingual: true, languages: '50+ languages',
    pooling: 'mean', queryPrefix: '', passagePrefix: '',
  },
  // multilingual-e5-base — DEFAULT. Asymmetric, best retrieval quality here.
  {
    id: 'Xenova/multilingual-e5-base',
    name: 'Multilingual E5 Base',
    dimensions: 768, sizeMb: 280, multilingual: true, languages: '100+ languages',
    pooling: 'mean', queryPrefix: 'query: ', passagePrefix: 'passage: ',
  },
  // bge-m3 — heavy, very strong multilingual. CLS pooling, symmetric.
  {
    id: 'Xenova/bge-m3',
    name: 'BGE-M3 (large)',
    dimensions: 1024, sizeMb: 600, multilingual: true, languages: '100+ languages',
    pooling: 'cls', queryPrefix: '', passagePrefix: '',
  },
];

/** Directory where downloaded embedding models live (persists across updates). */
export function getEmbeddingModelsDir(): string {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'embedding-models');
}

/** Path to the bundled models root (resources/models in prod, ./resources in dev). */
function getBundledModelsRoot(): string {
  const { app } = require('electron');
  return path.join(
    app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'),
    'models',
  );
}

/**
 * Point @huggingface/transformers at our embedding cache dir and allow remote
 * fetches (used only by the explicit download path). Inference sets
 * local_files_only itself, so this does not cause silent downloads at query time.
 * ESM-only package → new Function() to dodge TS's import()→require() rewrite.
 */
export function configureEmbeddingCache(): void {
  (new Function('return import("@huggingface/transformers")')() as Promise<{ env: any }>)
    .then(({ env }) => {
      env.cacheDir = getEmbeddingModelsDir();
      env.allowRemoteModels = true;
    })
    .catch(() => {});
}

export function getEmbeddingModelEntry(id: string): EmbeddingModelInfo | undefined {
  return MODEL_CATALOG.find(m => m.id === id);
}

export function isKnownEmbeddingModel(id: unknown): id is string {
  return typeof id === 'string' && MODEL_CATALOG.some(model => model.id === id);
}

/** True if the model's ONNX weights are present (in the cache dir, or bundled). */
export function isEmbeddingModelCached(id: string): boolean {
  const entry = getEmbeddingModelEntry(id);

  // A model counts as cached only when at least one .onnx file is COMPLETE —
  // i.e. any external `.onnx_data` weights it references are present and full
  // size. Large fp32 exports (bge-m3, e5) keep weights in a separate
  // .onnx_data; an interrupted download leaves the tiny graph stub without it,
  // which would otherwise be reported "available" and then fail at query time.
  const hasCompleteOnnxIn = (dir: string): boolean => {
    try {
      return fs.readdirSync(dir).some(
        f => f.endsWith('.onnx') && hasRequiredExternalData(path.join(dir, f)),
      );
    } catch {
      return false;
    }
  };

  const hasOnnx = (modelDir: string): boolean => {
    if (!fs.existsSync(modelDir)) return false;
    const onnxDir = path.join(modelDir, 'onnx');
    // onnx/ subfolder is the common layout; some exports keep the .onnx at root.
    return hasCompleteOnnxIn(onnxDir) || hasCompleteOnnxIn(modelDir);
  };

  // Bundled models ship in resources/models and are always considered available.
  if (entry?.bundled && hasOnnx(path.join(getBundledModelsRoot(), id))) return true;

  return hasOnnx(path.join(getEmbeddingModelsDir(), id));
}

/** Catalog with live filesystem status. */
export function getAvailableEmbeddingModels(): EmbeddingModelInfo[] {
  return MODEL_CATALOG.map(m => {
    const available = isEmbeddingModelCached(m.id);
    const partialBytes = m.bundled ? 0 : directorySize(path.join(getEmbeddingModelsDir(), m.id));
    return {
      ...m,
      status: available ? 'available' : 'missing',
      partial: !available && partialBytes > 0,
      partialBytes,
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
      // Download workers may replace temporary files while status is read.
    }
  }
  return total;
}

/** Delete a downloaded model. Bundled models are protected (never deleted). */
export function deleteEmbeddingModel(id: string): void {
  const entry = getEmbeddingModelEntry(id);
  if (entry?.bundled) return; // bundled = the offline guarantee; keep it
  const modelDir = path.join(getEmbeddingModelsDir(), id);
  if (fs.existsSync(modelDir)) {
    fs.rmSync(modelDir, { recursive: true, force: true });
    console.log(`[embeddingModelManager] Deleted model: ${id}`);
  }
}

/**
 * The model id the embedding pipeline should actually load right now: the user's
 * selection if its weights are present, otherwise the bundled model so search
 * never breaks while a download is pending or failed.
 */
export function resolveActiveEmbeddingModelId(selected: string | undefined | null): string {
  const wanted = isKnownEmbeddingModel(selected) ? selected : DEFAULT_EMBEDDING_MODEL_ID;
  if (isEmbeddingModelCached(wanted)) return wanted;
  return BUNDLED_EMBEDDING_MODEL_ID;
}
