import React, { useCallback, useEffect, useState } from 'react';
import { Cpu, FlaskConical, Loader2, Sparkles, Zap } from 'lucide-react';

type Runtime = 'auto' | 'gpu' | 'cpu';

interface RuntimeInfo {
    runtime: Runtime;
    gpuAvailable: boolean;
    gpuBackend: 'webgpu';
}

const api = () => (window as any).electronAPI;

export function LocalAiRuntimePanel() {
    const [info, setInfo] = useState<RuntimeInfo | null>(null);
    const [busy, setBusy] = useState(false);
    const [testResult, setTestResult] = useState<any>(null);

    const refresh = useCallback(async () => {
        const result = await api()?.localAiGetRuntime?.();
        if (result) setInfo(result);
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const setRuntime = async (runtime: Runtime) => {
        if (!info || busy || runtime === info.runtime) return;
        const previous = info;
        setInfo({ ...info, runtime });
        setBusy(true);
        setTestResult(null);
        try {
            const result = await api()?.localAiSetRuntime?.(runtime);
            if (!result?.success) setInfo(previous);
            await refresh();
        } finally {
            setBusy(false);
        }
    };

    const testRuntime = async () => {
        setBusy(true);
        setTestResult(null);
        try {
            setTestResult(await api()?.localAiTestRuntime?.());
        } finally {
            setBusy(false);
        }
    };

    if (!info) {
        return (
            <div className="flex justify-center p-5 text-text-tertiary">
                <Loader2 size={18} className="animate-spin" />
            </div>
        );
    }

    const options: Array<{ id: Runtime; label: string; icon: React.ReactNode }> = [
        { id: 'auto', label: 'Auto', icon: <Sparkles size={15} /> },
        { id: 'gpu', label: 'GPU', icon: <Zap size={15} /> },
        { id: 'cpu', label: 'CPU', icon: <Cpu size={15} /> },
    ];

    return (
        <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-sm font-bold text-text-primary">Local AI runtime</h3>
                    <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                        Shared compute device for speech recognition and knowledge embeddings.
                    </p>
                </div>
                <button
                    onClick={testRuntime}
                    disabled={busy}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-bg-input px-2.5 text-xs font-medium text-text-primary hover:bg-bg-elevated disabled:opacity-50"
                >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
                    Test
                </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
                {options.map((option) => (
                    <button
                        key={option.id}
                        onClick={() => setRuntime(option.id)}
                        disabled={busy}
                        className={`flex h-10 items-center justify-center gap-2 rounded-md border text-xs font-semibold transition-colors disabled:opacity-50 ${
                            info.runtime === option.id
                                ? 'border-accent-primary/50 bg-accent-primary/10 text-accent-primary'
                                : 'border-border-subtle bg-bg-input text-text-secondary hover:text-text-primary'
                        }`}
                    >
                        {option.icon}
                        {option.label}
                    </button>
                ))}
            </div>

            {!info.gpuAvailable && info.runtime !== 'cpu' && (
                <div className="mt-3 text-xs text-amber-500">
                    Native WebGPU is unavailable in this build. Auto uses CPU.
                </div>
            )}

            {testResult && (
                <div className={`mt-4 rounded-md border px-3 py-2 text-xs ${
                    testResult.success
                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
                        : 'border-amber-500/20 bg-amber-500/10 text-amber-500'
                }`}>
                    STT: {testResult.stt?.activeDevice ?? testResult.stt?.error ?? 'not tested'} · Embeddings:{' '}
                    {testResult.embeddings?.activeDevice ?? testResult.embeddings?.error ?? 'not tested'}
                </div>
            )}
        </div>
    );
}
