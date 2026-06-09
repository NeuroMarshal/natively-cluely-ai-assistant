// @huggingface/transformers is ESM-only — must use dynamic import()
import path from 'path';
import { app } from 'electron';
import { IEmbeddingProvider } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';
import {
  BUNDLED_EMBEDDING_MODEL_ID,
  DEFAULT_EMBEDDING_MODEL_ID,
  getEmbeddingModelEntry,
  getEmbeddingModelsDir,
  isEmbeddingModelCached,
  type EmbeddingModelInfo,
} from '../embeddingModelManager';
import {
  readRuntimePreference,
  resolveLocalEmbeddingInferenceConfig,
} from '../../audio/whisper/inferenceConfig';

/**
 * On-device embedding provider backed by a transformers.js feature-extraction
 * model. The model is selectable (see embeddingModelManager): the bundled
 * MiniLM ships in resources for an offline guarantee, while multilingual models
 * are downloaded into userData/embedding-models. Asymmetric models (e5 family)
 * apply query/passage prefixes; pooling + dimensionality come from the catalog.
 */
export class LocalEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'local';
  readonly model: string;
  readonly dimensions: number;
  readonly space: string;

  private readonly entry: EmbeddingModelInfo;
  private readonly bundled: boolean;
  private pipe: any = null;
  private loadingPromise: Promise<void> | null = null; // prevents concurrent init races
  private bundledModelsRoot: string;
  private activeDevice: 'cpu' | 'webgpu' = 'cpu';

  constructor(modelId: string = DEFAULT_EMBEDDING_MODEL_ID) {
    // Resolve to the requested model when its weights exist; otherwise fall back
    // to the bundled model so embeddings always work (download pending/failed).
    const resolvedId = isEmbeddingModelCached(modelId) ? modelId : BUNDLED_EMBEDDING_MODEL_ID;
    this.entry = getEmbeddingModelEntry(resolvedId)
      ?? getEmbeddingModelEntry(BUNDLED_EMBEDDING_MODEL_ID)!;
    this.model = this.entry.id;
    this.dimensions = this.entry.dimensions;
    this.bundled = !!this.entry.bundled;
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });

    // In dev: app.getAppPath()/resources; in prod: process.resourcesPath.
    this.bundledModelsRoot = path.join(
      app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'),
      'models',
    );
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureLoaded();
      return true;
    } catch (e) {
      console.error(`[LocalEmbeddingProvider] Model failed to load (${this.model}):`, e);
      return false;
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.pipe) return;
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }

    this.loadingPromise = (async () => {
      // new Function() forces a real ESM import() at runtime (TS would otherwise
      // rewrite it to require(), which fails for this ESM-only package).
      const { pipeline, env } = await (new Function('return import("@huggingface/transformers")')()) as any;

      // Never reach out to the network at inference time. Downloads are an
      // explicit, separate step (embedding-model-start-download IPC). Both bundled
      // and downloaded models are read as LOCAL models (localModelPath + flat
      // `<root>/<org>/<name>` layout) so loading stays fully offline.
      env.allowRemoteModels = false;
      env.localModelPath = this.bundled ? this.bundledModelsRoot : getEmbeddingModelsDir();

      const runtime = readRuntimePreference();
      const inference = resolveLocalEmbeddingInferenceConfig();
      const load = (device: string, sessionOptions?: Record<string, unknown>) =>
        pipeline('feature-extraction', this.model, {
          local_files_only: true,
          device,
          session_options: sessionOptions,
        });

      try {
        this.pipe = await load(inference.device, inference.sessionOptions);
        this.activeDevice = inference.backend;
      } catch (error) {
        if (runtime !== 'auto' || inference.backend === 'cpu') throw error;
        console.warn(
          `[LocalEmbeddingProvider] WebGPU load failed for ${this.model}; retrying on CPU:`,
          (error as Error)?.message || error,
        );
        this.pipe = await load('cpu');
        this.activeDevice = 'cpu';
      }
    })();

    try {
      await this.loadingPromise;
    } catch (e) {
      this.loadingPromise = null; // allow retry
      throw e;
    }
  }

  private async run(text: string): Promise<number[]> {
    await this.ensureLoaded();
    const output = await this.pipe(text, { pooling: this.entry.pooling, normalize: true });
    return Array.from(output.data as Float32Array);
  }

  /** Embed a DOCUMENT/passage (applies the passage prefix for asymmetric models). */
  async embed(text: string): Promise<number[]> {
    return this.run(this.entry.passagePrefix + text);
  }

  /** Embed a QUERY (applies the query prefix for asymmetric models). */
  async embedQuery(text: string): Promise<number[]> {
    return this.run(this.entry.queryPrefix + text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureLoaded();
    const prefixed = texts.map(t => this.entry.passagePrefix + t);
    const output = await this.pipe(prefixed, { pooling: this.entry.pooling, normalize: true });
    const result: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      result.push(Array.from(output.data.slice(i * this.dimensions, (i + 1) * this.dimensions)));
    }
    return result;
  }

  getRuntimeInfo(): { requested: 'auto' | 'gpu' | 'cpu'; activeDevice: string; model: string } {
    return {
      requested: readRuntimePreference(),
      activeDevice: this.activeDevice,
      model: this.model,
    };
  }

  async dispose(): Promise<void> {
    const current = this.pipe;
    this.pipe = null;
    this.loadingPromise = null;
    try {
      await current?.dispose?.();
    } catch {
      // Session teardown is best-effort.
    }
  }
}
