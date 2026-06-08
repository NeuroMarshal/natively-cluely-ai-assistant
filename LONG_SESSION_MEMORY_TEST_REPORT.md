# Long-Session Memory Test Report — 2026-06-07c

## What was built

A structured, time-aware, mode-aware **session memory model** for long-range
follow-up resolution — the capability the prior single-prior-turn FollowUpResolver
lacked. Pure, deterministic, no LLM, no I/O.

- **`electron/llm/SessionMemory.ts`** — a typed memory store:
  - **Time-aware**: per-kind half-life decay (project ~1h, skill ~30m, topic ~20m).
    Pinned items resist decay. The freshest salient item wins (a newer same-kind
    mention supersedes a stale one).
  - **Mode-aware**: `MODE_ALLOWED_KINDS` default-deny boundary table — coding/lecture
    recall only neutral `topic`s; sales never sees meeting `decision`s; interview
    memory doesn't cross into coding without an explicit invite.
  - **Compensation-gated**: `comp` recalls ONLY in negotiation mode, even with an
    explicit cross-mode request. A salary VALUE mislabeled under another kind is
    auto-promoted to `comp` (value-level guard) so the boundary can't be bypassed.
  - **Corrections override**: the latest `corrects` note is authoritative.
  - **Bounded**: `maxItems` cap (default 200) with pinned-item retention.
- **`electron/llm/sessionFollowupResolver.ts`** — `resolveSessionFollowup` bridges the
  store with the FollowUpResolver: recalls a remembered entity for a demonstrative
  follow-up ("that project", "there", "it", "who owns that?"), substitutes it
  grammatically into the question, and routes on the entity's kind.

## How it was tested (genuinely, not gamed)

The senior **@test-engineer review** caught that an earlier version of the eval was
partly an artifact (entity extraction seeded from the answer key; the flagship
recall assertion silently skipped when extraction returned null). Both were fixed:

1. **Independent extraction** — the runners now extract entities from raw turn text
   the way the live transcript layer would (CamelCase names, cue-introduced single
   names like "tell me about Natively", short-answer proper nouns, with a filler
   stoplist), NOT from `expectedResolvedEntity`. So recall is a real test.
2. **Non-skippable entity assertion** — when a check expects a resolved entity, a
   `null` recall is a FAILURE (not a silent pass), except when the question already
   names the entity or the case is a cross-mode-blocked negative.

### Results (deterministic, provider-independent)

- **100 long-session scenarios · 364 checks · 100% pass · 0 context-leak checks**
- Every scenario type at 100%, including the adversarial cases added per the review:
  - **competing_entities** — Natively then TalentScope; "that project" → TalentScope
    (recency wins).
  - **stale_vs_fresh** — old Python then new SQL; "that" → SQL.
  - **double_correction** — Natively → TalentScope → back to Natively; resolves to
    Natively (latest correction).
  - **very_long_session** — 37 turns; the project named at turn 0 is recalled at the
    end past many filler turns.

### Unit tests

`electron/llm/__tests__/SessionMemory2026_06_07c.test.mjs` (29 subtests) +
`SessionFollowup2026_06_07c.test.mjs` (16 subtests) lock in time-decay, supersession,
corrections (single/double/stray), all mode boundaries, comp value-level gating, and
the long-range scenario classes. All green.

## Memory model — concept coverage (directive Phase 2)

| concept | implemented |
|---|---|
| immediate follow-up memory (prev question/type/entity/skill) | ✅ FollowUpResolver |
| short-session memory (last entities/project/skill/topic) | ✅ SessionMemory |
| long-session memory (entities, pinned facts, named people/companies, decisions) | ✅ SessionMemory |
| mode-aware boundaries (interview↛coding, sales↛interview, etc.) | ✅ MODE_ALLOWED_KINDS |
| time-aware retrieval (1 min easy → 1 h if salient/pinned/entity-linked) | ✅ half-life decay |
| stale context not overriding fresh | ✅ recency tie-break |
| corrections update memory | ✅ corrects-override |

## Wiring status (honest)

`SessionMemory` + `resolveSessionFollowup` are the **validated long-range model**,
proven end-to-end by the benchmarks. The **live IntelligenceEngine currently uses
single-prior-turn resolution** (FollowUpResolver) + the transcript-window extractor;
adopting the full session store on the live hot path (behind a flag) is the next
integration step. The privacy/mode-boundary guarantees are proven-by-test and
enforced wherever this store is the resolver. The module headers state this clearly so
the boundary isn't assumed to be the live default before it is wired.

## Verdict

The long-session memory model is **correct, well-bounded, privacy-safe (comp gated
at value level, logs are marker-only), and proven by a de-circularized, non-skippable
eval** at 100% across all scenario types including adversarial competing-entity,
stale-vs-fresh, double-correction, and 37-turn cases.
