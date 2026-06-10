import React, { useState, useEffect, useCallback } from 'react';
import { Download, Trash2, HardDrive, Check, Loader2, Zap, AlertCircle, Radio, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * LocalSttPanel — unified on-device STT model manager, grouped by ARCHITECTURE
 * into tabs: Whisper · Moonshine · Sherpa · Vosk.
 *
 * Whisper / Moonshine tabs are backed by the transformers.js pipeline (existing
 * localWhisper* IPC). Sherpa / Vosk tabs are backed by the native engines
 * (nativeStt* IPC). Selecting a model in any tab both picks the model AND
 * activates that engine (flips the sttProvider credential), so the tab is the
 * single source of truth for "which local engine is live".
 */

const electronAPI = (window as any).electronAPI;

interface ModelInfo {
    id: string;
    name: string;
    sizeMb: number;
    speed: string;
    accuracy: string;
    streaming?: boolean;
    languageLabel?: string;
    status: 'available' | 'missing' | 'downloading' | 'error';
    errorMessage?: string;
    partial?: boolean;
}

type EngineKey = 'whisper' | 'moonshine' | 'sherpa' | 'sensevoice' | 'parakeet' | 'vosk';
type Source = 'whisper' | 'native';

interface TabDef {
    key: EngineKey;
    label: string;
    source: Source;
    /** native engine filter (by architecture), or whisper catalog predicate */
    match: (m: any) => boolean;
    blurb: string;
}

const TABS: TabDef[] = [
    { key: 'whisper',    label: 'Whisper',    source: 'whisper', match: (m) => !String(m.id).toLowerCase().includes('moonshine'), blurb: 'OpenAI Whisper / Distil-Whisper. Accurate, multilingual, batch-style.' },
    { key: 'moonshine',  label: 'Moonshine',  source: 'whisper', match: (m) => String(m.id).toLowerCase().includes('moonshine'), blurb: 'Streaming-native, ultra-low latency. English only.' },
    { key: 'sherpa',     label: 'Sherpa',     source: 'native',  match: (m) => m.architecture === 'sherpa', blurb: 'sherpa-onnx: T-one (RU streaming), GigaAM (RU SOTA), Zipformer (EN/FR/ZH/KO).' },
    { key: 'sensevoice', label: 'SenseVoice', source: 'native',  match: (m) => m.architecture === 'sensevoice', blurb: 'FunASR SenseVoice — one model for Chinese, English, Japanese, Korean, Cantonese.' },
    { key: 'parakeet',   label: 'Parakeet',   source: 'native',  match: (m) => m.architecture === 'parakeet', blurb: 'NVIDIA Parakeet TDT — 25 European languages incl. Russian; streaming EN variant.' },
    { key: 'vosk',       label: 'Vosk',       source: 'native',  match: (m) => m.architecture === 'vosk', blurb: 'Vosk / Kaldi: compact streaming models, ~12 languages.' },
];

function speedLabel(s: string): string {
    return ({ 'very-fast': 'very fast', 'fast': 'fast', 'medium': 'medium', 'slow': 'slow' } as Record<string, string>)[s] || s;
}

export function LocalSttPanel() {
    const [activeTab, setActiveTab] = useState<EngineKey>('sherpa');
    const [loading, setLoading] = useState(true);

    // whisper-pipeline state
    const [whisperModels, setWhisperModels] = useState<ModelInfo[]>([]);
    const [whisperActiveId, setWhisperActiveId] = useState('');
    // native-engine state
    const [nativeModels, setNativeModels] = useState<any[]>([]);
    const [activeSherpa, setActiveSherpa] = useState('');
    const [activeVosk, setActiveVosk] = useState('');
    // which provider is currently live ('local-whisper' | 'native-sherpa' | 'native-vosk' | other)
    const [liveProvider, setLiveProvider] = useState<string>('');

    const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
    const [downloadingSet, setDownloadingSet] = useState<Set<string>>(new Set());

    const loadData = useCallback(async () => {
        try {
            const [w, n, creds] = await Promise.all([
                electronAPI?.localWhisperGetModels?.(),
                electronAPI?.nativeSttGetModels?.(),
                electronAPI?.getStoredCredentials?.(),
            ]);
            if (w) { setWhisperModels(w.models ?? []); setWhisperActiveId(w.activeModelId ?? ''); }
            if (n) { setNativeModels(n.models ?? []); setActiveSherpa(n.activeSherpaModel ?? ''); setActiveVosk(n.activeVoskModel ?? ''); }
            if (creds) setLiveProvider(creds.sttProvider ?? '');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    // Download progress wiring — both whisper and native channels.
    useEffect(() => {
        const subs = [
            electronAPI?.onLocalWhisperDownloadProgress?.((d: any) => setDownloadProgress(p => ({ ...p, [d.modelId]: d.progress }))),
            electronAPI?.onLocalWhisperDownloadComplete?.((d: any) => { setDownloadingSet(s => { const n = new Set(s); n.delete(d.modelId); return n; }); loadData(); }),
            electronAPI?.onLocalWhisperDownloadError?.((d: any) => { setDownloadingSet(s => { const n = new Set(s); n.delete(d.modelId); return n; }); setWhisperModels(ms => ms.map(m => m.id === d.modelId ? { ...m, status: 'error', errorMessage: d.error } : m)); }),
            electronAPI?.onNativeSttDownloadProgress?.((d: any) => setDownloadProgress(p => ({ ...p, [d.modelId]: d.progress }))),
            electronAPI?.onNativeSttDownloadComplete?.((d: any) => { setDownloadingSet(s => { const n = new Set(s); n.delete(d.modelId); return n; }); loadData(); }),
            electronAPI?.onNativeSttDownloadError?.((d: any) => { setDownloadingSet(s => { const n = new Set(s); n.delete(d.modelId); return n; }); setNativeModels(ms => ms.map((m: any) => m.id === d.modelId ? { ...m, status: 'error', errorMessage: d.error } : m)); }),
        ];
        return () => subs.forEach((u) => u?.());
    }, [loadData]);

    const tab = TABS.find(t => t.key === activeTab)!;
    const models: ModelInfo[] = tab.source === 'whisper'
        ? whisperModels.filter(tab.match)
        : nativeModels.filter(tab.match);

    const activeIdForTab = (): string => {
        if (tab.source === 'whisper') return liveProvider === 'local-whisper' ? whisperActiveId : '';
        if (tab.key === 'sherpa') return liveProvider === 'native-sherpa' ? activeSherpa : '';
        return liveProvider === 'native-vosk' ? activeVosk : '';
    };
    const selectedId = activeIdForTab();

    const startDownload = async (modelId: string, repair = false) => {
        setDownloadingSet(s => new Set([...s, modelId]));
        setDownloadProgress(p => ({ ...p, [modelId]: 0 }));
        const api = tab.source === 'whisper' ? electronAPI?.localWhisperStartDownload : electronAPI?.nativeSttStartDownload;
        const res = await api?.(modelId, { repair });
        if (!res?.success && res?.error !== 'already-downloading') {
            setDownloadingSet(s => { const n = new Set(s); n.delete(modelId); return n; });
            const setter = tab.source === 'whisper' ? setWhisperModels : (setNativeModels as any);
            setter((ms: any[]) => ms.map((m: any) => m.id === modelId ? { ...m, status: 'error', errorMessage: res?.error ?? 'Download failed' } : m));
        }
    };

    const cancelDownload = async (modelId: string) => {
        const api = tab.source === 'whisper' ? electronAPI?.localWhisperCancelDownload : electronAPI?.nativeSttCancelDownload;
        await api?.(modelId);
        setDownloadingSet(s => { const n = new Set(s); n.delete(modelId); return n; });
        await loadData();
    };

    const deleteModel = async (modelId: string) => {
        const api = tab.source === 'whisper' ? electronAPI?.localWhisperDeleteModel : electronAPI?.nativeSttDeleteModel;
        await api?.(modelId);
        await loadData();
    };

    // Selecting a model activates BOTH the model and its engine.
    const selectModel = async (modelId: string) => {
        if (tab.source === 'whisper') {
            await electronAPI?.localWhisperSetModel?.(modelId);
            await electronAPI?.setSttProvider?.('local-whisper');
        } else {
            // native-stt-set-model flips the sttProvider credential itself.
            await electronAPI?.nativeSttSetModel?.(modelId);
        }
        await loadData();
    };

    if (loading) {
        return <div className="p-4 flex justify-center text-text-tertiary"><Loader2 className="animate-spin w-5 h-5" /></div>;
    }

    return (
        <div className="space-y-4">
            {/* ── Architecture tabs ── */}
            <div className="bg-bg-card rounded-xl border border-border-subtle p-1.5 grid grid-cols-3 gap-1">
                {TABS.map(t => {
                    const isActive = t.key === activeTab;
                    return (
                        <button
                            key={t.key}
                            onClick={() => setActiveTab(t.key)}
                            className={`rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${isActive ? 'bg-accent-primary text-white shadow-sm' : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'}`}
                        >
                            {t.label}
                        </button>
                    );
                })}
            </div>

            <p className="text-xs text-text-tertiary px-1 leading-relaxed">{tab.blurb}</p>

            {/* ── Model list for the active architecture ── */}
            <div className="bg-bg-card rounded-xl border border-border-subtle overflow-hidden shadow-sm">
                <div className="p-4 space-y-3 bg-bg-elevated/20">
                    {models.length === 0 && (
                        <div className="px-3 py-6 text-sm text-text-tertiary italic text-center">No models for this engine</div>
                    )}
                    {models.map(model => {
                        const isDownloading = model.status === 'downloading' || downloadingSet.has(model.id);
                        const progress = downloadProgress[model.id] || 0;
                        const isAvailable = model.status === 'available';
                        const isSelected = selectedId === model.id;
                        return (
                            <div key={model.id} className={`p-4 bg-bg-card border rounded-[14px] transition-all duration-200 ${isSelected ? 'border-accent-primary/60 ring-1 ring-accent-primary/30' : 'border-border-subtle hover:border-border-muted'}`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex-1 min-w-0 pr-4">
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <span className="text-sm font-medium text-text-primary truncate tracking-tight">{model.name}</span>
                                            {model.languageLabel && (
                                                <span className="px-1.5 py-0.5 rounded-[4px] bg-bg-input text-text-secondary text-[9px] font-bold uppercase tracking-wider">{model.languageLabel}</span>
                                            )}
                                            {model.streaming && (
                                                <span className="px-1.5 py-0.5 rounded-[4px] bg-green-500/10 text-green-500 text-[9px] font-bold uppercase tracking-wider flex items-center gap-0.5"><Radio size={9} /> live</span>
                                            )}
                                            {isSelected && (
                                                <span className="px-1.5 py-0.5 rounded-[4px] bg-accent-primary/10 text-accent-primary text-[9px] font-bold uppercase tracking-wider">Active</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3.5 text-xs text-text-tertiary">
                                            <span className="flex items-center gap-1.5"><HardDrive size={13} className="opacity-70" /> {model.sizeMb} MB</span>
                                            <span className="flex items-center gap-1.5"><Zap size={13} className="opacity-70" /> {speedLabel(model.speed)}</span>
                                            <span className="flex items-center gap-1.5"><Check size={13} className="opacity-70" /> {model.accuracy} acc</span>
                                        </div>
                                        {isDownloading && (
                                            <div className="mt-3 pr-8">
                                                <div className="flex justify-between text-[10px] text-text-secondary mb-1 uppercase tracking-wider font-semibold">
                                                    <span>Downloading…</span><span className="text-accent-primary tabular-nums">{Math.round(progress)}%</span>
                                                </div>
                                                <div className="w-full h-1.5 bg-bg-input rounded-full overflow-hidden">
                                                    <div className="h-full bg-accent-primary transition-all duration-300" style={{ width: `${progress}%` }} />
                                                </div>
                                            </div>
                                        )}
                                        {model.status === 'error' && (
                                            <div className="mt-2.5 text-xs text-red-500 flex items-center gap-1.5 font-medium bg-red-500/10 px-2.5 py-1.5 rounded-md inline-flex">
                                                <AlertCircle size={14} /> {model.errorMessage || 'Failed to download'}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-shrink-0 flex items-center gap-2">
                                        {!isAvailable && !isDownloading && (
                                            <button onClick={() => startDownload(model.id, model.status === 'error')} className="h-[34px] px-4 flex items-center gap-1.5 rounded-[10px] bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary text-[13px] font-semibold transition-all active:scale-[0.96]">
                                                <Download size={14} /> <span>{model.partial ? 'Resume' : model.status === 'error' ? 'Repair' : 'Install'}</span>
                                            </button>
                                        )}
                                        {isDownloading && (
                                            <button onClick={() => cancelDownload(model.id)} className="h-[34px] rounded-[10px] px-3 text-[12px] font-semibold text-text-secondary hover:bg-red-500/10 hover:text-red-500">Cancel</button>
                                        )}
                                        {isAvailable && !isSelected && (
                                            <button onClick={() => selectModel(model.id)} className="h-[34px] px-4 rounded-[10px] bg-bg-input hover:bg-bg-elevated text-text-primary text-[13px] font-semibold transition-all active:scale-[0.96]">Use</button>
                                        )}
                                        {isAvailable && (
                                            <button onClick={() => deleteModel(model.id)} className="p-2 rounded-[10px] text-text-tertiary hover:bg-red-500/10 hover:text-red-500 transition-all active:scale-[0.96]" title="Delete model">
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-text-tertiary px-1">
                <Layers size={11} /> Active engine: <span className="text-text-secondary font-medium">{liveProvider === 'local-whisper' ? 'Whisper/Moonshine' : liveProvider === 'native-sherpa' ? 'Sherpa' : liveProvider === 'native-vosk' ? 'Vosk' : 'none selected'}</span>
            </div>
        </div>
    );
}
