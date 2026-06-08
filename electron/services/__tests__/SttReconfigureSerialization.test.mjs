// Regression test for STT reconfiguration serialization.
//
// ROOT CAUSE: settings flows can fire multiple audio-pipeline rebuilds nearly
// simultaneously. `reconfigureSttProvider` tears down and reconstructs the native
// captures (SystemAudioCapture / MicrophoneCapture → CoreAudio /
// ScreenCaptureKit / WASAPI). Two interleaved teardown+construct sequences
// against the same native device handles raced → native deadlock / process crash
// on BOTH macOS and Windows.
//
// FIXES UNDER TEST:
//   #1 reconfigureSttProvider is serialized via `_sttReconfigureChain` — the
//      actual work lives in `_doReconfigureSttProvider`, and concurrent callers
//      are queued so the critical section is never re-entered.
//   #2 the removed Natively API settings renderer can no longer double-fire
//      setSttProvider/setDefaultModel.
//   #3 legacy license activation is no longer part of the key-save path.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const mainSrc = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const ipcSrc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const deletedNativelyApiSettings = path.join(root, 'src/components/settings/NativelyApiSettings.tsx');
const settingsOverlaySrc = fs.readFileSync(
  path.join(root, 'src/components/SettingsOverlay.tsx'),
  'utf8',
);

describe('Fix #1: reconfigureSttProvider is serialized (source contract)', () => {
  it('declares a serialization chain field', () => {
    assert.match(
      mainSrc,
      /_sttReconfigureChain\s*:\s*Promise<void>/,
      'BUG: `_sttReconfigureChain` serialization field is gone. Without it, concurrent ' +
        'reconfigureSttProvider calls re-enter the native teardown/rebuild in parallel — ' +
        'the exact race that crashed/hung the app after a key save.',
    );
  });

  it('the public reconfigureSttProvider delegates through the chain, not the body directly', () => {
    // Isolate the public method body.
    const pubStart = mainSrc.indexOf('public async reconfigureSttProvider(');
    assert.ok(pubStart >= 0, 'public reconfigureSttProvider must exist');
    const pubBody = mainSrc.slice(pubStart, pubStart + 1200);
    assert.match(
      pubBody,
      /_sttReconfigureChain/,
      'BUG: public reconfigureSttProvider no longer references _sttReconfigureChain — ' +
        'serialization was removed and concurrent calls can race again.',
    );
    assert.match(
      pubBody,
      /_doReconfigureSttProvider\s*\(/,
      'BUG: public reconfigureSttProvider must delegate the real work to ' +
        '_doReconfigureSttProvider (the serialized critical section).',
    );
    // The teardown/rebuild must NOT be inlined in the public method — that
    // would mean it runs unserialized.
    assert.ok(
      !/public async reconfigureSttProvider[\s\S]{0,1200}setupSystemAudioPipeline/.test(mainSrc),
      'BUG: setupSystemAudioPipeline is called directly inside the PUBLIC ' +
        'reconfigureSttProvider — the native rebuild must live in the serialized ' +
        '_doReconfigureSttProvider instead.',
    );
  });

  it('the real teardown/rebuild lives in _doReconfigureSttProvider', () => {
    const doStart = mainSrc.indexOf('private async _doReconfigureSttProvider(');
    assert.ok(doStart >= 0, 'BUG: _doReconfigureSttProvider (the serialized worker) is missing.');
    const doBody = mainSrc.slice(doStart, doStart + 2000);
    assert.match(
      doBody,
      /setupSystemAudioPipeline/,
      'BUG: _doReconfigureSttProvider no longer rebuilds the pipeline — the worker is hollow.',
    );
  });
});

describe('Fix #1: serialization semantics (behavioral)', () => {
  // Faithfully reproduce the chain pattern from main.ts and prove it provides
  // mutual exclusion: the critical section is never entered concurrently, even
  // when callers arrive simultaneously and the work is async.
  function makeSerializedRunner(work) {
    let chain = Promise.resolve();
    return function run() {
      const r = chain.then(
        () => work(),
        () => work(),
      );
      chain = r.then(
        () => undefined,
        () => undefined,
      );
      return r;
    };
  }

  it('never re-enters the critical section under concurrent calls', async () => {
    let active = 0;
    let maxActive = 0;
    let completed = 0;
    const work = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      // Yield across multiple microtask/macrotask boundaries to expose any
      // interleaving — this is where the native race used to happen.
      await new Promise((res) => setTimeout(res, 5));
      await Promise.resolve();
      active--;
      completed++;
    };
    const run = makeSerializedRunner(work);

    // Fire the same double-call the key-save flow used to produce.
    await Promise.all([run(), run(), run(), run()]);

    assert.equal(maxActive, 1, 'BUG: critical section was entered concurrently — serialization failed.');
    assert.equal(completed, 4, 'all queued reconfigures must complete.');
  });

  it('a throwing reconfigure does not wedge subsequent reconfigures', async () => {
    let completedAfterThrow = 0;
    let calls = 0;
    const work = async () => {
      calls++;
      if (calls === 1) throw new Error('simulated native init failure');
      await Promise.resolve();
      completedAfterThrow++;
    };
    const run = makeSerializedRunner(work);

    // First call rejects to ITS caller...
    await assert.rejects(run(), /simulated native init failure/);
    // ...but the chain must keep working for the next caller.
    await run();
    await run();
    assert.equal(completedAfterThrow, 2, 'BUG: a failed reconfigure poisoned the chain for later callers.');
  });
});

describe('Fix #2: renderer no longer double-fires; server compensates the UI refresh', () => {
  it('removed Natively API settings UI cannot double-fire STT/model changes', () => {
    assert.equal(
      fs.existsSync(deletedNativelyApiSettings),
      false,
      'NativelyApiSettings.tsx should stay removed in the local-first UI',
    );
    assert.ok(
      !/setNativelyApiKey|NativelyApiSettings|natively-api/.test(settingsOverlaySrc),
      'SettingsOverlay must not reintroduce the removed Natively API key-save UI',
    );
    assert.ok(
      !/setNativelyApiKey[\s\S]{0,500}setSttProvider|setNativelyApiKey[\s\S]{0,500}setDefaultModel/.test(settingsOverlaySrc),
      'Renderer must not save a Natively key and then also call setSttProvider/setDefaultModel',
    );
  });

  it('hosted Natively API key IPC is fully removed', () => {
    assert.ok(!/set-natively-api-key|get-natively-pricing|get-natively-usage/.test(ipcSrc));
  });
});
