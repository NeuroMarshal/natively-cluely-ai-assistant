/**
 * Local extension module loader.
 *
 * Uses Vite's import.meta.glob to optionally load locally reimplemented
 * extension components from the top-level extension directory. If that folder
 * is removed, the globs return empty objects and no-op fallbacks are used.
 */
import React from 'react';

// ─── No-op fallbacks ────────────────────────────────────────────────
const NullComponent: React.FC<any> = () => null;

// ─── Glob-import local extension modules (empty {} when absent) ──────
const _profileVis = import.meta.glob<any>(
  '../../premium/src/ProfileVisualizer.tsx',
  { eager: true }
);
const _negotiationCard = import.meta.glob<any>(
  '../../premium/src/NegotiationCoachingCard.tsx',
  { eager: true }
);
const _modesSettings = import.meta.glob<any>(
  '../../premium/src/ModesSettings.tsx',
  { eager: true }
);

// ─── Helper ──────────────────────────────────────────────────────────
function get<T>(mods: Record<string, any>, name: string, fallback: T): T {
  const mod = Object.values(mods)[0];
  return mod?.[name] ?? fallback;
}

// ─── Exports (always safe to import) ─────────────────────────────────
export const ProfileVisualizer: React.FC<any> =
  get(_profileVis, 'ProfileVisualizer', NullComponent);

export const NegotiationCoachingCard: React.FC<any> =
  get(_negotiationCard, 'NegotiationCoachingCard', NullComponent);

export const ModesSettings: React.FC<any> =
  get(_modesSettings, 'default', NullComponent);
