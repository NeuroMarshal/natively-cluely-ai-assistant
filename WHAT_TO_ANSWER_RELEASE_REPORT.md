# What-To-Answer (Live Copilot) Release Report — 2026-06-06

`What to answer?` is Natively's Cluely-style "what should I say next?" surface. It
listens to the live transcript, extracts the latest meaningful interviewer
question, resolves follow-ups, picks the answer type, uses only the allowed
context, and generates exactly what the candidate should say next — in **first-person
candidate voice**.

## Executive Summary

**Production-ready: YES** (WTA surface).

A dedicated 102-case WTA benchmark, run end-to-end through the real backend
(`WhatToAnswerLLM` → real provider → real embedded profile), passes **102/102 =
100.0%** with **every** release gate green.

| Gate | Target | Result |
|---|---|---|
| WTA pass rate | ≥95% | **100.0%** (102/102) |
| identity/profile pass | 100% | **100%** (19/19) |
| first-person candidate voice | ≥98% | **100%** |
| Natively/assistant identity leaks | 0 | **0** |
| false refusals | 0 | **0** |
| context leaks (profile/jd/negotiation in forbidden) | 0 | **0** |
| empty answers | 0 | **0** |
| coding profile leakage | 0 | **0** |
| negotiation leaks | 0 | **0** |
| p95 first-useful token | <2500ms | **1514ms** |
| p99 first-useful token | <3500ms | **1614ms** |
| 10s+ latency hard-fails | 0 | **0** |

## The original WTA failures — all fixed

The prompt called out these historical WTA failures. Verified fixed (each is a live
102-case benchmark case):

| Transcript | Old (broken) | Now |
|---|---|---|
| "What is your name?" | "I can't share that information." | "My name is Evin John." |
| "Who are you?" | "I'm Natively, an AI assistant." | "My name is Evin John." (first person) |
| "Give me a quick introduction" | third-person | "I'm Evin John, an AI & Full Stack Engineer Intern…" |
| "Give me the 30-second version of who you are" | unknown / meeting fallback | identity, first-person |
| "Why are you the right person for this position?" | meeting fallback (refusal) | jd_fit, first-person |

## Benchmark design (Issue 3)

- `benchmarks/profile-intelligence/what_to_answer_dataset.json` — **102 cases**, each
  a live transcript window ending on the latest interviewer turn. No raw expected
  answers; routing / voice / context / leak / latency are scored, plus a
  `mustNotContain` substring blocklist (identity leak, refusal, wrong-person).
- `benchmarks/profile-intelligence/run_what_to_answer_benchmark.ts` — runs the REAL
  `WhatToAnswerLLM.generateStream` path through the centralized live-deadline driver
  (`raceStreamWithDeadline`); nothing mocked.
- `benchmarks/profile-intelligence/what_to_answer_benchmark_report.md` — generated.
- Scripts: `benchmark:wta` (all 102), `benchmark:wta:75`, `benchmark:wta:100`.

### Category coverage (7 release groups)

| Group | Pass |
|---|---:|
| identity/intro/profile | 25/25 (100%) |
| JD-fit/recruiter | 20/20 (100%) |
| project/follow-up | 12/12 (100%) |
| skill rating/experience | 15/15 (100%) |
| coding/technical exclusion | 12/12 (100%) |
| negotiation | 6/6 (100%) |
| meeting/lecture/sales exclusion | 12/12 (100%) |

## Latency (LLM-served first-useful token, 102 cases, 0 fast-path)

| metric | value |
|---|---:|
| p50 | 1109ms |
| p90 | 1388ms |
| p95 | **1514ms** |
| p99 | **1614ms** |
| max | 3500ms (deadline-bounded; single LLM-served tail) |

The headline latency win this release is the **flash→flash-lite tail-latency hedge**
on the direct-Gemini text path (see `FINAL_PROFILE_INTELLIGENCE_RELEASE_REPORT.md`,
Issue 8). Without it, the WTA run pinned ~40% of answers at the deadline; with it,
p95 first-useful is 1514ms.

## Architecture (Issues 1 & 2)

- **Single source of truth.** WTA has no separate router — it receives the same
  `AnswerPlan` from `AnswerPlanner.planAnswer` that the manual surface uses. The
  `WtaManualParity` test proves WTA and manual agree on `answerType` and
  `profileContextPolicy` for equivalent questions; only the **voice** differs
  (WTA = first_person_candidate).
- **Candidate-voice contract.** Profile/identity/interview answer types force
  `voicePerspective = first_person_candidate`; `ProfileOutputValidator` rejects
  assistant-identity leaks, false refusals, and wrong-person voice post-generation,
  with deterministic repair → stricter regen → deterministic fallback.
- **Context safety.** `streamContextPolicy` / `forbiddenContextLayers` gate every
  layer: coding/technical/meeting/lecture/sales answers forbid the résumé; the
  bare follow-up floor forbids profile so an ambiguous fragment can't dump it.

## Files Changed (WTA-relevant)

- `electron/LLMHelper.ts` — flash→flash-lite text hedge (`GEMINI_TEXT_HEDGE_CONFIG`,
  `TEXT_HEDGE_ENABLED`, hedged direct-Gemini text dispatch).
- `electron/llm/AnswerPlanner.ts` — standalone fragment resolver, voice-control /
  JD-gap-bridge routing, bounded-length intro patterns, `follow_up_answer` →
  profile-forbidden, JD-fit-rating disambiguation.
- `electron/llm/transcriptCleaner.ts` — stop stripping mid-sentence content words
  ("the **right** person" no longer becomes "the person").
- `benchmarks/profile-intelligence/what_to_answer_dataset.json` — expanded 75 → 102
  cases across the 7 groups; precise "as an AI," leak phrasing (job-title false-positive fix).
- `benchmarks/profile-intelligence/run_what_to_answer_benchmark.ts` — default runs all cases.

## Tests Run

- Full llm unit suite: **924 pass / 0 fail.**
- `WtaManualParity`, `WhatToAnswerContract`, `WhatToAnswerDeterministic`,
  `RoutingReleaseFixes2026_06_06`, `TextHedgeConfig`, `UnknownFallthrough`,
  `FollowUpResolver` — all green.
- WTA benchmark (real backend): **102/102 = 100.0%.**

## Release Verdict

The `What to answer?` surface is **production-ready**. Every release gate passes on a
fresh full benchmark through the real backend path. No identity leaks, no false
refusals, no context leaks, no empty answers, no 10s+ waits; first-person candidate
voice on 100% of candidate answers; p95 first-useful 1514ms.
