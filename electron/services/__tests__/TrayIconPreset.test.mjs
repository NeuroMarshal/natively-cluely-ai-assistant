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
  test('TRAY_ICON_PRESETS lists the four presets in order', () => {
    assert.deepEqual([...TRAY_ICON_PRESETS], ['none', 'terminal', 'settings', 'activity']);
  });

  test('isTrayIconPreset accepts the four valid presets', () => {
    for (const p of ['none', 'terminal', 'settings', 'activity']) {
      assert.equal(isTrayIconPreset(p), true);
    }
  });

  test('isTrayIconPreset rejects invalid values', () => {
    for (const v of ['', 'Terminal', 'foo', undefined, null, 3, {}]) {
      assert.equal(isTrayIconPreset(v), false);
    }
  });

  test('trayIconDisplayName maps each preset', () => {
    assert.equal(trayIconDisplayName('none'), 'Natively');
    assert.equal(trayIconDisplayName('terminal'), 'Terminal');
    assert.equal(trayIconDisplayName('settings'), 'System Settings');
    assert.equal(trayIconDisplayName('activity'), 'Activity Monitor');
  });

  test('resolveTrayIconPath returns the default icon path for none', () => {
    const opts = { assetsDir: '/app/assets', defaultTrayIconPath: '/app/assets/iconTemplate.png' };
    assert.equal(resolveTrayIconPath('none', opts), '/app/assets/iconTemplate.png');
  });

  test('resolveTrayIconPath returns the fakeicon/win path for presets', () => {
    const opts = { assetsDir: '/app/assets', defaultTrayIconPath: '/app/assets/iconTemplate.png' };
    assert.equal(resolveTrayIconPath('terminal', opts), path.join('/app/assets', 'fakeicon', 'win', 'terminal.png'));
    assert.equal(resolveTrayIconPath('activity', opts), path.join('/app/assets', 'fakeicon', 'win', 'activity.png'));
  });

  test('resolveTrayIconPath works for a packaged assetsDir', () => {
    const opts = { assetsDir: '/Resources/assets', defaultTrayIconPath: '/Resources/assets/iconTemplate.png' };
    assert.equal(resolveTrayIconPath('settings', opts), path.join('/Resources/assets', 'fakeicon', 'win', 'settings.png'));
  });
});
