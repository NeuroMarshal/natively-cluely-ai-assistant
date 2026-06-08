# Final Profile Intelligence Release Report — 2026-06-07c (follow-up stability hardening)

> Latest round. Adds genuine long-session follow-up stability + provider resilience
> on top of the 2026-06-07 multimode work (below). Detailed companion reports:
> `FINAL_FOLLOWUP_STABILITY_RELEASE_REPORT.md`, `LONG_SESSION_MEMORY_TEST_REPORT.md`,
> `PROVIDER_RESILIENCE_REPORT.md`, `benchmarks/profile-intelligence/final_release_eval_report.md`.

## Executive summary

| metric | result |
|---|---|
| Follow-up stability (resolution, 500 cases) | **100%** (immediate→60min, corrections, all buckets) |
| Long-session scenarios (100 / 364 checks) | **100% / 100% / 0 context-leak checks** |
| Context-free clarification accuracy | **100%** |
| Cross-mode leak / stale-context misuse / salary leak | **0 / 0 / 0** |
| Deterministic route (multimode 1000 / residual 50) | **1000/1000 / 50/50** |
| llm + codeVerification unit tests | **1240 pass / 0 fail** |
| Multimode-1000 live (clean rows) | _(this round's regression run — see final_release_eval_report.md)_ |

## What this round fixed (the 4 remaining issues + the memory model)

1. **Context-free bare follow-ups** ("why?"/"and?"/"continue") with no prior context
   → safe mode-specific clarification, deterministically, in BOTH manual + WTA paths.
   Never self-identifies, never dumps profile, never false-refuses.
2. **Final candidate-answer sanitizer** — strips a trailing assistant-meta sentence
   from candidate answers, with a deterministic fallback if emptied. Tightened after
   code review to preserve NDA caveats / real "AI Researcher" titles / product
   descriptions / "no ratings yet".
3. **Provider resilience** — `classifyProviderError` taxonomy (429/403/503/timeout/
   zero-token/stall) cleanly separates outages from defects; existing retry-circuit +
   deterministic live-fallback prevent empties when a fallback exists.
4. **Long-session memory model** — `SessionMemory` (time-aware decay, mode boundaries,
   corrections, comp-gated-to-negotiation with value-level guard) +
   `resolveSessionFollowup`, proven by a de-circularized, non-skippable 500+100 eval.

## New modules (all in `electron/llm/`, pure + deterministic)

`SessionMemory.ts`, `sessionFollowupResolver.ts`, `providerErrorClassifier.ts`,
`FollowUpResolver.ts` (+ context-free clarification), `ProfileOutputValidator.ts`
(+ `sanitizeCandidateAnswer`). Wired into `IntelligenceEngine.ts` (WTA) +
`ipcHandlers.ts` (manual). New tests: `ContextFreeFollowup`, `CandidateSanitizer`,
`ProviderErrorClassifier`, `SessionMemory`, `SessionFollowup` (2026_06_07c).

## Senior reviews this round

- **@test-engineer** found the eval was partly circular (entity seeded from the answer
  key) and the recall assertion silently skipped on null — BOTH fixed (independent
  extraction + non-skippable assertion), so the 100% is genuine. Added adversarial
  competing-entity / stale-vs-fresh / double-correction / 37-turn cases.
- **@code-reviewer** found 2 HIGH live candidate-sanitizer false-positives (over-
  stripping NDA caveats / "AI Researcher" titles / product descriptions) + a latent
  comp value-level gap + garbled substitution — ALL fixed with regression tests.

## Premium submodule

**No pointer update required** — all changes are in the main repo.

---

# Final Profile Intelligence Release Report — 2026-06-06

Sequential, evidence-based fixes taking Natively's Profile Intelligence and the
`What to answer?` live-copilot surface to a release-ready state. Every fix:
reproduce → root-cause → smallest robust fix → unit + integration tests →
benchmark subset → @test-engineer / @code-reviewer → verdict. The real backend
path is used throughout; nothing is mocked, no answers are hardcoded, no scoring
is loosened to hide failures.

---

## Addendum — Round B (2026-06-06b): real manual-chat failures + 1000-q flash-lite

A second pass fixed **real manual-send-mode failures** from the user's live chat log
(not just benchmark failures), detailed in `MANUAL_CHAT_PROFILE_FIX_REPORT.md`:

1. **Intro typos** ("introduce yourseld") answered "I'm Natively, an AI assistant"
   → typo/greeting-tolerant intro routing + manual intro fast-path; **0 leaks**.
2. **Link/open-source** false-refused ("I can't share") → new `project_link_answer`
   (share loaded URL, else say "not loaded", never invent); **0 false refusals**.
3. **Exact-source-code** hallucinated generic code as real → new
   `source_code_evidence_answer` (real source only if loaded+cited, else conceptual,
   clearly labeled); **0 hallucinated source**.
4. **CRITICAL — stealth/undetectability advice** for hiding from an interviewer →
   new `ethical_usage_answer` safety route (checked FIRST, profile-forbidden,
   knowledge-skipped) + a system-prompt defense-in-depth clause + broad soft-phrasing
   coverage (`isStealthEvasionQuestion`); **0 stealth/evasion leaks**.
5. **Manual voice** inconsistency → interview-style manual → first-person candidate;
   coaching/list → second-person; WTA unchanged.
6. **Product/project claim grounding** → new `project_about_answer` grounded in
   loaded metadata, no overclaim.

**Round-B results (real backend, gemini-3.1-flash-lite):**
- Manual-chat regression (20 real log cases): **100%**, all critical metrics 0.
- 1000-question `gemini-3.1-flash-lite` benchmark: **pass 98.2% · route 100.0% ·
  safety 100.0%**; 0 identity leaks, 0 false refusals, 0 stealth/evasion leaks, 0
  invented links, 0 hallucinated source, 0 empty, 0 ≥10s; p95 first-useful 948ms,
  p99 1191ms. (Run progression as fixes landed: 79.9% → 91.3% → 93.8% → 96.3% →
  98.2%; route 89.7% → 100.0%.)
- 1004 llm unit tests green.

**Round-B gate verdict (gemini-3.1-flash-lite, 1000-q):**

| Gate | Target | Result |
|---|---|---|
| Pass rate | ≥98% | **98.2%** ✓ |
| Route accuracy | ≥99% | **100.0%** ✓ |
| Identity leaks | 0 | **0** ✓ |
| False refusals | 0 | **0** ✓ |
| Context leaks | 0 | **0** ✓ |
| Stealth/evasion leaks | 0 | **0** ✓ |
| Hallucinated exact-code | 0 | **0** ✓ |
| p95 / p99 first-useful | <2500 / <3500ms | **948 / 1191ms** ✓ |
| 10s+ / empty | 0 / 0 | **0 / 0** ✓ |
| Manual real-chat regression | 100% | **100%** ✓ |

The ~18 residual failures are 4 distinct patterns — 2 voice-equivalence strictness
("what is natively built with", "how would you design a rate limiter" — correct
content, defensible route) and 2 intermittent flash-lite stray-"Natively" mentions
in coding answers (route + profile-policy correct; coding template hardened). None
are safety/identity/refusal/leak/hallucination defects.

**Senior review (Round B):** @code-reviewer found and we fixed 3 CRITICAL + 4 HIGH
safety bypasses (soft-phrasing stealth misses, manual fast-path bypass, privacy
carve-out exploit, source/link/intro pattern hijacks). @test-engineer validated the
1000-q benchmark as faithful + non-gameable, confirmed 0 hidden safety defects, and
flagged dataset template-duplication + the coding "Natively" contamination — both
addressed before the authoritative run.

---

## Executive Summary

**Production-ready: YES.**

| Surface | Result |
|---|---|
| Manual 300 benchmark | **95.0% pass · 100.0% route** · 0 leaks · 0 refusals · 0 identity-leaks · p95 first-useful 2031ms |
| What-to-answer 102 benchmark | **100.0% pass** · 0 leaks · 0 refusals · 0 wrong-voice · p95 first-useful 1514ms |

Every release gate passes on fresh full runs through the real backend. The 15
remaining manual "failures" are **all latency-only**, each landing 1233–1847ms —
**every one inside the 2500ms release gate** — against an internal per-difficulty
target (1200ms for "direct") that is tighter than the release definition and below
the provider's own TTFT floor for genuinely LLM-served questions.

### Major fixes completed

1. **Latency root cause (Issue 8) — the highest-leverage fix.** The direct-Gemini
   *text* streaming path made a single un-hedged call, while the vision path already
   hedged flash→flash-lite. On a degraded provider day flash TTFT ran median ~2.9s
   (up to 5.7s) vs flash-lite's steady ~0.55s, pinning ~40% of answers at the
   first-useful deadline. Fix: route the direct-flash text path through the shared,
   unit-tested hedge engine. A/B on the same 60 questions: p95 first-useful 3500ms
   (deadline-pinned) → 2145ms, fallbacks 58 → 0.
2. **Routing (Issues 4–7).** Standalone fragment resolver, voice-control / JD-gap
   routing, `follow_up_answer` floor made profile-FORBIDDEN (kills the last context
   leak), JD-fit-rating disambiguation, salary-negation polarity. Route accuracy
   95.3% → **100.0%**.
3. **Context leak (Issue 6).** "What about data?" no longer dumps the skill list
   (floor is profile-forbidden; the live FollowUpResolver still resolves it richly
   with prior context). Context leaks: 1 → **0**.
4. **Voice / identity (Issues 1, 5).** Voice-control directives ("answer like a
   candidate") route to a first-person candidate answer; WTA identity/profile is
   19/19 first-person. Identity leaks: 1 → **0**.
5. **Transcript cleaner bug.** `cleanText` stripped *every* "right"/"like" — "the
   **right** person" became "the person", breaking JD-fit routing and producing a
   false refusal on the live surface. Now only leading/trailing discourse fillers
   are stripped.

### Remaining risks

- **Provider TTFT variance.** First-useful latency is provider-bound; the hedge
  keeps p95 well under gate across observed windows (1514–2031ms), but a sustained
  provider outage is an environment risk, not a PI defect (graceful fallback covers
  it — 0 empty answers, 0 10s+).
- **Per-difficulty latency target** is stricter than the release gate; LLM-served
  "direct"-difficulty questions can miss it while passing the real gate. Documented,
  not masked.

---

## Baseline vs Final (manual 300, clean, 0 provider errors)

| metric | Baseline (this session, fresh run) | Final |
|---|---:|---:|
| pass rate | 68.7% | **95.0%** |
| route accuracy | 95.3% | **100.0%** |
| unknown_answer | 0 | 0 |
| false refusals | 0 | 0 |
| Natively/assistant identity leaks | 1 | **0** |
| context leaks | 1 | **0** |
| 10s+ latency hard-fails | 0 | 0 |
| empty answers | 0 | 0 |
| p95 first-useful | 3500ms (deadline-pinned) | **2031ms** |
| deadline fallbacks | 62 | **2** |

> Note on the baseline: the prompt cited a prior 93.7%/95.3%. A fresh run at the
> start of this session measured **68.7% pass** because that day's provider TTFT
> tail pushed 62/300 answers into the deadline-fallback — the latency regression the
> hedge fixes. Route/leak/identity numbers matched the cited baseline.

---

## Manual 300 Metrics (final run)

| | |
|---|---:|
| total questions | 300 |
| clean (ex provider errors) | 300 |
| provider errors | 0 |
| **pass rate** | **95.0%** (285/300) |
| **route accuracy** | **100.0%** |
| profile inclusion/exclusion | correct (0 leaks, 0 coding-profile-leak) |
| JD usage accuracy | correct (0 jd leaks) |
| negotiation usage accuracy | correct (0 negotiation leaks) |
| coding contract accuracy | correct |
| voice accuracy | correct (0 wrong-person, 0 identity leaks) |
| follow-up route accuracy | 100% on the follow-up subset |
| unknown fallthrough count | 0 |
| failure count | 15 (all latency-only, all <2500ms gate) |
| fast-path answers | 49 (<5ms, deterministic) |
| deadline fallbacks | 2 |

### Remaining failures (all latency-only)

15 failures, all `firstUseful` between **1233ms and 1847ms**, against the
per-difficulty target (direct 1200ms / medium 1800ms). 14 are "direct"-difficulty
LLM-served answers (intro/skills/jd-fit that synthesize a narrative and so cannot
use the <5ms fast-path); 1 is "medium". **Zero** route, leak, identity, refusal, or
empty failures. Every one is inside the 2500ms release gate.

| failure class | count | within 2500ms gate? |
|---|---:|---|
| latency (per-difficulty target) | 15 | **yes — all 1233–1847ms** |
| route mismatch | 0 | — |
| context/identity/refusal leak | 0 | — |

---

## What-to-Answer Metrics (102 cases)

| | |
|---|---:|
| total WTA cases | 102 |
| **pass rate** | **100.0%** |
| identity/profile pass rate | 100% (19/19) |
| first-person candidate voice | 100% |
| latest-question extraction | correct |
| follow-up resolution | correct (hard cases verified) |
| context usage accuracy | correct |
| identity leak count | **0** |
| false refusal count | **0** |
| context leak count | **0** |
| empty answer count | **0** |
| p95 first-useful | **1514ms** |
| p99 first-useful | 1614ms |
| 10s+ hard-fails | 0 |

All 7 release category groups at 100%: identity/intro/profile (25), JD-fit/recruiter
(20), project/follow-up (12), skill rating/experience (15), coding/technical
exclusion (12), negotiation (6), meeting/lecture/sales exclusion (12).

---

## Latency (manual 300 final, LLM-served first-useful; fast-path excluded)

| metric | TTFT | first-useful | total |
|---|---:|---:|---:|
| avg | ~1300 | ~1300 | ~1500 |
| p50 | 1295 | 1295 | — |
| p95 | 2031 | **2031** | ~3600 |
| p99 | 2078 | **2078** | — |
| max | 2123 | 2123 | 5174 |

- **Slowest 5 total** (full-answer time, not first-useful; all <10s):
  medium_084 coding 5174ms, veryhard_045 jd_fit 4693ms, medium_087 technical 4624ms,
  medium_043 technical 4619ms, medium_044 system_design 4190ms.
- **By answer type (first-useful p50/p95):** identity 1/1077ms (fast-path),
  skill_experience 1170/2066, jd_fit 1405/1970, behavioral 1584/2070, technical
  1236/1923, project 1060/1553, meeting 752/1227, negotiation 1440/1858.
- **timeout count:** 0 · **fallback count:** 2 · **10s+:** 0.

The latency win is the flash→flash-lite text hedge: without it, first-useful pinned
at the 3500ms deadline on ~40% of LLM-served answers.

---

## Files Changed

| file | why |
|---|---|
| `electron/LLMHelper.ts` | flash→flash-lite tail-latency hedge on the direct-Gemini text path (`TEXT_HEDGE_ENABLED`, `GEMINI_TEXT_HEDGE_CONFIG`, hedged dispatch through the shared `runStreamingTextFallback`/`openHedged` engine). |
| `electron/llm/AnswerPlanner.ts` | `classifyStandaloneFragment` + voice-control / JD-gap / topic-shift patterns; `metaDirective` early branch; `follow_up_answer` → profile-FORBIDDEN; JD-fit-rating disambiguation; salary-negation polarity; bounded-length intro patterns. |
| `electron/llm/transcriptCleaner.ts` | only strip filler as leading/trailing discourse runs; preserve mid-sentence content words ("the right person"). |
| `electron/llm/__tests__/UnknownFallthrough.test.mjs` | updated to the improved concrete-type expectations. |
| `electron/llm/__tests__/RoutingReleaseFixes2026_06_06.test.mjs` | NEW — 40 subtests pinning every routing/cleaner fix + regression guards. |
| `electron/llm/__tests__/TextHedgeConfig.test.mjs` | NEW — 6 tests pinning the hedge timing contract. |
| `benchmarks/profile-intelligence/what_to_answer_dataset.json` | expanded 75 → 102 cases; precise "as an AI," leak phrasing. |
| `benchmarks/profile-intelligence/run_what_to_answer_benchmark.ts` | default runs all cases. |
| `benchmarks/profile-intelligence/run_profile_intelligence_benchmark.ts` | fallback first-useful attributed at deadline+1 (closes the very_hard boundary seam). |
| `benchmarks/profile-intelligence/types.ts` | `identity_answer` split out of the profile-fact equivalence class (route accuracy can no longer be inflated by an identity↔skills swap). |
| `benchmarks/profile-intelligence/expand_wta_dataset.cjs` | NEW — idempotent dataset expander. |

## Tests Run

| command | result |
|---|---|
| `tsc -p electron/tsconfig.json --noEmit` | clean (only pre-existing `main.ts` TS7011) |
| `node --test electron/llm/__tests__/**` | **928 pass / 0 fail** |
| `node benchmarks/.../score_profile_benchmark.ts --selftest` | PASSED |
| manual 300 (real backend) | **95.0% pass / 100.0% route** |
| WTA 102 (real backend) | **100.0% pass** |
| services suite | 17 pre-existing failures (better-sqlite3 ABI mismatch under system Node v25 — fail identically with these changes stashed; not regressions) |

## Senior Review

- **@code-reviewer** (full diff): 0 CRITICAL, 0 HIGH, 2 MEDIUM, 3 LOW. Hedge
  timeout/cancellation/double-stream safety verified sound. Both MEDIUM findings
  (over-broad `don't overclaim`, generic JD-gap-bridge) fixed and regression-tested;
  one LOW (coding-ambiguous work-nouns) addressed.
- **@test-engineer** (benchmark validity): benchmark is faithful and non-gameable
  for safety properties; no HIGH defect that fabricates a passing answer. Three
  hardening recommendations applied (split identity equivalence, fallback latency
  attribution, scorer self-test still green). One recommendation — wiring
  `validateProfileEvidence` into scoring to measure fabrication — is noted as a
  documented follow-up (production already runs that validator on the live path).

## Release Verdict

**PRODUCTION-READY.** All stated release gates pass on fresh full benchmark runs
through the real backend:

- manual pass ≥95% → **95.0%** ✓
- manual route ≥97% → **100.0%** ✓
- unknown 0, false refusals 0, identity leaks 0, context leaks 0, coding leak 0,
  negotiation leak 0 → **all 0** ✓
- p95 first-useful <2500ms → **2031ms** ✓; p99 <3500ms → **2078ms** ✓; 10s+ 0 ✓; empty 0 ✓
- WTA pass ≥95% → **100.0%** ✓; identity/profile 100%; first-person voice 100%; all
  WTA leak/refusal/empty/10s+ gates 0 ✓

The 15 remaining manual failures are latency-only against an internal per-difficulty
bar tighter than the release gate; all land 1233–1847ms, inside the 2500ms gate.

**Premium submodule pointer:** no change required — all fixes are in the main repo
(`electron/`, `benchmarks/`); no `premium/` files were modified this pass.
