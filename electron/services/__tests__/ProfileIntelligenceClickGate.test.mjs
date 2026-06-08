// electron/services/__tests__/ProfileIntelligenceClickGate.test.mjs
//
// Verifies the Profile Intelligence renderer exposes resume + JD upload
// directly in the open-source fork.
//
// We follow the same source-level pattern as ProfileIntelligenceGate.test.mjs:
// no JSX runtime, no jsdom. The renderer is plain text that must contain the
// gate clause inside each upload onClick handler.
//
// The contract is: each upload onClick handler may open the OS file picker
// immediately. Any remaining failures must come from local validation/backend
// readiness, not a Pro modal.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(__dirname, '../../../src/components/ProfileIntelligenceSettings.tsx');

describe('Profile Intelligence renderer: local upload access', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');

  test('component does not import or render upgrade/paywall UI', () => {
    assert.ok(!source.includes('PremiumUpgradeModal'), 'Upgrade modal import/render must stay removed');
    assert.ok(!source.includes('setIsPremiumModalOpen'), 'Upgrade modal setter must stay removed');
    assert.ok(!source.includes('hasProfileAccess'), 'Profile access must not be derived from a plan flag');
  });

  const UPLOAD_CALL_SITES = [
    { ipc: 'profileUploadResume', label: 'resume upload button' },
    { ipc: 'profileUploadJD',     label: 'job description upload button' },
  ];

  for (const { ipc, label } of UPLOAD_CALL_SITES) {
    test(`${label} (calls ${ipc}) opens the picker without a Pro gate`, () => {
      const ipcIdx = source.indexOf(ipc);
      assert.ok(ipcIdx >= 0, `Call site for ${ipc} not found`);

      // Walk back to the enclosing onClick={async () => { … }. We bound the
      // handler at its onClick={ open brace and at the corresponding ipc call.
      const onClickIdx = source.lastIndexOf('onClick={async () => {', ipcIdx);
      assert.ok(onClickIdx >= 0, `onClick handler for ${ipc} not found`);

      const handler = source.slice(onClickIdx, ipcIdx);

      const pickerIdx = handler.indexOf('profileSelectFile');

      assert.ok(
        pickerIdx >= 0,
        `Handler for ${ipc} must open the local file picker`
      );
      assert.ok(
        !/setIsPremiumModalOpen|PremiumUpgradeModal|!\s*hasProfileAccess|pro_required|Requires Pro/i.test(handler),
        `Handler for ${ipc} must not contain Pro/paywall gating`
      );
    });
  }

  test('upload cards do not render Pro badges', () => {
    const markers = source.match(/pi-upload-pill__pro-badge/g) ?? [];
    assert.equal(markers.length, 0, 'Upload cards must not show Pro badges');
  });
});
