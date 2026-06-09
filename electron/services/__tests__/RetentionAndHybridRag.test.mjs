// Phase 4 + Phase 9 — source-level wiring tests.
// Phase 4: WhatToAnswerLLM should prefer the new async hybrid retriever
//          when ModesManager exposes it. Lexical sync remains as fallback.
// Phase 9: stopMeeting must early-return when meetingRetention is 'never'
//          OR when meeting metadata has doNotPersist === true.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('Phase 4 — Hybrid RAG default in WhatToAnswerLLM', () => {
  test('ModesManager exposes async buildRetrievedActiveModeContextBlockHybrid', () => {
    const src = read('electron/services/ModesManager.ts');
    assert.match(src, /async buildRetrievedActiveModeContextBlockHybrid\(/, 'must declare async hybrid method');
    assert.match(src, /retrieveHybrid\(/, 'hybrid method must call into ModeContextRetriever.retrieveHybrid');
    // Falls back to sync lexical when hybrid yields nothing.
    assert.match(src, /buildRetrievedActiveModeContextBlock\(/, 'hybrid path must call lexical fallback if empty');
  });

  test('Hybrid wrapper keeps local retrieval behavior without extra reporting requirements', () => {
    const src = read('electron/services/ModesManager.ts');
    assert.match(src, /retrieveHybrid\(/, 'hybrid retrieval should remain wired');
    assert.match(src, /buildRetrievedActiveModeContextBlock\(/, 'lexical fallback should remain wired');
  });

  test('WhatToAnswerLLM prefers async hybrid when method exists, falls back to sync', () => {
    const src = read('electron/llm/WhatToAnswerLLM.ts');
    // Type slot for the new method (so callers can detect it).
    assert.match(src, /buildRetrievedActiveModeContextBlockHybrid\?:/, 'type alias must declare optional hybrid method');
    // Runtime branch: prefer hybrid, await it.
    assert.match(src, /typeof this\.modesManager\.buildRetrievedActiveModeContextBlockHybrid\s*===\s*['"]function['"]/);
    assert.match(src, /await this\.modesManager\.buildRetrievedActiveModeContextBlockHybrid\(/);
    // Lexical fallback path remains.
    assert.match(src, /this\.modesManager\.buildRetrievedActiveModeContextBlock\(/);
  });
});

describe('Phase 9 — Retention & doNotPersist gate in MeetingPersistence', () => {
  test('SettingsManager exposes meetingRetention setting', () => {
    const src = read('electron/services/SettingsManager.ts');
    assert.match(src, /meetingRetention\?:\s*['"]forever['"]\s*\|\s*['"]7d['"]\s*\|\s*['"]30d['"]\s*\|\s*['"]never['"]/);
  });

  test('stopMeeting short-circuits when meetingRetention is never', () => {
    const src = read('electron/MeetingPersistence.ts');
    // The gate reads the setting and the meta toggle, then early-returns.
    assert.match(src, /SettingsManager\.getInstance\(\)\.get\(['"]meetingRetention['"]\)/);
    assert.match(src, /retention\s*===\s*['"]never['"]/, 'must check for "never" retention');
    // Per-meeting toggle.
    assert.match(src, /doNotPersist/, 'must support per-meeting doNotPersist');
    // Early-return code path: no DB save, no processAndSaveMeeting call.
    const window = src.slice(src.indexOf('public async stopMeeting'), src.indexOf('public async stopMeeting') + 3000);
    assert.match(window, /this\.session\.reset\(\);\s*\n\s*return null;/, 'do-not-persist path must reset and return null without saving');
  });

  test('do-not-persist path returns without reporting dependencies', () => {
    const src = read('electron/MeetingPersistence.ts');
    const idx = src.indexOf('doNotPersist');
    const window = src.slice(idx, idx + 1500);
    assert.doesNotMatch(window, /transcript:\s*snapshot\.transcript/);
    assert.doesNotMatch(window, /summary:\s*summary/);
  });
});
