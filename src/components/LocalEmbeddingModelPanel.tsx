import React, { useState, useEffect, useCallback } from 'react';
import { Download, Trash2, HardDrive, Check, Loader2, Globe, AlertCircle, Languages } from 'lucide-react';

// Embedding models power semantic search over the local knowledge DB. They are
// downloaded DIRECTLY via transformers.js (like local Whisper) and run fully
// on-device — they are internal to RAG and never appear in the chat model list.

interface EmbeddingModelInfo {
    id: string;
    name: string;
    dimensions: number;
    sizeMb: number;
    multilingual: boolean;
    languages: string;
    bundled?: boolean;
    status: 'available' | 'missing' | 'downloading' | 'error';
    errorMessage?: string;
    partial?: boolean;
    partialBytes?: number;
    downloadProgress?: number;
    downloadedBytes?: number;
    totalBytes?: number;
    currentFile?: string;
}

const electronAPI = (window as any).electronAPI;

export function LocalEmbeddingModelPanel() {
    const [models, setModels] = useState<EmbeddingModelInfo[]>([]);
    const [activeModelId, setActiveModelId] = useState<string>('');
    const [selectedModelId, setSelectedModelId] = useState<string>('');
    const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
    const [downloadDetails, setDownloadDetails] = useState<Record<string, { loadedBytes?: number; totalBytes?: number; currentFile?: string }>>({});
    const [downloadingSet, setDownloadingSet] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
    const [panelError, setPanelError] = useState<string>('');

    const loadData = useCallback(async () => {
        try {
            const res = await electronAPI?.embeddingModelGetModels?.();
            if (res) {
                const nextModels = res.models ?? [];
                setModels(nextModels);
                setDownloadingSet(new Set(nextModels.filter((model: EmbeddingModelInfo) => model.status === 'downloading').map((model: EmbeddingModelInfo) => model.id)));
                setDownloadProgress(Object.fromEntries(nextModels.filter((model: EmbeddingModelInfo) => model.downloadProgress !== undefined).map((model: EmbeddingModelInfo) => [model.id, model.downloadProgress])));
                setDownloadDetails(Object.fromEntries(nextModels.map((model: EmbeddingModelInfo) => [model.id, {
                    loadedBytes: model.downloadedBytes,
                    totalBytes: model.totalBytes,
                    currentFile: model.currentFile,
                }])));
                setActiveModelId(res.activeModelId ?? '');
                setSelectedModelId(res.selectedModelId ?? res.activeModelId ?? '');
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    useEffect(() => {
        const unsubProgress = electronAPI?.onEmbeddingModelDownloadProgress?.((data: { modelId: string; progress: number; loadedBytes?: number; totalBytes?: number; currentFile?: string }) => {
            setDownloadProgress(prev => ({ ...prev, [data.modelId]: data.progress }));
            setDownloadDetails(prev => ({ ...prev, [data.modelId]: data }));
        });
        const unsubComplete = electronAPI?.onEmbeddingModelDownloadComplete?.((data: { modelId: string }) => {
            setDownloadingSet(prev => { const s = new Set(prev); s.delete(data.modelId); return s; });
            setDownloadProgress(prev => { const d = { ...prev }; delete d[data.modelId]; return d; });
            loadData();
        });
        const unsubError = electronAPI?.onEmbeddingModelDownloadError?.((data: { modelId: string; error: string }) => {
            setDownloadingSet(prev => { const s = new Set(prev); s.delete(data.modelId); return s; });
            setDownloadProgress(prev => { const d = { ...prev }; delete d[data.modelId]; return d; });
            setModels(prev => prev.map(m => m.id === data.modelId ? { ...m, status: 'error', errorMessage: data.error } : m));
        });
        return () => { unsubProgress?.(); unsubComplete?.(); unsubError?.(); };
    }, [loadData]);

    const handleDownload = async (modelId: string, repair = false) => {
        if (downloadingSet.has(modelId)) return;
        setDownloadingSet(prev => new Set([...prev, modelId]));
        setModels(prev => prev.map(m => m.id === modelId ? { ...m, status: 'downloading' } : m));
        setDownloadProgress(prev => ({ ...prev, [modelId]: 0 }));

        const result = await electronAPI?.embeddingModelStartDownload?.(modelId, { repair });
        if (!result?.success && result?.error !== 'already-downloading') {
            setDownloadingSet(prev => { const s = new Set(prev); s.delete(modelId); return s; });
            setDownloadProgress(prev => { const d = { ...prev }; delete d[modelId]; return d; });
            setModels(prev => prev.map(m => m.id === modelId
                ? { ...m, status: 'error', errorMessage: result?.error ?? 'Download failed' }
                : m
            ));
        }
    };

    const handleCancel = async (modelId: string) => {
        await electronAPI?.embeddingModelCancelDownload?.(modelId);
        setDownloadingSet(prev => { const next = new Set(prev); next.delete(modelId); return next; });
        await loadData();
    };

    const handleDelete = async (modelId: string) => {
        const result = await electronAPI?.embeddingModelDeleteModel?.(modelId);
        if (!result?.success) setPanelError(result?.error ?? 'Could not delete model');
        await loadData();
    };

    const handleActivate = async (modelId: string) => {
        setPanelError('');
        setSwitchingModelId(modelId);
        const result = await electronAPI?.embeddingModelSetModel?.(modelId);
        if (result?.success) {
            setActiveModelId(modelId);
            setSelectedModelId(modelId);
        } else {
            setPanelError(result?.error ?? 'Could not activate model');
            await loadData();
        }
        setSwitchingModelId(null);
    };

    if (loading) {
        return <div className="p-4 flex justify-center text-text-tertiary"><Loader2 className="animate-spin w-5 h-5" /></div>;
    }

    return (
        <div className="space-y-4">
            <div className="bg-bg-card rounded-xl border border-border-subtle overflow-hidden shadow-sm">
                <div className="px-5 py-4 bg-bg-elevated/50 border-b border-border-subtle">
                    <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                        <Languages size={15} className="opacity-70" /> Knowledge Base Search Model
                    </h3>
                    <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                        Multilingual embedding model that powers semantic search over your local knowledge base.
                        Downloaded and run fully on-device. Switching models re-indexes your knowledge in the background.
                    </p>
                </div>

                <div className="p-4 space-y-3 bg-bg-elevated/20">
                    {panelError && (
                        <div className="text-xs text-red-500 flex items-center gap-2">
                            <AlertCircle size={14} />
                            {panelError}
                        </div>
                    )}
                    {models.map(model => {
                        const isDownloading = model.status === 'downloading' || downloadingSet.has(model.id);
                        const progress = downloadProgress[model.id] || 0;
                        const isAvailable = model.status === 'available';
                        const isActive = activeModelId === model.id;
                        const isSelected = (selectedModelId || activeModelId) === model.id;
                        const details = downloadDetails[model.id] ?? {};
                        const transferred = details.loadedBytes && details.totalBytes
                            ? `${(details.loadedBytes / 1024 / 1024).toFixed(0)} / ${(details.totalBytes / 1024 / 1024).toFixed(0)} MB`
                            : '';

                        return (
                            <div key={model.id} className={`p-4 flex items-center justify-between bg-bg-card border rounded-[14px] transition-all duration-200 ${isSelected ? 'border-accent-primary/50 ring-1 ring-accent-primary/20' : 'border-border-subtle hover:border-border-muted hover:shadow-sm'}`}>
                                <div className="flex-1 min-w-0 pr-4">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <span className="text-sm font-medium text-text-primary truncate tracking-tight">{model.name}</span>
                                        {isActive && (
                                            <span className="px-1.5 py-0.5 rounded-[4px] bg-accent-primary/10 text-accent-primary text-[9px] font-bold uppercase tracking-wider">Active</span>
                                        )}
                                        {!isActive && isSelected && (
                                            <span className="px-1.5 py-0.5 rounded-[4px] bg-amber-500/10 text-amber-500 text-[9px] font-bold uppercase tracking-wider">Selected</span>
                                        )}
                                        {model.bundled && (
                                            <span className="px-1.5 py-0.5 rounded-[4px] bg-emerald-500/10 text-emerald-500 text-[9px] font-bold uppercase tracking-wider">Built-in</span>
                                        )}
                                        {model.multilingual && (
                                            <span className="px-1.5 py-0.5 rounded-[4px] bg-blue-500/10 text-blue-500 text-[9px] font-bold uppercase tracking-wider">Multilingual</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3.5 text-xs text-text-tertiary">
                                        <span className="flex items-center gap-1.5"><HardDrive size={13} className="opacity-70" /> {model.sizeMb} MB</span>
                                        <span className="flex items-center gap-1.5"><Globe size={13} className="opacity-70" /> {model.languages}</span>
                                        <span className="flex items-center gap-1.5 tabular-nums">{model.dimensions}d</span>
                                    </div>

                                    {isDownloading && (
                                        <div className="mt-3.5 pr-8">
                                            <div className="flex justify-between items-center text-[10px] text-text-secondary mb-1.5 uppercase tracking-wider font-semibold">
                                                <span className="max-w-[70%] truncate">{details.currentFile ? `Downloading ${details.currentFile}` : 'Downloading...'}</span>
                                                <span className="text-accent-primary tabular-nums">{Math.round(progress)}%</span>
                                            </div>
                                            <div className="w-full h-1.5 bg-bg-input rounded-full overflow-hidden shadow-inner ring-1 ring-inset ring-black/5 dark:ring-white/5">
                                                <div className="h-full bg-accent-primary transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
                                            </div>
                                            {transferred && <div className="mt-1 text-[10px] text-text-tertiary">{transferred}</div>}
                                        </div>
                                    )}

                                    {model.status === 'error' && (
                                        <div className="mt-2.5 text-xs text-red-500 flex items-center gap-1.5 font-medium bg-red-500/10 px-2.5 py-1.5 rounded-md inline-flex">
                                            <AlertCircle size={14} />
                                            {model.errorMessage || 'Failed to download model'}
                                        </div>
                                    )}
                                </div>

                                <div className="flex-shrink-0 flex items-center gap-2">
                                    {isAvailable && !isSelected && (
                                        <button
                                            onClick={() => handleActivate(model.id)}
                                            disabled={switchingModelId !== null}
                                            className="h-[34px] px-4 flex items-center gap-1.5 rounded-[8px] bg-bg-input hover:bg-bg-elevated border border-border-subtle text-text-primary text-[13px] font-semibold transition-all duration-300 active:scale-[0.96] disabled:opacity-50"
                                        >
                                            {switchingModelId === model.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                            Use
                                        </button>
                                    )}
                                    {!isAvailable && !isDownloading && (
                                        <>
                                            <button
                                                onClick={() => handleDownload(model.id)}
                                                className="h-[34px] px-4 flex items-center gap-1.5 rounded-[10px] bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary text-[13px] font-semibold transition-all duration-300 active:scale-[0.96] shadow-sm"
                                            >
                                                <Download size={14} /> {model.partial ? 'Resume' : 'Install'}
                                            </button>
                                            {model.partial && (
                                                <button
                                                    onClick={() => handleDownload(model.id, true)}
                                                    className="h-[34px] rounded-[10px] px-2.5 text-[11px] font-semibold text-text-tertiary hover:bg-bg-elevated hover:text-text-primary"
                                                >
                                                    Repair
                                                </button>
                                            )}
                                        </>
                                    )}
                                    {isDownloading && (
                                        <button
                                            onClick={() => handleCancel(model.id)}
                                            className="h-[34px] rounded-[10px] px-3 text-[12px] font-semibold text-text-secondary hover:bg-red-500/10 hover:text-red-500"
                                        >
                                            Cancel
                                        </button>
                                    )}
                                    {isAvailable && !model.bundled && (
                                        <button
                                            onClick={() => handleDelete(model.id)}
                                            disabled={isActive || isSelected}
                                            className="p-2 rounded-[10px] text-text-tertiary hover:bg-red-500/10 hover:text-red-500 transition-all duration-300 active:scale-[0.96] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                            title={isActive || isSelected ? 'Selected model can’t be deleted' : 'Delete model'}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
