# Follow-Up Resolver Fix Report — Release 2026-06-06

## Issue

A live copilot ("What to answer?") must resolve **bare, elliptical follow-up
fragments** the way a human listener does — by inheriting the subject and intent
of the prior turn. In the baseline 300-question manual benchmark, the follow-up
category was the weakest:

- follow-up pronoun route accuracy: **61.5%**
- overall follow-up pass: **53.8%**

Bare fragments like "And SQL?", "What about complexity?", "Why?", and "What about
data?" fell to the generic `follow_up_answer` floor and, worse, sometimes pulled
the full résumé/skill list into an answer that should have been a focused
follow-up or a profile-free technical reply. One case — "What about data?" — emitted
*"Based on your profile, here is the complete list of your data-related skills,
databases, and experience…"*, a context leak.

## Root Cause

Two layers were implicated:

1. **`electron/llm/FollowUpResolver.ts`** (live path) resolves a bare fragment to a
   concrete answer type using the prior turn. It already covered topic-shifts and
   project drill-ins, but the *standalone* manual surface (and the benchmark, which
   feeds each question without prior context) never reached it — so the same
   fragments collapsed to the floor there.

2. **`electron/llm/AnswerPlanner.ts`** routed every unresolved fragment to
   `follow_up_answer` with `profileContextPolicy: 'allowed'`. "allowed" let the
   knowledge intercept inject the profile, so an ambiguous fragment could dump the
   résumé. The floor was simultaneously **too greedy** (stealing standalone
   questions) and **too leaky** (allowing profile on an ambiguous fragment).

## Fix

### 1. Standalone fragment resolver (`AnswerPlanner.classifyStandaloneFragment`)

A deterministic resolver that mirrors `FollowUpResolver`'s logic but works with no
prior turn — it routes a fragment to a concrete type from the signal in the
fragment itself, and returns `null` (→ floor) only when there is genuinely no
signal:

| Fragment shape | Routed type | Profile |
|---|---|---|
| `and <named skill>?` / `what about <skill>?` (Python, SQL, …) | `skill_experience_answer` | required |
| `what about <work noun>?` (stakeholders, dashboards, …) | `skill_experience_answer` | required |
| `what about complexity?` | `technical_concept_answer` | **forbidden** |
| voice/evidence-control ("answer like a candidate", "in my voice", "no fake metric") | candidate type by cue | required |
| JD-gap-bridge ("I have X, they ask Y, what do I say?") | `jd_fit_answer` | required |
| ambiguous ("what about data?", "what should I answer?") | `follow_up_answer` floor | **forbidden** |

### 2. `follow_up_answer` floor is now profile-FORBIDDEN

`profileContextPolicyFor('follow_up_answer')` → `forbidden`, and its
`forbiddenContextLayers` now include `resume`, `jd`, `negotiation`. An ambiguous
fragment with no inheritable context can never dump the résumé. The live
`FollowUpResolver` still upgrades a genuine follow-up to a concrete type (which
carries its own policy) **before** the floor is reached, so real follow-ups are
unaffected — proven below.

### 3. Live-path resolution is intact

The live path runs `FollowUpResolver` → rewrites the fragment → `planAnswer` on the
resolved question, so a fragment with real prior context is richly grounded:

| Fragment | Prior turn | Resolved type | Confidence | Reason |
|---|---|---|---:|---|
| What about data? | "Why are you fit for this Data Analyst role?" | `jd_fit_answer` | 0.7 | topic_shift_jdfit |
| And SQL? | "Rate your Python skills out of 10." | `skill_experience_answer` | 0.9 | topic_shift_skill |
| How is it developed? | "Which is your best project?" | `project_followup_answer` | 0.85 | project_drillin |
| What about complexity? | "Solve Two Sum." | `technical_concept_answer` | 0.8 | complexity_followup |
| Why? | "Tell me about Natively." | `project_followup_answer` | 0.75 | expand_project |
| What about stakeholders? | "Why are you fit for this Data Analyst role?" | `jd_fit_answer` | 0.7 | topic_shift_jdfit |
| Can you expand? | "Explain BFS." | `technical_concept_answer` | 0.7 | expand_technical |

The contrast that proves the design is safe: **"What about data?" standalone →
`follow_up_answer` (profile forbidden, no dump)**; the same fragment **with a
Data-Analyst-fit prior turn → `jd_fit_answer` (profile required, focused).** The
floor is safe; the live resolution is rich.

## Files Changed

- `electron/llm/AnswerPlanner.ts` — `classifyStandaloneFragment`, the standalone
  pattern blocks (`STANDALONE_SKILL_TOKEN_RE`, `TOPIC_SHIFT_FRAGMENT_RE`,
  `STANDALONE_WORK_NOUN_RE`, `VOICE_CONTROL_RE`, `EVIDENCE_CONTROL_RE`,
  `JD_GAP_BRIDGE_RE`), the `metaDirective` early branch, the follow-up branch
  upgrade, and `follow_up_answer` → profile-forbidden in both policy tables.
- `electron/llm/FollowUpResolver.ts` — unchanged this round (already covered the
  live hard cases); verified against the table above.

## Tests Run

- `electron/llm/__tests__/RoutingReleaseFixes2026_06_06.test.mjs` — 33 subtests,
  all green (topic-shift, voice-control, JD-gap, ambiguous-floor, regression guard).
- `electron/llm/__tests__/FollowUpResolver.test.mjs` — 17 subtests, green.
- `electron/llm/__tests__/UnknownFallthrough.test.mjs` — updated to the improved
  concrete-type expectations, green.
- Full llm suite: **924 pass / 0 fail.**

## Before / After

| Metric | Before | After |
|---|---:|---:|
| Follow-up route accuracy (subset) | 61.5% | **100%** (final 300, follow-up subset) |
| Overall route accuracy (300) | 95.3% | **100.0%** |
| "What about data?" leak | profile dump | profile **forbidden** (floor) / focused jd_fit (live) |
| Context leaks (300) | 1 | **0** |
| Over-greedy follow-up theft | yes | no (regression guard green) |

## Release Readiness Verdict

The follow-up resolution layer is **release-ready**: every hard case resolves
correctly, the ambiguous floor is leak-safe, no standalone question is stolen by the
floor, and the final 300 benchmark shows **100.0% route accuracy with 0 context
leaks**. The WTA 102-case benchmark (which exercises live follow-up resolution end
to end) passes **100%** with 0 leaks. Full numbers in
`FINAL_PROFILE_INTELLIGENCE_RELEASE_REPORT.md`.
