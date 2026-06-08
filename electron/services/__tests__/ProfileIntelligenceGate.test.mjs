// electron/services/__tests__/ProfileIntelligenceGate.test.mjs
//
// Verifies the Profile Intelligence IPC handlers are locally available.
// We test this at the source level (matching the existing ModeBleeding.test
// pattern) because the IPC handlers themselves require an Electron app
// runtime to instantiate.
//
// The fork contract is: former Pro handlers must not require license/trial
// state. They may still fail for real reasons (engine missing, invalid file
// path, missing resume/JD), but never because of a paywall.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findSafeHandle, sliceSafeHandleBlock } from './ipcTestUtils.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(__dirname, '../../ipcHandlers.ts');

const LOCAL_HANDLERS = [
  'profile:upload-resume',
  'profile:set-mode',
  'profile:upload-jd',
  'profile:research-company',
  'profile:generate-negotiation',
  'profile:get-persona',
  'profile:save-persona',
];

describe('Profile Intelligence IPC: local open-source access', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');

  for (const handler of LOCAL_HANDLERS) {
    test(`handler "${handler}" has no Pro/trial short-circuit`, () => {
      const idx = findSafeHandle(source, handler);
      assert.ok(idx >= 0, `Handler ${handler} not found in ipcHandlers.ts`);

      const slice = sliceSafeHandleBlock(source, handler).slice(0, 3000);

      assert.ok(
        !slice.includes('isProOrTrialActive()'),
        `Handler ${handler} must not call a license/trial gate`
      );
      assert.ok(
        !slice.includes('pro_required') && !slice.includes('Pro license required'),
        `Handler ${handler} must not return a Pro-required error`
      );
    });
  }

  test('profile:get-status returns safe defaults when the local engine is unavailable', () => {
    const idx = findSafeHandle(source, 'profile:get-status');
    assert.ok(idx >= 0);
    const slice = sliceSafeHandleBlock(source, 'profile:get-status').slice(0, 1500);
    assert.ok(slice.includes('hasProfile: false'), 'profile:get-status must default to hasProfile=false when orchestrator missing');
  });

  test('resume/JD upload still require a path produced by profile:select-file', () => {
    for (const handler of ['profile:upload-resume', 'profile:upload-jd']) {
      const slice = sliceSafeHandleBlock(source, handler).slice(0, 3000);
      assert.ok(slice.includes('consumeSelectedProfilePath(filePath)'), `${handler} must consume a dialog-selected path`);
      assert.ok(slice.includes('Please re-select'), `${handler} must reject stale or arbitrary file paths`);
    }
  });
});

describe('Profile Intelligence: resume + JD storage tables exist in the schema', () => {
  const dbPath = path.resolve(__dirname, '../../db/DatabaseManager.ts');
  const dbSource = fs.readFileSync(dbPath, 'utf8');

  test('user_profile table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS user_profile'));
  });

  test('resume_nodes table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS resume_nodes'));
  });
});
