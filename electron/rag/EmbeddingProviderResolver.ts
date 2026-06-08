import { IEmbeddingProvider } from './providers/IEmbeddingProvider';
import { LocalEmbeddingProvider } from './providers/LocalEmbeddingProvider';
import type { ProviderDataScopePolicy } from '../llm/ProviderRouter';
import { resolveActiveEmbeddingModelId } from './embeddingModelManager';

export interface AppAPIConfig {
  // Embeddings are LOCAL-ONLY in this fork: search over the local knowledge DB
  // never leaves the device. The selected on-device model is downloaded directly
  // via transformers.js (see embeddingModelManager), not pulled through Ollama —
  // so it can never surface in the chat ("active") model selector.
  localEmbeddingModel?: string;

  // ── Retained for call-site compatibility only; ignored for embedding
  // selection. Cloud/Ollama embedding providers were removed to keep the
  // knowledge base fully on-device. ──────────────────────────────────────────
  openaiKey?: string;
  geminiKey?: string;
  ollamaUrl?: string;
  providerDataScopes?: ProviderDataScopePolicy;
  geminiEmbeddingModel?: string;
  geminiEmbeddingDims?: number;
}

export class EmbeddingProviderResolver {
  /**
   * Returns the on-device embedding provider for the user-selected model. If the
   * selected model's weights are not present yet (download pending/failed), it
   * transparently falls back to the bundled MiniLM so embeddings always work.
   */
  static async resolve(config: AppAPIConfig): Promise<IEmbeddingProvider> {
    const modelId = resolveActiveEmbeddingModelId(config.localEmbeddingModel);
    const provider = new LocalEmbeddingProvider(modelId);

    if (await provider.isAvailable()) {
      console.log(`[EmbeddingProviderResolver] Selected local provider: ${provider.model} (${provider.dimensions}d)`);
      return provider;
    }

    // isAvailable() only fails if the model files are corrupt — a fatal install error.
    throw new Error(
      `Local embedding model "${provider.model}" failed to load. The bundled model may be corrupted — please reinstall.`,
    );
  }
}
