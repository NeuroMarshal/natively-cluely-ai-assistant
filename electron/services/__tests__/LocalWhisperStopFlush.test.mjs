import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../../audio/LocalWhisperSTT.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const stopStart = source.indexOf('    stop(): void');
const stopEnd = source.indexOf('    write(chunk: Buffer): void', stopStart);
const stopSource = source.slice(stopStart, stopEnd);
const flushPendingStart = source.indexOf('    private flushPending(): void');
const flushPendingEnd = source.indexOf('    private beginWorkerTermination', flushPendingStart);
const flushPendingSource = source.slice(flushPendingStart, flushPendingEnd);
const listenerStart = source.indexOf('    private attachWorkerListeners(): void');
const listenerEnd = source.indexOf('    private flushPending(): void', listenerStart);
const listenerSource = source.slice(listenerStart, listenerEnd);
const dispatchStart = source.indexOf('    private dispatchFinal');
const dispatchSource = source.slice(dispatchStart, source.indexOf('    private sendTranscribe', dispatchStart));
const sendStart = source.indexOf('    private sendTranscribe');
const sendSource = source.slice(sendStart, source.indexOf('    private postToWorker', sendStart));
const terminateStart = source.indexOf('    private beginWorkerTermination');
const terminateEnd = source.indexOf('    private terminateWorkerProcess', terminateStart);
const terminateSource = source.slice(terminateStart, terminateEnd);

test('LocalWhisperSTT.stop does not clear queued VAD finals before worker readiness', () => {
  assert.ok(stopStart >= 0, 'stop should exist');
  assert.doesNotMatch(stopSource, /this\.pendingAudio = \[\];/);
  assert.match(stopSource, /this\.isDrainingFinals = true;[\s\S]*segs\.forEach\(s => this\.dispatchFinal\(s\.samples\)\);/);
  assert.match(stopSource, /shouldKeepWorkerForFinals[\s\S]*this\.pendingAudio\.length > 0/);
});

test('LocalWhisperSTT drains queued stop-time finals before terminating worker', () => {
  assert.ok(flushPendingStart >= 0, 'flushPending should exist');
  // dispatchFinal falls back to a worker final inference only when no streamed
  // partial exists; the drain counter is incremented exactly once, inside
  // sendTranscribe (not also in dispatchFinal — that was a double-count).
  assert.match(dispatchSource, /this\.sendTranscribe\(audio, false\);/);
  assert.match(sendSource, /if \(!streaming\) \{\s*\n\s+this\.drainingFinalsInFlight\+\+;\s*\n\s+\}/);
  assert.match(flushPendingSource, /queued\.forEach\(audio => this\.sendTranscribe\(audio, false\)\);/);
  assert.match(listenerSource, /!this\.isActive && !\(this\.isDrainingFinals && msg\.type === 'result'\)/);
  assert.match(listenerSource, /this\.drainingFinalsInFlight = Math\.max\(0, this\.drainingFinalsInFlight - 1\);/);
  assert.match(listenerSource, /this\.beginWorkerTermination\(this\.worker\);/);
});

test('LocalWhisperSTT retains a termination timer for every retiring worker', () => {
  assert.match(source, /workerTerminateTimers = new Set<ReturnType<typeof setTimeout>>\(\);/);
  assert.doesNotMatch(terminateSource, /clearTimeout/);
  assert.match(terminateSource, /this\.workerTerminateTimers\.add\(t\);/);
  assert.match(terminateSource, /this\.workerTerminateTimers\.delete\(t\);[\s\S]*this\.terminateWorkerProcess\(w\);/);
});
