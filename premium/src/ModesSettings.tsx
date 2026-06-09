// local extension ModesSettings.tsx
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// Modes configuration panel. The upstream component gated mode creation behind a
// paid license; this open-source version drops the gate entirely — every mode and
// template is available to everyone. CRUD is wired through the existing modes IPC
// (modesGetAll / modesCreate / modesSetActive / modesDelete).

import React from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

interface Mode {
  id: string;
  name: string;
  templateType: string;
  customContext?: string;
  isActive: boolean;
  referenceFileCount?: number;
}

interface ReferenceFile {
  id: string;
  modeId: string;
  fileName: string;
  createdAt: string;
}

interface ModesSettingsProps {
  onClose: () => void;
}

const TEMPLATES: Array<{ type: string; label: string; description: string }> = [
  { type: 'general', label: 'General', description: 'Universal adaptive copilot for any meeting or conversation.' },
  { type: 'sales', label: 'Sales', description: 'Close deals with strategic discovery and objection handling.' },
  { type: 'recruiting', label: 'Recruiting', description: 'Evaluate candidates with structured interview insights.' },
  { type: 'team-meet', label: 'Team Meet', description: 'Track action items and key decisions from meetings.' },
  { type: 'looking-for-work', label: 'Looking for work', description: 'Answer interview questions with confidence and clarity.' },
  { type: 'technical-interview', label: 'Technical Interview', description: 'Whiteboard-style coding and system design support.' },
  { type: 'lecture', label: 'Lecture', description: 'Capture key concepts and content from lectures.' },
];

const api = (): any => (typeof window !== 'undefined' ? (window as any).electronAPI : undefined);

