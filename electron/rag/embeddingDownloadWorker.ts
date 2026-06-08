import { parentPort } from 'worker_threads';

if (!parentPort) throw new Error('embeddingDownloadWorker must run in a Worker thread');

parentPort.on('message', async (msg: { modelId?: string; cacheDir?: string }) => {
  if (!msg?.modelId || !msg?.cacheDir) {
    parentPort!.postMessage({ type: 'error', message: 'modelId and cacheDir are required' });
    return;
  }

  try {
    const { pipeline, env } = await (new Function(
      'return import("@huggingface/transformers")',
    )() as Promise<any>);

    env.cacheDir = msg.cacheDir;
    env.allowRemoteModels = true;

    const fileProgress = new Map<string, { loaded: number; total: number }>();
    const pipe = await pipeline('feature-extraction', msg.modelId, {
      progress_callback: (event: any) => {
        if (event?.status !== 'progress' || !event.file) return;
        fileProgress.set(event.file, {
          loaded: Number(event.loaded) || 0,
          total: Number(event.total) || 0,
        });
        let loaded = 0;
        let total = 0;
        for (const file of fileProgress.values()) {
          loaded += file.loaded;
          total += file.total;
        }
        parentPort!.postMessage({
          type: 'progress',
          progress: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
        });
      },
    });

    try {
      await pipe?.dispose?.();
    } catch {
      // The cache is complete even if the optional inference-session cleanup fails.
    }
    parentPort!.postMessage({ type: 'ready' });
  } catch (error: any) {
    parentPort!.postMessage({ type: 'error', message: error?.message || 'Download failed' });
  }
});
