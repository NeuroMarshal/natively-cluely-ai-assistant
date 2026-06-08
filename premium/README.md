# `premium/` — Local Extension Re-implementation (AGPL-3.0)

This directory used to be a **private, proprietary git submodule**. In this fork
it is a **clean-room, open-source AGPL-3.0 re-implementation** of the modules the
rest of the app depends on, so the project compiles, runs and tests with every
former paid feature unlocked and no advertising. See `../FORK_NOTICE.md` for the full notice.

Nothing here phones home, checks a license server, or gates a feature behind
payment.

## Layout

```
premium/
├── electron/
│   ├── services/
│   │   ├── LicenseManager.ts        # local compatibility shim (nothing to sell)
│   │   └── licenseVerifyPolicy.ts   # fail-open verify-result policy
│   └── knowledge/
│       ├── KnowledgeOrchestrator.ts     # the engine: ingest, ground, route, negotiate
│       ├── KnowledgeDatabaseManager.ts  # context_nodes + documents + artifacts (sqlite)
│       ├── DocumentReader.ts            # pdf / docx / txt → text
│       ├── DocumentChunker.ts           # structured data → retrievable nodes
│       ├── HeuristicExtractor.ts        # LLM-free resume/JD parser (fallback)
│       ├── ProfileContextBuilder.ts     # <candidate_profile>/<target_job> grounding
│       ├── ProfilePackBuilder.ts        # category-scoped structured pack
│       ├── IntentClassifier.ts          # question → intent (+ comp stickiness)
│       ├── skillsUtil.ts                # categorized-skills helpers
│       ├── NegotiationConversationTracker.ts  # comp detection + live state
│       ├── NegotiationEngine.ts         # AOT negotiation script
│       ├── LiveNegotiationAdvisor.ts    # real-time coaching note + script
│       ├── CompanyResearchEngine.ts     # tailored company dossier
│       ├── TavilySearchProvider.ts      # optional web search (user Tavily key)
│       └── types.ts                     # shared types (DocType, negotiation, …)
└── src/
    ├── ProfileVisualizer.tsx        # read-only parsed-profile view
    ├── NegotiationCoachingCard.tsx  # in-meeting coaching card
    └── ModesSettings.tsx            # modes config panel (no Pro gate)
```

## How it's wired

- `electron/premium/featureGate.ts` probes for `LicenseManager` and
  `KnowledgeOrchestrator` here; both exist, so former paid features turn ON.
- `electron/main.ts` / `electron/ipcHandlers.ts` `require()` these modules at
  runtime and inject the open-source LLM / embedding helpers into the
  orchestrator.
- `src/premium/index.tsx` glob-imports `premium/src/*.tsx`; the functional
  components resolve here, the advertising components resolve to null.

The build (`scripts/build-electron.js`, esbuild) compiles `premium/electron/**`
alongside `electron/**` into `dist-electron/`.
