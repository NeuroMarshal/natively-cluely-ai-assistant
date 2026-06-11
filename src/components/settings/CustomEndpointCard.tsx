import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Save, CheckCircle, AlertCircle, Loader2, Trash2, RefreshCw, ChevronDown, Check, Radio } from 'lucide-react';

/**
 * CustomEndpointCard — one card (Base URL + API Key + type toggle), behaving
 * exactly like the hardcoded provider cards (Gemini, etc.): once you Fetch
 * Models, every returned model is persisted and becomes a selectable "active
 * model" everywhere in the UI (settings Active Model dropdown + overlay model
 * picker). There is NO separate "apply & select" step — selecting a model from
 * the dropdown makes it the active model immediately.
 *
 * The chosen type decides which SDK client is re-pointed at the base URL on the
 * main process (see LLMHelper.setCustomEndpoint).
 */

const electronAPI = (window as any).electronAPI;

type EndpointType = 'openai' | 'claude';

export function CustomEndpointCard({ onSaved }: { onSaved?: () => void }) {
    const [type, setType] = useState<EndpointType>('openai');
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState('');           // active/selected model id
    const [customHeaders, setCustomHeaders] = useState('');
    const [hasStoredKey, setHasStoredKey] = useState(false);
    const [configured, setConfigured] = useState(false);
    const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState('');

    // Ping (reachability) + Fetch Models (dropdown), mirroring the hardcoded cards.
    const [pingStatus, setPingStatus] = useState<'idle' | 'pinging' | 'ok' | 'fail'>('idle');
    const [pingMsg, setPingMsg] = useState('');
    const [fetchedModels, setFetchedModels] = useState<{ id: string; label: string }[]>([]);
    const [isFetching, setIsFetching] = useState(false);
    const [fetchError, setFetchError] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, []);

    const endpointCfg = () => ({ type, baseUrl: baseUrl.trim(), apiKey: apiKey.includes('••') ? '' : apiKey });

    const load = useCallback(async () => {
        try {
            const creds = await electronAPI?.getStoredCredentials?.();
            const ep = creds?.customLlmEndpoint;
            if (ep) {
                setType(ep.type === 'claude' ? 'claude' : 'openai');
                setBaseUrl(ep.baseUrl || '');
                setModel(ep.model || '');
                setCustomHeaders(ep.customHeaders || '');
                setHasStoredKey(!!ep.hasApiKey);
                setApiKey(ep.hasApiKey ? 'sk-••••••••' : '');
                setConfigured(true);
                const list: string[] = ep.models?.length ? ep.models : (ep.model ? [ep.model] : []);
                setFetchedModels(list.map((id: string) => ({ id, label: id })));
            }
        } catch { /* noop */ }
    }, []);

    useEffect(() => { load(); }, [load]);

    /**
     * Persist the endpoint to the main process. This re-points the live SDK
     * client AND makes every model in `models` a selectable active model.
     * Returns true on success.
     */
    const persist = async (activeModel: string, models: string[]) => {
        const keyToSend = apiKey.includes('••') ? '' : apiKey;
        const res = await electronAPI?.setCustomLlmEndpoint?.({
            type,
            baseUrl: baseUrl.trim(),
            apiKey: keyToSend,
            model: activeModel.trim(),
            models,
            customHeaders: customHeaders.trim() || undefined,
        });
        if (res?.success) {
            setConfigured(true);
            if (keyToSend) { setHasStoredKey(true); setApiKey('sk-••••••••'); }
        }
        return !!res?.success;
    };

    const save = async () => {
        if (!baseUrl.trim() || !model.trim()) {
            setStatus('error'); setErrorMsg('Base URL and Model are required'); return;
        }
        setStatus('saving'); setErrorMsg('');
        try {
            const ok = await persist(model, fetchedModels.map(m => m.id));
            if (ok) {
                setStatus('saved');
                onSaved?.();
                setTimeout(() => setStatus('idle'), 1800);
            } else {
                setStatus('error'); setErrorMsg('Save failed');
            }
        } catch (e: any) {
            setStatus('error'); setErrorMsg(e?.message || 'Save failed');
        }
    };

    const clear = async () => {
        await electronAPI?.setCustomLlmEndpoint?.(null);
        setBaseUrl(''); setApiKey(''); setModel(''); setCustomHeaders(''); setHasStoredKey(false); setConfigured(false); setStatus('idle');
        setFetchedModels([]);
        onSaved?.();
    };

    const ping = async () => {
        if (!baseUrl.trim()) { setPingStatus('fail'); setPingMsg('Base URL required'); return; }
        setPingStatus('pinging'); setPingMsg('');
        try {
            const res = await electronAPI?.pingCustomEndpoint?.(endpointCfg());
            if (res?.success) { setPingStatus('ok'); setPingMsg(`reachable · ${res.modelCount ?? 0} models`); }
            else if (res?.reachable) { setPingStatus('ok'); setPingMsg(`reachable (auth: ${res.error})`); }
            else { setPingStatus('fail'); setPingMsg(res?.error || 'unreachable'); }
        } catch (e: any) { setPingStatus('fail'); setPingMsg(e?.message || 'unreachable'); }
        setTimeout(() => setPingStatus('idle'), 4000);
    };

    /**
     * Fetch the model list AND persist the endpoint with that full list, so the
     * models immediately appear in the Active Models selectors (just like
     * Gemini's "Fetch Models"). Auto-selects the first model if none is active.
     */
    const fetchModels = async () => {
        if (!baseUrl.trim()) { setFetchError('Base URL required'); return; }
        setIsFetching(true); setFetchError('');
        try {
            const res = await electronAPI?.fetchCustomEndpointModels?.(endpointCfg());
            if (res?.success && res.models?.length) {
                setFetchedModels(res.models);
                const ids = res.models.map((m: { id: string }) => m.id);
                const active = (model && ids.includes(model)) ? model : ids[0];
                setModel(active);
                // Persist so every fetched model becomes an active model everywhere.
                await persist(active, ids);
                onSaved?.();
            } else {
                setFetchError(res?.error || 'No models returned');
            }
        } catch (e: any) { setFetchError(e?.message || 'Fetch failed'); }
        finally { setIsFetching(false); }
    };

    /** Selecting a model makes it the active model immediately (no apply step). */
    const selectModel = async (id: string) => {
        setModel(id);
        setDropdownOpen(false);
        try {
            await persist(id, fetchedModels.map(m => m.id));
            await electronAPI?.setModel?.(id);          // make it the runtime model
            await electronAPI?.setDefaultModel?.(id);   // persist as default for new chats
            onSaved?.();
        } catch { /* noop */ }
    };

    const selectedLabel = fetchedModels.find(m => m.id === model)?.label || model;

    return (
        <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h4 className="text-sm font-bold text-text-primary">
                        Custom Endpoint
                        {configured && <span className="ml-2 text-green-500 text-[11px] font-medium">✓ Saved</span>}
                    </h4>
                    <p className="text-[11px] text-text-secondary mt-0.5">Route through a proxy / self-hosted / local IP (OmniRouter, LiteLLM, …).</p>
                </div>
                {configured && (
                    <button onClick={clear} className="p-2 rounded-lg text-text-tertiary hover:bg-red-500/10 hover:text-red-500 transition-colors" title="Remove custom endpoint">
                        <Trash2 size={15} />
                    </button>
                )}
            </div>

            {/* Type toggle: OpenAI / Claude */}
            <div className="grid grid-cols-2 gap-2">
                {(['openai', 'claude'] as EndpointType[]).map(t => (
                    <button
                        key={t}
                        onClick={() => setType(t)}
                        className={`rounded-lg px-3 py-2 text-xs font-semibold transition-all ${type === t ? 'bg-accent-primary text-white shadow-sm' : 'bg-bg-input text-text-secondary hover:bg-bg-elevated border border-border-subtle'}`}
                    >
                        {t === 'openai' ? 'OpenAI-compatible' : 'Claude (Anthropic)'}
                    </button>
                ))}
            </div>

            {/* Base URL */}
            <div>
                <label className="block text-[10px] font-medium text-text-secondary uppercase tracking-wide mb-1">Base URL</label>
                <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => { setBaseUrl(e.target.value); setPingStatus('idle'); }}
                    placeholder={type === 'openai' ? 'http://127.0.0.1:8080/v1' : 'http://127.0.0.1:8080'}
                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors font-mono"
                />
            </div>

            {/* API Key */}
            <div>
                <label className="block text-[10px] font-medium text-text-secondary uppercase tracking-wide mb-1">API Key</label>
                <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onFocus={() => { if (apiKey.includes('••')) setApiKey(''); }}
                    placeholder={hasStoredKey ? '•••• stored' : 'optional'}
                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                />
            </div>

            {/* Custom Headers (optional) — sent as HTTP headers on every request to this endpoint */}
            <div>
                <label className="block text-[10px] font-medium text-text-secondary uppercase tracking-wide mb-1">
                    Custom Headers <span className="text-text-tertiary normal-case">(optional)</span>
                </label>
                <textarea
                    value={customHeaders}
                    onChange={(e) => setCustomHeaders(e.target.value)}
                    rows={2}
                    placeholder={'One per line, e.g.\nX-Api-Key: sk-...\nUser-Agent: my-client/1.0'}
                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors font-mono resize-y"
                />
                <p className="mt-1 text-[10px] text-text-tertiary">Extra HTTP headers (Name: Value per line) added to every request to this endpoint.</p>
            </div>

            {/* Active model — manual entry until models are fetched; after Fetch
                the dropdown lists every model. The Fetch button lives in the
                action row below, mirroring the hardcoded provider cards. */}
            <div>
                <label className="block text-[10px] font-medium text-text-secondary uppercase tracking-wide mb-1">Active Model</label>
                <div ref={dropdownRef} className="relative">
                    {fetchedModels.length > 0 ? (
                        <button
                            type="button"
                            onClick={() => setDropdownOpen(o => !o)}
                            className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary flex items-center justify-between hover:bg-bg-elevated transition-colors font-mono"
                        >
                            <span className="truncate pr-2">{selectedLabel || 'Select model'}</span>
                            <ChevronDown size={14} className={`text-text-secondary transition-transform shrink-0 ${dropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                    ) : (
                        <input
                            type="text"
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            placeholder={type === 'openai' ? 'gpt-4o' : 'claude-3-5-sonnet'}
                            className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors font-mono"
                        />
                    )}
                    {dropdownOpen && fetchedModels.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-52 overflow-y-auto p-1 space-y-0.5">
                            {fetchedModels.map((m) => (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => selectModel(m.id)}
                                    className={`w-full text-left px-2.5 py-1.5 text-[11px] rounded-md flex items-center justify-between gap-2 font-mono transition-colors ${model === m.id ? 'bg-bg-input text-text-primary' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                >
                                    <span className="truncate">{m.label}</span>
                                    {model === m.id && <Check size={12} className="text-accent-primary shrink-0" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {fetchError && <p className="mt-1 text-[10px] text-red-500">{fetchError}</p>}
            </div>

            {status === 'error' && (
                <div className="text-xs text-red-500 flex items-center gap-1.5"><AlertCircle size={13} /> {errorMsg}</div>
            )}

            {/* Action row: Save · Ping · Fetch Models — same layout as the other cards */}
            <div className="flex items-center gap-2">
                <button
                    onClick={save}
                    disabled={status === 'saving' || !baseUrl.trim() || !model.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-accent-primary text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                    {status === 'saving' ? <Loader2 size={13} className="animate-spin" /> : status === 'saved' ? <CheckCircle size={13} /> : <Save size={13} />}
                    {status === 'saved' ? 'Saved' : 'Save'}
                </button>
                <button
                    onClick={ping}
                    disabled={!baseUrl.trim() || pingStatus === 'pinging'}
                    className="px-3 py-2 rounded-lg text-xs font-semibold bg-bg-input hover:bg-bg-elevated text-text-primary border border-border-subtle disabled:opacity-50 transition-colors flex items-center gap-1.5"
                    title="Check the endpoint is reachable"
                >
                    {pingStatus === 'pinging' ? <Loader2 size={12} className="animate-spin" /> :
                        pingStatus === 'ok' ? <CheckCircle size={12} className="text-green-500" /> :
                            pingStatus === 'fail' ? <AlertCircle size={12} className="text-red-500" /> : <Radio size={12} />}
                    Ping
                </button>
                <button
                    onClick={fetchModels}
                    disabled={isFetching || !baseUrl.trim()}
                    className="ml-auto px-3 py-2 rounded-lg text-xs font-semibold bg-accent-primary/10 text-accent-primary border border-accent-primary/20 hover:bg-accent-primary/20 disabled:opacity-40 transition-colors flex items-center gap-1.5"
                    title="Fetch models from the endpoint and add them to your active models"
                >
                    {isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    Fetch Models
                </button>
            </div>
            {pingMsg && (
                <p className={`text-[10px] ${pingStatus === 'fail' ? 'text-red-500' : 'text-green-500'}`}>{pingMsg}</p>
            )}
            {configured && fetchedModels.length > 0 && (
                <p className="text-[10px] text-text-tertiary">{fetchedModels.length} model{fetchedModels.length === 1 ? '' : 's'} available — pick any in the model selector or here.</p>
            )}
        </div>
    );
}
