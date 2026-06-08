import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('embedding model manager mirrors Local Whisper lifecycle', () => {
  const manager = read('electron/rag/embeddingModelManager.ts');
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');

  assert.match(manager, /getEmbeddingModelsDir/);
  assert.match(manager, /getAvailableEmbeddingModels/);
  assert.match(manager, /deleteEmbeddingModel/);
  assert.match(manager, /resolveActiveEmbeddingModelId/);
  assert.match(ipc, /embedding-model-get-models/);
  assert.match(ipc, /embedding-model-set-model/);
  assert.match(ipc, /embedding-model-delete-model/);
  assert.match(ipc, /embedding-model-start-download/);
  assert.match(ipc, /embeddingDownloadWorker\.js/);
  assert.match(preload, /embeddingModelGetModels/);
});

test('embeddings are local-only and never bootstrap Ollama embedding models', () => {
  const main = read('electron/main.ts');
  const resolver = read('electron/rag/EmbeddingProviderResolver.ts');
  const llmCaps = read('electron/llm/modelCapabilities.ts');
  const llmHelper = read('electron/LLMHelper.ts');

  assert.doesNotMatch(main, /bootstrapOllamaEmbeddings|nomic-embed-text/);
  assert.doesNotMatch(resolver, /new OpenAIEmbeddingProvider|new GeminiEmbeddingProvider|new OllamaEmbeddingProvider/);
  assert.match(resolver, /new LocalEmbeddingProvider/);
  assert.match(llmCaps, /export function isEmbeddingModel/);
  assert.match(llmHelper, /\.filter\(\(name: string\) => !isEmbeddingModel\(name\)\)/);
});
