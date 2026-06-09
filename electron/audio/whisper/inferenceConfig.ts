/**
 * Resolves the optimal ONNX Runtime execution providers and per-module
 * quantization (dtype) strategy for the current platform at runtime.
 *
 * Per-module dtype is the documented Whisper-safe configuration: keep the
 * encoder at fp32 (Whisper's encoder is extremely sensitive to quantization
 * — known to degrade WER several percentage points when run at int8) while
 * quantizing the decoder to q8 (decoder is token-level, much more robust to
 * quantization and dominates inference time, so the speedup is large).
 *
 * Native GPU inference uses onnxruntime-node's WebGPU EP. transformers.js
 * 3.8.x does not accept `device: 'webgpu'` in Node yet, so we keep the
 * transformers device as `cpu` and force the real backend with ONNX Runtime
 * session options.
 */
export type SttRuntimePreference = 'auto' | 'gpu' | 'cpu';
export type LocalInferenceBackend = 'webgpu' | 'cpu';

export interface InferenceConfig {
    backend: LocalInferenceBackend;
    executionProviders: string[];
    // transformers.js 3.8.1 validates the device before it merges explicit
    // session options and does not recognize the native Node WebGPU EP yet.
    // Keep this as `cpu` and select the real EP through executionProviders.
    device: string;
    // String → single dtype for all ONNX files (e.g. 'fp32', 'q8', 'q4').
    // Record  → per-file dtype keyed by ONNX basename without suffix:
    //           'encoder_model', 'decoder_model_merged',
    //           'decoder_model', 'decoder_with_past_model'.
    dtype: string | Record<string, string>;
    sessionOptions?: {
        executionProviders?: Array<string | { name: string }>;
        enableMemPattern?: boolean;
        executionMode?: 'sequential' | 'parallel';
        graphOptimizationLevel?: 'basic' | 'all' | 'disabled' | 'extended';
    };
}

/**
 * Whisper-safe per-module dtype map. Applies to Whisper, Distil-Whisper, and
 * Moonshine — all three use the same encoder/decoder ONNX file naming.
 *
 *   encoder_model            → fp32  (preserves acoustic encoder accuracy)
 *   decoder_model            → q8    (token decoder; quantizing here is the
 *   decoder_model_merged     → q8     standard speedup with negligible WER cost)
 *   decoder_with_past_model  → q8
 *
 * The Record acts as a SUPERSET — keys that don't match any of the loaded
 * model's actual ONNX files are silently ignored by the loader, so a single
 * map can serve all three model families (Whisper uses merged decoder,
 * Moonshine uses separate decoder + with_past, etc.).
 */
const WHISPER_SAFE_DTYPE: Record<string, string> = {
    encoder_model: 'fp32',
    decoder_model: 'q8',
    decoder_model_merged: 'q8',
    decoder_with_past_model: 'q8',
};

/**
 * Construct the worker `init` message for a given model. Single source of
 * truth — three callers (LocalWhisperSTT.spawnWorker, modelPreloader.preload,
 * local-whisper-start-download IPC) all use this so the message shape stays
 * consistent. The cacheDir lookup is lazy (avoids importing electron from
 * this leaf module).
 */
export function buildWorkerInitMessage(modelId: string, opts?: { forceCpu?: boolean; allowRemoteModels?: boolean }): {
    type: 'init';
    modelId: string;
    cacheDir: string;
    executionProviders: string[];
    device: string;
    runtimeBackend: LocalInferenceBackend;
    dtype: string | Record<string, string>;
    sessionOptions?: InferenceConfig['sessionOptions'];
    allowRemoteModels: boolean;
    allowCpuFallback: boolean;
} {
    // Late require — modelManager imports electron, which isn't available
    // when this module is first loaded in some contexts (test harnesses).
    const { getModelsDir } = require('./modelManager');
    // Download/repair validation forces CPU so it strictly tests file
    // integrity — a flaky GPU driver must not fail an otherwise-valid model.
    const runtime: SttRuntimePreference = opts?.forceCpu ? 'cpu' : readRuntimePreference();
    const { backend, executionProviders, device, dtype, sessionOptions } = resolveInferenceConfig(runtime, modelId);
    return {
        type: 'init',
        modelId,
        cacheDir: getModelsDir(),
        executionProviders,
        device,
        runtimeBackend: backend,
        dtype,
        sessionOptions,
        allowRemoteModels: opts?.allowRemoteModels === true,
        allowCpuFallback: runtime === 'auto',
    };
}

