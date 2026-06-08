// Regression test for "STT reconnect storm under bad network" bug class.
//
// Without an exponential-backoff cap, a refactor that drops the multiplier
// — or sets reconnectAttempts to 0 on every close — turns a transient
// network blip into a 60 reconnects/minute stampede against the upstream
// STT provider. Three issues already landed in this batch touch this code
// path (#1, #2, #9), so the structural invariant is worth pinning so a
// future refactor that introduces a tight reconnect loop fails CI.
//
// Strategy: structural assertions against DeepgramStreamingSTT. We assert:
//   - a base delay constant exists (≥ 1000 ms),
//   - a max delay/attempts cap exists,
//   - the scheduling code multiplies by 2 ** reconnectAttempts (or
//     equivalent capped exponential) and respects the cap.
//
// We do NOT test the literal numbers — a refactor may legitimately tune
// them. We test that the SHAPE of capped exponential backoff exists, so
// a refactor that accidentally drops the cap fails the test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const dgSttSource  = readFileSync(path.join(root, 'electron/audio/DeepgramStreamingSTT.ts'), 'utf8');

test('DeepgramStreamingSTT.scheduleReconnect uses capped exponential backoff with a base delay ≥ 1 second', () => {
  const baseMatch = /(?:RECONNECT_BASE_DELAY_MS|RECONNECT_BASE_MS|BASE_RECONNECT_DELAY_MS)\s*=\s*([\d_]+)/.exec(dgSttSource);
  const maxMatch  = /(?:RECONNECT_MAX_DELAY_MS|MAX_BACKOFF_MS|MAX_RECONNECT_DELAY_MS)\s*=\s*([\d_]+)/.exec(dgSttSource);
  assert.ok(baseMatch, 'BUG: DeepgramStreamingSTT must declare a base reconnect delay constant.');
  assert.ok(maxMatch,  'BUG: DeepgramStreamingSTT must declare a max delay constant.');

  const base = Number(baseMatch[1].replace(/_/g, ''));
  const max  = Number(maxMatch[1].replace(/_/g, ''));
  assert.ok(base >= 1000, `BUG: Deepgram base reconnect delay is ${base}ms; must be ≥ 1000ms.`);
  assert.ok(max >= base && max <= 120_000, `BUG: Deepgram max backoff out of range: ${max}ms.`);

  // Cap the absolute attempt count too — Deepgram is paid; we should give up at SOME point.
  const attemptsMatch = /(?:RECONNECT_MAX_ATTEMPTS|MAX_RECONNECT_ATTEMPTS)\s*=\s*(\d+)/.exec(dgSttSource);
  assert.ok(
    attemptsMatch,
    'BUG: DeepgramStreamingSTT must declare a max-attempts constant — without one, the reconnect path can keep burning Deepgram quota forever.',
  );
  const attempts = Number(attemptsMatch[1]);
  assert.ok(
    attempts >= 3 && attempts <= 50,
    `BUG: Deepgram max attempts (${attempts}) out of range [3, 50]. Below 3 strands the user on a brief blip; above 50 burns paid quota during sustained outages.`,
  );

  // Verify the scheduler enforces both:
  assert.ok(
    /Math\.pow\s*\(\s*2\s*,[\s\S]{0,40}reconnectAttempts/.test(dgSttSource),
    'BUG: Deepgram scheduleReconnect must apply Math.pow(2, reconnectAttempts).',
  );
  // Match Math.min(...) containing the MAX constant on either side. The inner
  // expression may contain Math.pow(2, ...) parens, so we allow balanced
  // content up to ~200 chars.
  const dgMinRe = /Math\.min\s*\([\s\S]{0,300}?(?:RECONNECT_MAX_DELAY_MS|MAX_BACKOFF_MS|MAX_RECONNECT_DELAY_MS)/;
  assert.ok(
    dgMinRe.test(dgSttSource),
    'BUG: Deepgram scheduleReconnect must cap the computed delay via Math.min(..., MAX_DELAY).',
  );
  assert.ok(
    /reconnectAttempts\s*>=\s*(?:RECONNECT_MAX_ATTEMPTS|MAX_RECONNECT_ATTEMPTS)/.test(dgSttSource),
    'BUG: Deepgram scheduleReconnect must short-circuit when reconnectAttempts >= MAX_ATTEMPTS (so an infinite loop is impossible).',
  );
});
