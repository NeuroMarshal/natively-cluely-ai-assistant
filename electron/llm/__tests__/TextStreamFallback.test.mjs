// electron/llm/__tests__/TextStreamFallback.test.mjs
//
// Tests the TEXT-streaming provider fallback (Phase 3 — kill the 10s wall).
// The text wrapper reuses the proven vision commit-point engine, so these
// tests focus on:
//   1. Text-tuned config (tight TTFT budget, generous inter-chunk).
//   2. The race semantics that matter for the live answer path:
//      - fastest healthy provider wins,
//      - a stalled primary fails over within the TTFT budget,
//      - a pre-commit error silently falls over,
//      - a post-commit error does NOT switch providers (no duplicate output),
//      - exhaustion throws.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/textStreamFallback.js');
const {
  runStreamingTextFallback,
  orderTextByHealth,
  DEFAULT_TEXT_FALLBACK_CONFIG,
} = await import(pathToFileURL(modPath).href);

// ── Fake providers (mirror the vision test helpers) ─────────────────────────

function okProvider(id, tokens, opts = {}) {
  return {
    id, name: id, isLocal: !!opts.isLocal, priority: opts.priority ?? 0,
    _calls: 0,
    open(_signal, _attempt) {
      this._calls++;
      return (async function* () { for (const t of tokens) yield t; })();
    },
  };
}

function throwBeforeFirst(id, errMessage, opts = {}) {
  return {
    id, name: id, isLocal: !!opts.isLocal, priority: opts.priority ?? 0,
    _calls: 0,
    open(_signal, _attempt) {
      this._calls++;
      return (async function* () { throw new Error(errMessage); })();
    },
  };
}

function throwAfterFirst(id, firstTokens, errMessage, opts = {}) {
  return {
    id, name: id, isLocal: !!opts.isLocal, priority: opts.priority ?? 0,
    _calls: 0,
    open(_signal, _attempt) {
      this._calls++;
      return (async function* () {
        for (const t of firstTokens) yield t;
        throw new Error(errMessage);
      })();
    },
  };
}

// First token never arrives until the per-attempt signal aborts (TTFT timeout).
function neverFirst(id, opts = {}) {
  return {
    id, name: id, isLocal: !!opts.isLocal, priority: opts.priority ?? 0,
    _calls: 0,
    open(signal, _attempt) {
      this._calls++;
      return (async function* () {
        await new Promise((resolve, reject) => {
          if (signal.aborted) return reject(new Error('aborted'));
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
        yield 'too-late';
      })();
    },
  };
}

async function collect(gen) {
  const out = [];
  for await (const c of gen) out.push(c);
  return out;
}

function fastHooks(extra = {}) {
  return { now: () => 1_000_000, random: () => 0, sleep: async () => {}, log: () => {}, warn: () => {}, ...extra };
}

// ════════════════════════════════════════════════════════════════════════════
describe('DEFAULT_TEXT_FALLBACK_CONFIG', () => {
  test('has a tight TTFT budget tuned for text first-token', () => {
    assert.ok(DEFAULT_TEXT_FALLBACK_CONFIG.ttftTimeoutMs <= 3_000,
      `text TTFT budget should be tight (<=3s), got ${DEFAULT_TEXT_FALLBACK_CONFIG.ttftTimeoutMs}`);
    assert.ok(DEFAULT_TEXT_FALLBACK_CONFIG.ttftTimeoutMs < DEFAULT_TEXT_FALLBACK_CONFIG.interChunkTimeoutMs,
      'TTFT budget must be smaller than the mid-stream stall budget');
  });
  test('keeps a generous inter-chunk budget so long answers are not cut off', () => {
    assert.ok(DEFAULT_TEXT_FALLBACK_CONFIG.interChunkTimeoutMs >= 15_000);
  });
  test('orderTextByHealth is exported and orders fastest-first', () => {
    const health = new Map([
      ['a', { openUntil: 0, consecutiveFails: 0, ttftEma: 500 }],
      ['b', { openUntil: 0, consecutiveFails: 0, ttftEma: 100 }],
    ]);
    const ordered = orderTextByHealth(
      [{ id: 'a', priority: 0 }, { id: 'b', priority: 1 }],
      health, 1_000_000,
    );
    assert.equal(ordered[0].id, 'b', 'faster TTFT EWMA should be first');
  });
});

describe('runStreamingTextFallback — race semantics', () => {
  test('fastest provider that produces a token wins and streams through', async () => {
    const health = new Map();
    const natively = okProvider('natively', ['Hello', ' world']);
    const out = await collect(runStreamingTextFallback([natively], health, DEFAULT_TEXT_FALLBACK_CONFIG, fastHooks()));
    assert.deepEqual(out, ['Hello', ' world']);
    assert.equal(natively._calls, 1);
  });

  test('a pre-commit error on the primary silently falls over to the next provider', async () => {
    const health = new Map();
    const primary = throwBeforeFirst('natively', 'fetch failed');
    const fallback = okProvider('groq', ['from', ' groq']);
    const out = await collect(runStreamingTextFallback([primary, fallback], health, DEFAULT_TEXT_FALLBACK_CONFIG, fastHooks()));
    assert.deepEqual(out, ['from', ' groq'], 'fallback served, no primary artifact leaked');
    assert.equal(fallback._calls, 1);
  });

  test('a stalled primary (no first token) fails over within the TTFT budget', async () => {
    const health = new Map();
    const stalled = neverFirst('natively');
    const fallback = okProvider('groq', ['ok']);
    // Real timers here (small budget) so the TTFT abort actually fires.
    const cfg = { ...DEFAULT_TEXT_FALLBACK_CONFIG, ttftTimeoutMs: 60, maxAttempts: 1 };
    const out = await collect(runStreamingTextFallback([stalled, fallback], health, cfg, { log: () => {}, warn: () => {} }));
    assert.deepEqual(out, ['ok'], 'stalled primary timed out, fallback served');
    assert.equal(stalled._calls, 1);
  });

  test('a post-commit failure does NOT switch providers (no duplicate output)', async () => {
    const health = new Map();
    const committed = throwAfterFirst('natively', ['partial answer'], 'socket hangup');
    const fallback = okProvider('groq', ['SHOULD-NOT-APPEAR']);
    const out = await collect(runStreamingTextFallback([committed, fallback], health, DEFAULT_TEXT_FALLBACK_CONFIG, fastHooks()));
    assert.deepEqual(out, ['partial answer'], 'partial answer kept; no fallback duplicate');
    assert.equal(fallback._calls, 0, 'fallback never opened after commit');
  });

  test('exhaustion (all providers fail pre-commit) throws', async () => {
    const health = new Map();
    const a = throwBeforeFirst('natively', 'fetch failed');
    const b = throwBeforeFirst('groq', 'fetch failed');
    await assert.rejects(
      () => collect(runStreamingTextFallback([a, b], health, { ...DEFAULT_TEXT_FALLBACK_CONFIG, maxAttempts: 1 }, fastHooks())),
      /All vision providers failed|failed/i,
    );
  });

  test('an outer abort stops the chain without throwing', async () => {
    const health = new Map();
    const ctrl = new AbortController();
    ctrl.abort();
    const p = okProvider('natively', ['x']);
    const out = await collect(runStreamingTextFallback([p], health, DEFAULT_TEXT_FALLBACK_CONFIG, fastHooks(), ctrl.signal));
    assert.deepEqual(out, [], 'aborted before start yields nothing');
  });
});