const ModesSettings: React.FC<ModesSettingsProps> = ({ onClose }) => {
  const [modes, setModes] = React.useState<Mode[]>([]);
  const [filesByMode, setFilesByMode] = React.useState<Record<string, ReferenceFile[]>>({});
  const [indexStatus, setIndexStatus] = React.useState<string>('');
  const [loading, setLoading] = React.useState(true);
  const [newName, setNewName] = React.useState('');
  const [newType, setNewType] = React.useState('general');
  const [busy, setBusy] = React.useState(false);
  const [expandedModeId, setExpandedModeId] = React.useState<string | null>(null);
  const [contextDrafts, setContextDrafts] = React.useState<Record<string, string>>({});
  const [savedModeId, setSavedModeId] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');

  const refresh = React.useCallback(async () => {
    const a = api();
    if (!a?.modesGetAll) { setLoading(false); return; }
    try {
      const all = await a.modesGetAll();
      const nextModes = Array.isArray(all) ? all : [];
      setModes(nextModes);
      setContextDrafts((current) => {
        const next = { ...current };
        for (const mode of nextModes) {
          if (!(mode.id in next)) next[mode.id] = mode.customContext ?? '';
        }
        return next;
      });
      if (a.modesGetReferenceFiles) {
        const entries = await Promise.all(
          nextModes.map(async (mode: Mode) => {
            try {
              return [mode.id, await a.modesGetReferenceFiles(mode.id)] as const;
            } catch {
              return [mode.id, []] as const;
            }
          }),
        );
        setFilesByMode(Object.fromEntries(entries));
      }
    } catch {
      setError('Could not load modes.');
    }
    setLoading(false);
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => {
    const a = api();
    if (!a?.onModeReferenceIndexStatus) return;
    return a.onModeReferenceIndexStatus((status: any) => {
      if (status.state === 'indexing') {
        setIndexStatus(status.fileName ? `Caching ${status.fileName}...` : 'Caching knowledge files...');
      } else if (status.state === 'complete') {
        const chunks = typeof status.embeddedChunks === 'number' ? ` (${status.embeddedChunks} chunks)` : '';
        setIndexStatus(`Knowledge cache ready${chunks}`);
        void refresh();
      } else if (status.state === 'error') {
        setIndexStatus(status.fileName ? `Cache failed for ${status.fileName}` : 'Knowledge cache failed');
      }
    });
  }, [refresh]);

  const activate = async (id: string) => {
    const a = api();
    if (!a?.modesSetActive) return;
    setBusy(true);
    try { await a.modesSetActive(id); await refresh(); } finally { setBusy(false); }
  };

  const create = async () => {
    const a = api();
    if (!a?.modesCreate) return;
    const name = newName.trim() || TEMPLATES.find((t) => t.type === newType)?.label || 'New mode';
    setBusy(true);
    try {
      await a.modesCreate({ name, templateType: newType });
      setNewName('');
      await refresh();
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    const a = api();
    if (!a?.modesDelete) return;
    const mode = modes.find((item) => item.id === id);
    if (!window.confirm(`Delete "${mode?.name ?? 'this mode'}" and its cached files?`)) return;
    setBusy(true);
    setError('');
    try {
      const result = await a.modesDelete(id);
      if (!result?.success) throw new Error(result?.error || 'Delete failed');
      setExpandedModeId((current) => current === id ? null : current);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Could not delete the mode.');
    } finally {
      setBusy(false);
    }
  };

  const saveContext = async (modeId: string) => {
    const a = api();
    if (!a?.modesUpdate) return;
    setBusy(true);
    setError('');
    try {
      const result = await a.modesUpdate(modeId, {
        customContext: contextDrafts[modeId] ?? '',
      });
      if (!result?.success) throw new Error(result?.error || 'Save failed');
      setSavedModeId(modeId);
      window.setTimeout(() => setSavedModeId((current) => current === modeId ? null : current), 1800);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Could not save mode context.');
    } finally {
      setBusy(false);
    }
  };

  const uploadReference = async (modeId: string) => {
    const a = api();
    if (!a?.modesUploadReferenceFile) return;
    setBusy(true);
    setIndexStatus('Caching knowledge files...');
    try {
      const res = await a.modesUploadReferenceFile(modeId);
      if (res?.cancelled) setIndexStatus('');
      else if (!res?.success) setIndexStatus(res?.error || 'Upload failed');
      await refresh();
    } finally { setBusy(false); }
  };

  const deleteReference = async (id: string) => {
    const a = api();
    if (!a?.modesDeleteReferenceFile) return;
    const file = Object.values(filesByMode).flat().find((item) => item.id === id);
    if (!window.confirm(`Delete "${file?.fileName ?? 'this file'}" and its embedding cache?`)) return;
    setBusy(true);
    setError('');
    try {
      const result = await a.modesDeleteReferenceFile(id);
      if (!result?.success) throw new Error(result?.error || 'Delete failed');
      setIndexStatus('File and cached embeddings removed');
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Could not delete the file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-neutral-950 text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <div>
          <div className="text-base font-semibold">Presets</div>
          <div className="text-xs text-white/50">Combine direct context with searchable knowledge files for each situation.</div>
        </div>
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close">
          <X size={17} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="text-sm text-white/50">Loading presets...</div>
        ) : (
          <>
            {error && (
              <div className="mb-4 rounded-md border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-200">
                {error}
              </div>
            )}

            <div className="mb-5 space-y-2">
              {modes.length === 0 && <div className="text-sm text-white/50">No presets yet. Create one below.</div>}
              {modes.map((m) => (
                <div key={m.id} className={`rounded-lg border px-3 py-2 ${m.isActive ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-white/10 bg-white/5'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{m.name}{m.isActive && <span className="ml-2 text-[11px] text-emerald-300">active</span>}</div>
                      <div className="text-xs text-white/40">{TEMPLATES.find((t) => t.type === m.templateType)?.label ?? m.templateType}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!m.isActive && (
                        <button disabled={busy} onClick={() => activate(m.id)} className="rounded-md bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20 disabled:opacity-50">Use</button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => setExpandedModeId((current) => current === m.id ? null : m.id)}
                        className="flex h-8 items-center gap-1.5 rounded-md bg-white/10 px-2.5 text-xs hover:bg-white/20 disabled:opacity-50"
                      >
                        <FileText size={13} />
                        Context
                        {expandedModeId === m.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => remove(m.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-white/40 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-50"
                        aria-label={`Delete ${m.name}`}
                        title="Delete mode"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {expandedModeId === m.id && (
                    <div className="mt-3 border-t border-white/10 pt-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-medium text-white/85">Direct context</div>
                          <div className="text-[11px] text-white/40">Instructions, facts, Q&A and notes added to every request in this mode.</div>
                        </div>
                        <button
                          disabled={busy}
                          onClick={() => saveContext(m.id)}
                          className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-500/80 px-2.5 text-xs font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
                        >
                          {savedModeId === m.id ? <Check size={14} /> : <Save size={14} />}
                          {savedModeId === m.id ? 'Saved' : 'Save'}
                        </button>
                      </div>
                      <textarea
                        value={contextDrafts[m.id] ?? ''}
                        maxLength={12000}
                        onChange={(event) => setContextDrafts((current) => ({
                          ...current,
                          [m.id]: event.target.value,
                        }))}
                        rows={6}
                        placeholder={'Examples:\nQuestion: What is eventual consistency?\nAnswer: ...\n\nKeep answers concise and use examples from my notes.'}
                        className="w-full resize-y rounded-md border border-white/10 bg-black/35 px-3 py-2 text-xs leading-relaxed text-white outline-none placeholder:text-white/25 focus:border-emerald-400/40"
                      />
                      <div className="mt-1 text-right text-[10px] tabular-nums text-white/30">
                        {(contextDrafts[m.id] ?? '').length}/12000
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-medium text-white/85">Knowledge files</div>
                          <div className="text-[11px] text-white/40">PDF, DOCX and text files are indexed for semantic search.</div>
                        </div>
                        <button
                          disabled={busy}
                          onClick={() => uploadReference(m.id)}
                          className="flex h-8 items-center gap-1.5 rounded-md bg-white/10 px-2.5 text-xs hover:bg-white/20 disabled:opacity-50"
                        >
                          <Upload size={14} />
                          Add file
                        </button>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {(filesByMode[m.id] ?? []).length === 0 ? (
                          <div className="rounded-md border border-dashed border-white/10 px-3 py-2 text-[11px] text-white/35">
                            No knowledge files
                          </div>
                        ) : (
                          (filesByMode[m.id] ?? []).map((file) => (
                            <div key={file.id} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/25 px-2.5 py-2 text-xs text-white/65">
                              <span className="min-w-0 truncate">{file.fileName}</span>
                              <button
                                disabled={busy}
                                onClick={() => deleteReference(file.id)}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/35 hover:bg-red-500/20 hover:text-red-300"
                                aria-label={`Delete ${file.fileName}`}
                                title="Delete file and cache"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {indexStatus && (
              <div className="mb-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
                {indexStatus}
              </div>
            )}

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Add a preset</div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name (optional)"
                  className="flex-1 rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-sm outline-none focus:border-white/30"
                />
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="rounded-md border border-white/10 bg-black/40 px-3 py-1.5 text-sm outline-none focus:border-white/30"
                >
                  {TEMPLATES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                </select>
                <button disabled={busy} onClick={create} className="flex items-center justify-center gap-1.5 rounded-md bg-emerald-500/80 px-3 py-1.5 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50">
                  <Plus size={15} />
                  Add
                </button>
              </div>
              <div className="mt-2 text-xs text-white/40">{TEMPLATES.find((t) => t.type === newType)?.description}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export { ModesSettings };
export default ModesSettings;
