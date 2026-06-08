// local extension ModesSettings.tsx
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// Modes configuration panel. The upstream component gated mode creation behind a
// paid license; this open-source version drops the gate entirely — every mode and
// template is available to everyone. CRUD is wired through the existing modes IPC
// (modesGetAll / modesCreate / modesSetActive / modesDelete).

import React from 'react';

interface Mode {
  id: string;
  name: string;
  templateType: string;
  customContext?: string;
  isActive: boolean;
}

interface ModesSettingsProps {
  onClose: () => void;
  // Kept for call-site compatibility; gating is intentionally NOT applied.
  isPremium?: boolean;
  isLoaded?: boolean;
  isTrialActive?: boolean;
  onOpenNativelyAPI?: () => void;
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

const ModesSettings: React.FC<ModesSettingsProps> = ({ onClose, onOpenNativelyAPI }) => {
  const [modes, setModes] = React.useState<Mode[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [newName, setNewName] = React.useState('');
  const [newType, setNewType] = React.useState('general');
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const a = api();
    if (!a?.modesGetAll) { setLoading(false); return; }
    try {
      const all = await a.modesGetAll();
      setModes(Array.isArray(all) ? all : []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

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
    setBusy(true);
    try { await a.modesDelete(id); await refresh(); } finally { setBusy(false); }
  };

  return (
    <div className="flex h-full w-full flex-col bg-neutral-950 text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <div>
          <div className="text-base font-semibold">Modes</div>
          <div className="text-xs text-white/50">Tailor the copilot to the conversation. All modes are free in this build.</div>
        </div>
        <button onClick={onClose} className="rounded-md px-2 py-1 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="text-sm text-white/50">Loading modes…</div>
        ) : (
          <>
            <div className="mb-5 space-y-2">
              {modes.length === 0 && <div className="text-sm text-white/50">No modes yet — create one below.</div>}
              {modes.map((m) => (
                <div key={m.id} className={`flex items-center justify-between rounded-lg border px-3 py-2 ${m.isActive ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-white/10 bg-white/5'}`}>
                  <div>
                    <div className="text-sm font-medium">{m.name}{m.isActive && <span className="ml-2 text-[11px] text-emerald-300">active</span>}</div>
                    <div className="text-xs text-white/40">{TEMPLATES.find((t) => t.type === m.templateType)?.label ?? m.templateType}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!m.isActive && (
                      <button disabled={busy} onClick={() => activate(m.id)} className="rounded-md bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20 disabled:opacity-50">Use</button>
                    )}
                    {m.templateType !== 'general' && (
                      <button disabled={busy} onClick={() => remove(m.id)} className="rounded-md px-2.5 py-1 text-xs text-white/40 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-50">Delete</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Add a mode</div>
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
                <button disabled={busy} onClick={create} className="rounded-md bg-emerald-500/80 px-3 py-1.5 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50">Add</button>
              </div>
              <div className="mt-2 text-xs text-white/40">{TEMPLATES.find((t) => t.type === newType)?.description}</div>
            </div>

            {onOpenNativelyAPI && (
              <button onClick={onOpenNativelyAPI} className="mt-4 text-xs text-white/40 underline hover:text-white/70">
                Configure model providers / API keys
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export { ModesSettings };
export default ModesSettings;
