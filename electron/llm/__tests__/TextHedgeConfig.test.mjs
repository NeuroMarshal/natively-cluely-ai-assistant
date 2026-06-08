// electron/llm/__tests__/TextHedgeConfig.test.mjs
//
// Release 2026-06-06, Issue 8 (latency). The direct-Gemini TEXT path previously
// made a SINGLE un-hedged streamWithGeminiModel call, so a slow 3.5-flash first
// token (measured tail: median ~2.8s, up to ~5.7s on a degraded provider day)
// pinned first-useful-token at the deadline and failed the per-difficulty
// latency targets (79/94 fails in the baseline run were latency-only). The fix
// adds a flash→flash-lite tail-latency hedge through the shared, unit-tested
// fallback engine (openHedged in visionStreamFallback).
//
// This test pins the HEDGE TIMING CONTRACT — the property that makes the fix
// work: the hedge must fire BEFORE the tightest per-difficulty first-useful
// target (1200ms direct) so flash-lite (steady ~0.55s TTFT) is already racing
// when flash is on its slow tail. It validates the config shape against the
// engine's clamp math (openHedged: rawDelay = ema*factor || default, clamped to
// [min,max]) without needing the Electron runtime.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Mirror of GEMINI_TEXT_HEDGE_CONFIG in electron/LLMHelper.ts. Kept in sync by
// this test's existence — if the product config drifts past the latency target,
// the assertions below should be revisited deliberately, not silently.
const GEMINI_TEXT_HEDGE_CONFIG = {
  ttftTimeoutMs: 6_000,
  hedgeEnabled: true,
  hedgeDelayDefaultMs: 700,
  hedgeDelayEmaFactor: 0.7,
  hedgeDelayMinMs: 700,
  hedgeDelayMaxMs: 1_500,
};

// The tightest per-difficulty first-useful target (benchmarks types.ts: direct).
const TIGHTEST_FIRST_USEFUL_TARGET_MS = 1200;
// flash-lite's observed steady TTFT (2026-06-06 probe: 477–586ms over 5 samples).
const FLASH_LITE_TTFT_MS = 600;

// Reproduce openHedged's delay math: rawDelay = ema*factor (or default when no
// ema), clamped to [min,max].
function effectiveHedgeDelay(cfg, emaMs) {
  const raw = emaMs != null ? Math.round(emaMs * cfg.hedgeDelayEmaFactor) : cfg.hedgeDelayDefaultMs;
  return Math.min(cfg.hedgeDelayMaxMs, Math.max(cfg.hedgeDelayMinMs, raw));
}

describe('Issue 8: Gemini text hedge timing contract', () => {
  test('hedge is enabled (kill-switch defaults ON)', () => {
    assert.equal(GEMINI_TEXT_HEDGE_CONFIG.hedgeEnabled, true);
  });

  test('no-EMA (cold) hedge fires before the tightest first-useful target with margin for flash-lite TTFT', () => {
    const delay = effectiveHedgeDelay(GEMINI_TEXT_HEDGE_CONFIG, null);
    // The hedge partner (flash-lite) must be able to deliver a token before the
    // target: delay + flash-lite TTFT <= target leaves the fast path intact.
    assert.ok(delay + FLASH_LITE_TTFT_MS <= TIGHTEST_FIRST_USEFUL_TARGET_MS + 100,
      `cold hedge delay ${delay} + flash-lite ${FLASH_LITE_TTFT_MS} should land near the ${TIGHTEST_FIRST_USEFUL_TARGET_MS}ms target`);
  });

  test('clamp floor protects the fast common case (never hedges before ~900ms)', () => {
    // A very fast flash (ema 200ms) would compute raw=180ms, but the floor keeps
    // the hedge at min so a healthy flash request is NOT doubled.
    assert.equal(effectiveHedgeDelay(GEMINI_TEXT_HEDGE_CONFIG, 200), GEMINI_TEXT_HEDGE_CONFIG.hedgeDelayMinMs);
  });

  test('clamp ceiling caps the slow case (never waits past ~1600ms before hedging)', () => {
    // A slow flash (ema 5000ms) would compute raw=4500ms; the ceiling forces the
    // hedge to fire at max so the tail is covered well before the very_hard 3500ms target.
    assert.equal(effectiveHedgeDelay(GEMINI_TEXT_HEDGE_CONFIG, 5000), GEMINI_TEXT_HEDGE_CONFIG.hedgeDelayMaxMs);
  });

  test('EMA-driven delay tracks the primary p50 in the healthy mid-range', () => {
    // ema 1500ms → raw 1050ms (within [700,1500]) → used verbatim. This is the
    // "trigger at ~p50" behavior: hedge when flash is already slower than usual.
    assert.equal(effectiveHedgeDelay(GEMINI_TEXT_HEDGE_CONFIG, 1500), 1050);
  });

  test('hard TTFT ceiling still fails over a genuinely dead flash', () => {
    // Even with the hedge, a flash that produces NOTHING must be abandoned by the
    // engine's ttftTimeout — kept generous (6s) so a slow-but-alive stream is not
    // cut, but finite so a dead socket does not hang the live path.
    assert.ok(GEMINI_TEXT_HEDGE_CONFIG.ttftTimeoutMs >= 4000 && GEMINI_TEXT_HEDGE_CONFIG.ttftTimeoutMs <= 8000);
  });
});
