# Fork Notice - Open-Source Local Re-implementation

**Modified:** 2026-06-08
**License:** GNU Affero General Public License v3.0 (AGPL-3.0) — unchanged from upstream.

This repository is a **modified fork** of the upstream Natively AI meeting copilot.
In accordance with AGPL-3.0 section 5(a), this notice records that the work was
modified and gives the date of those modifications.

This notice is informational only and is not legal advice.

## What changed

The upstream project is AGPL-3.0. This fork removes hosted service integrations,
payment/trial/upgrade UI, and plan-gated runtime checks from the desktop app.
Former gated desktop functionality has been reworked to run as local AGPL-3.0
source in this repository.

This fork makes the project **genuinely open source**:

1. **The private/hosted premium surface was removed or replaced** with local,
   tracked AGPL-3.0 source. The local implementation lives in `premium/` and is
   compiled as part of this repository like any other source.

   - `premium/electron/services/` — compatibility shims for legacy license
     call sites. They do not sell, verify, or gate local desktop features.
   - `premium/electron/knowledge/` — the full profile-intelligence engine:
     `KnowledgeOrchestrator`, `KnowledgeDatabaseManager`, document ingestion
     (`DocumentReader`, `DocumentChunker`, `HeuristicExtractor`), grounding
     (`ProfileContextBuilder`, `ProfilePackBuilder`), intent routing
     (`IntentClassifier`), skills (`skillsUtil`), negotiation
     (`NegotiationConversationTracker`, `NegotiationEngine`,
     `LiveNegotiationAdvisor`) and company research
     (`CompanyResearchEngine`, `TavilySearchProvider`). Tavily is optional and
     uses the user's own key when configured.
   - `premium/src/` — the functional UI components (`ProfileVisualizer`,
     `NegotiationCoachingCard`, `ModesSettings`).

2. **Advertising, trial, quota and upsell UI is removed.** Upgrade prompts,
   promo toasters, quota banners, checkout links and plan gates were deleted or
   converted to local compatibility no-ops. Former Pro desktop features are not
   paywalled in this fork.

3. **Hosted Natively API paths are disabled in the desktop app.** Existing
   compatibility IPC names may remain so old renderer/preload callers do not
   crash, but they do not contact the legacy hosted API for pricing, trials,
   quota, entitlement or managed STT.

## Your obligations if you redistribute this fork

AGPL-3.0 still applies to the whole work:

- Keep it under AGPL-3.0-or-later and keep the `LICENSE` file and upstream
  copyright notices intact.
- Keep this modification notice (or an equivalent one).
- If you run a modified version that users interact with over a network, you must
  offer those users the corresponding source of your version (AGPL-3.0 section
  13).
- If you distribute binaries or installers, provide the corresponding source for
  that exact build, including local changes and build scripts needed to recreate
  it.

This fork is free software: there is nothing to purchase and no telemetry-gated
functionality.
