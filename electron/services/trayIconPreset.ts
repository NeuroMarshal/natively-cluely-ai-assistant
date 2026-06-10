// electron/services/trayIconPreset.ts
// Pure logic for the independent tray-icon disguise. No Electron imports so it
// can be unit-tested without a GUI. Consumed by AppState.applyTrayIcon().
import * as path from 'path';

export type TrayIconPreset = 'none' | 'terminal' | 'settings' | 'activity';

export const TRAY_ICON_PRESETS: readonly TrayIconPreset[] = [
  'none',
  'terminal',
  'settings',
  'activity',
];

export function isTrayIconPreset(value: unknown): value is TrayIconPreset {
  return typeof value === 'string' && (TRAY_ICON_PRESETS as readonly string[]).includes(value);
}

const DISPLAY_NAMES: Record<TrayIconPreset, string> = {
  none: 'Natively',
  terminal: 'Terminal',
  settings: 'System Settings',
  activity: 'Activity Monitor',
};

export function trayIconDisplayName(preset: TrayIconPreset): string {
  return DISPLAY_NAMES[preset];
}

export interface TrayIconPathOptions {
  /** Directory containing the bundled `fakeicon/` assets (dev or packaged). */
  assetsDir: string;
  /** Absolute path to the normal (non-disguised) tray icon. */
  defaultTrayIconPath: string;
}

export function resolveTrayIconPath(preset: TrayIconPreset, opts: TrayIconPathOptions): string {
  if (preset === 'none') {
    return opts.defaultTrayIconPath;
  }
  return path.join(opts.assetsDir, 'fakeicon', 'win', preset + '.png');
}
