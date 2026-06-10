// electron/services/trayIconPreset.ts
// Pure logic for the independent tray-icon disguise. No Electron imports so it
// can be unit-tested without a GUI. Consumed by AppState.applyTrayIcon().
import * as path from 'path';

export type TrayIconPreset = 'none' | 'spotify' | 'telegram' | 'discord' | 'steam';

export const TRAY_ICON_PRESETS: readonly TrayIconPreset[] = [
  'none',
  'spotify',
  'telegram',
  'discord',
  'steam',
];

export function isTrayIconPreset(value: unknown): value is TrayIconPreset {
  return typeof value === 'string' && (TRAY_ICON_PRESETS as readonly string[]).includes(value);
}

const DISPLAY_NAMES: Record<TrayIconPreset, string> = {
  none: 'Natively',
  spotify: 'Spotify',
  telegram: 'Telegram',
  discord: 'Discord',
  steam: 'Steam',
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
  return path.join(opts.assetsDir, 'fakeicon', 'tray', preset + '.png');
}