/**
 * Reads the user's STT runtime preference from settings. Defaults to 'auto'
 * (GPU-first with CPU fallback). Best-effort — falls back to 'auto' if the
 * settings layer is unavailable (e.g. unit tests, early boot).
 */
export function readRuntimePreference(): SttRuntimePreference {
    const override = process.env.NATIVELY_LOCAL_AI_RUNTIME_OVERRIDE;
    if (override === 'cpu' || override === 'gpu' || override === 'auto') {
        return override;
    }
    try {
        const { SettingsManager } = require('../../services/SettingsManager');
        const settings = SettingsManager.getInstance();
        const pref = settings.get('localAiRuntime') ?? settings.get('sttRuntime');
        if (pref === 'cpu' || pref === 'gpu' || pref === 'auto') return pref;
    } catch {
        // settings unavailable — fall through to default
    }
    return 'auto';
}

export function resolveInferenceConfig(runtime: SttRuntimePreference = 'auto', modelId?: string): InferenceConfig {
    const { platform, arch } = process;
    const dtype = resolveWhisperDtype(modelId);

    // Explicit CPU, or Auto on a build without the native WebGPU EP.
    if (runtime === 'cpu' || (runtime === 'auto' && !isNativeWebGpuBundled())) {
        if (platform === 'darwin' && arch === 'arm64') {
            return { backend: 'cpu', executionProviders: ['cpu'], device: 'cpu', dtype: 'fp32' };
        }
        return {
            backend: 'cpu',
            executionProviders: ['cpu'],
            device: 'cpu',
            dtype,
            sessionOptions: cpuSessionOptions(),
        };
    }

    // Native WebGPU is provided by onnxruntime-node and runs through Dawn.
    // Keep CPU second for unsupported individual operators. Auto additionally
    // retries the complete model on CPU if WebGPU session creation fails.
    return {
        backend: 'webgpu',
        executionProviders: ['webgpu', 'cpu'],
        device: 'cpu',
        dtype,
        sessionOptions: webgpuSessionOptions(),
    };
}

/** Session options that force the native WebGPU EP with a CPU fallback. */
export function webgpuSessionOptions(): InferenceConfig['sessionOptions'] {
    return {
        executionProviders: ['webgpu', 'cpu'],
        enableMemPattern: false,
        executionMode: 'sequential',
        graphOptimizationLevel: 'basic',
    };
}

export function isNativeWebGpuBundled(): boolean {
    try {
        // Keep the native addon external to the esbuild bundle. A static
        // require makes esbuild traverse every platform-specific .node file.
        // Electron main does not always expose a global `require`, so use this
        // CommonJS module's own loader instead of `new Function('return require')`.
        const runtimeRequire = module.require.bind(module) as NodeRequire;
        const runtimePackage = ['onnxruntime', '-node'].join('');
        const { listSupportedBackends } = runtimeRequire(runtimePackage);
        return listSupportedBackends().some(
            (backend: { name?: string; bundled?: boolean }) =>
                backend.name === 'webgpu' && backend.bundled !== false,
        );
    } catch {
        return false;
    }
}

/**
 * Shared CPU session options for Whisper/Moonshine. Level-1 ('basic')
 * graph optimization avoids ORT 1.26's QDQ→MatMulNBits weight-transpose, which
 * rejects the tied decoder embed_tokens weight in HF's q8 Whisper exports
 * ('extended'/'all' throw; 'disabled' loads but is needlessly slow). Used for
 * explicit CPU and for Auto's clean-process CPU retry after WebGPU load errors.
 */
export function cpuSessionOptions(): InferenceConfig['sessionOptions'] {
    return {
        executionProviders: ['cpu'],
        enableMemPattern: false,
        executionMode: 'sequential',
        graphOptimizationLevel: 'basic',
    };
}

export function resolveLocalEmbeddingInferenceConfig(): Pick<InferenceConfig, 'backend' | 'device' | 'sessionOptions'> {
    const runtime = readRuntimePreference();
    if (runtime === 'cpu' || (runtime === 'auto' && !isNativeWebGpuBundled())) {
        return { backend: 'cpu', device: 'cpu' };
    }
    return { backend: 'webgpu', device: 'cpu', sessionOptions: webgpuSessionOptions() };
}

function resolveWhisperDtype(_modelId?: string): string | Record<string, string> {
    return WHISPER_SAFE_DTYPE;
}
