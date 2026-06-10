// electron/services/__tests__/TrayIconPreset.test.mjs
// Unit tests for the pure tray-icon preset module (no Electron required).
// Run: npm run build:electron && node --test electron/services/__tests__/TrayIconPreset.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  TRAY_ICON_PRESETS,
  isTrayIconPreset,
  trayIconDisplayName,
  resolveTrayIconPath,
} = require('../../../dist-electron/electron/services/trayIconPreset.js');

describe('trayIconPreset', () => {
  test('TRAY_ICON_PRESETS lists the five presets in order', () => {
    assert.deepEqual([...TRAY_ICON_PRESETS], ['none', 'spotify', 'telegram', 'discord', 'steam']);
  });

  test('isTrayIconPreset accepts the five valid presets', () => {
    for (const p of ['none', 'spotify', 'telegram', 'discord', 'steam']) {
      assert.equal(isTrayIconPreset(p), true);
    }
  });

  test('isTrayIconPreset rejects invalid values', () => {
    for (const v of ['', 'Spotify', 'foo', 'terminal', undefined, null, 3, {}]) {
      assert.equal(isTrayIconPreset(v), false);
    }
  });

  test('trayIconDisplayName maps each preset', () => {
    assert.equal(trayIconDisplayName('none'), 'Natively');
    assert.equal(trayIconDisplayName('spotify'), 'Spotify');
    assert.equal(trayIconDisplayName('telegram'), 'Telegram');
    assert.equal(trayIconDisplayName('discord'), 'Discord');
    assert.equal(trayIconDisplayName('steam'), 'Steam');
  });

  test('resolveTrayIconPath returns the default icon path for none', () => {
    const opts = { assetsDir: '/app/assets', defaultTrayIconPath: '/app/assets/iconTemplate.png' };
    assert.equal(resolveTrayIconPath('none', opts), '/app/assets/iconTemplate.png');
  });

  test('resolveTrayIconPath returns the fakeicon/tray path for presets', () => {
    const opts = { assetsDir: '/app/assets', defaultTrayIconPath: '/app/assets/iconTemplate.png' };
    assert.equal(resolveTrayIconPath('spotify', opts), path.join('/app/assets', 'fakeicon', 'tray', 'spotify.png'));
    assert.equal(resolveTrayIconPath('discord', opts), path.join('/app/assets', 'fakeicon', 'tray', 'discord.png'));
  });

  test('resolveTrayIconPath works for a packaged assetsDir', () => {
    const opts = { assetsDir: '/Resources/assets', defaultTrayIconPath: '/Resources/assets/iconTemplate.png' };
    assert.equal(resolveTrayIconPath('telegram', opts), path.join('/Resources/assets', 'fakeicon', 'tray', 'telegram.png'));
  });
});
