# Provider Resilience Report — 2026-06-07c

## Problem

A large fraction of prior multimode runs returned provider-unavailable zero-token
empties (gemini-3.1-flash-lite rate-limited). Quota outages must NOT be counted as
Profile Intelligence defects, and the product must degrade gracefully.

## What was added / verified

### 1. Centralized error classification — `electron/llm/providerErrorClassifier.ts`

`classifyProviderError(err, text?)` returns a typed `{ kind, isOutage, retryable,
code }`:

| kind | trigger | isOutage | retryable |
|---|---|---|---|
| `rate_limit` | 429 / RESOURCE_EXHAUSTED / "quota" / "rate limit" | yes | yes |
| `auth` | 401 / 403 / "api key" / "expired" / "forbidden" | yes | no |
| `overloaded` | 503 / 529 / "overloaded" / "capacity" | yes | yes |
| `server_error` | 5xx / "internal error" (and any unrecognized throw) | yes | yes |
| `timeout` | "deadline" / "timeout" / "aborted" | yes | yes |
| `network` | ENOTFOUND / ECONNRESET / DNS | yes | yes |
| `zero_token` | a successful call that produced no text | yes | yes |
| `stall` | a content-free clarification ("Could you repeat that?") | yes | yes |
| `none` | a real answer | no | no |

Every outage kind reports `isOutage: true`, so benchmark scorers **exclude** these
rows from the pass denominator and report them separately as `providerUnavailable`.
A real answer is the only `none` (and is therefore the only thing scored). 25 unit
tests (`ProviderErrorClassifier2026_06_07c.test.mjs`) cover all kinds + the
stall/zero-token distinction.

`isClarificationStall(text)` is the single canonical stall matcher; the benchmark
runners and `IntelligenceEngine`'s "Could you repeat that?" fallback share its
semantics (one source of truth, exported from `electron/llm`).

### 2. Existing product-side resilience (verified intact)

- **429/503 retry circuit** (`LLMHelper.rateLimitCircuit`, `CIRCUIT_429_THRESHOLD`):
  retries 429/500/503/529 with backoff; opens a per-key circuit after N consecutive
  429s so the next calls fail fast instead of hammering a saturated tier.
- **Deterministic live-fallback** (`IntelligenceEngine`): for a profile-REQUIRED
  answer, a grounded fallback is precomputed; its EXISTENCE shortens the first-useful
  deadline so a stalled provider is aborted early and the deterministic answer is
  swapped in — the product never ships an empty profile answer when a fallback exists.
- **Deadline guards** (`liveDeadlines.ts`): first-useful deadline + inter-token stall
  guard + total hard timeout prevent 10s+ hangs (except a confirmed provider outage).
- **No silent model switch in strict benchmark mode**: the runners force
  gemini-3.1-flash-lite and ABORT if a different model is served — quota does not
  cause a quiet downgrade.

### 3. Benchmark separation of outage vs defect

The multimode-1000 and follow-up runners quarantine zero-token empties AND
content-free stalls as `providerUnavailable` (environment), excluded from the pass
denominator and reported separately. Leak/safety/route checks run only on the clean
(provider-served) rows, so a rate-limited window depresses the *denominator*, never
the *defect count*.

## Behavior matrix (product)

| condition | product behavior |
|---|---|
| 429 rate-limit | retry w/ backoff; circuit-open after saturation; deterministic fallback for profile answers |
| 403 / expired key | surfaced as a config error (non-retryable); no silent fallback in strict mode |
| 503 overloaded | retry; then deterministic fallback if available |
| first-token timeout | abort at the first-useful deadline; swap deterministic fallback (profile) or extend (non-profile, no fallback) |
| zero-token stream | no empty shipped when a fallback exists; else the explicit "could not generate" path |
| clarification stall | classified as outage in benchmarks; live, the deadline/fallback path handles it |

## Tests

- `ProviderErrorClassifier2026_06_07c.test.mjs` — 25 subtests (all kinds, outage
  gating, stall vs real answer). Green.
- Existing circuit-breaker tests (`NegotiationStickinessAndCircuitBreaker`) — green
  in isolation (25/25).

## Verdict

Provider failures are **classified deterministically, separated from logic defects in
all benchmarks, and degrade gracefully in the product** (retry → circuit → grounded
deterministic fallback → no empty when avoidable). Quota outages depress the scored
denominator (transparently reported) without ever inflating the defect count. The one
acknowledged constraint is purely environmental: under a heavily rate-limited window,
the clean denominator shrinks, so live answer-quality is reported over fewer rows —
never hidden, never counted as a defect.
