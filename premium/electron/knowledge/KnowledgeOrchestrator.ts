// premium/electron/knowledge/KnowledgeOrchestrator.ts
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// The heart of the profile-intelligence engine. It ingests the user's resume /
// JD, keeps the retrievable corpus embedded in a consistent vector space (with
// graceful degrade-to-local when the cloud embedder is down), and — at question
// time — injects a grounded context block so the assistant answers from the
// user's OWN data. It also drives the live negotiation coaching path.
//
// It builds on the open-source primitives (EmbeddingPipeline, manual profile
// fast-path, profileGroundingV2 flag) wired in by electron/main.ts.

import { DocType } from './types';
import type {
  KnowledgeResult, KnowledgeStatus, ProfileData, StructuredResume, StructuredJD,
  KnowledgeDocument, ContextNode,
} from './types';
import { KnowledgeDatabaseManager } from './KnowledgeDatabaseManager';
import { DocumentReader } from './DocumentReader';
import { createDocumentNodes } from './DocumentChunker';
import { HeuristicExtractor } from './HeuristicExtractor';
import { normalizeSkills, flattenSkills, coerceSkills } from './skillsUtil';
import { buildTargetJobBlock, GROUNDING_RULES } from './ProfileContextBuilder';
import {
  detectProfileCategories, detectEntityCategories, hasCategoryData, buildCategoryPack,
  isPersonaFitQuestion, buildPersonaFallback, buildInclusionBiasIdentity,
} from './ProfilePackBuilder';
import type { ProfileCategory } from './ProfilePackBuilder';
import { classifyIntentWithContext } from './IntentClassifier';
import type { QueryIntent } from './IntentClassifier';
import { NegotiationConversationTracker } from './NegotiationConversationTracker';
import { NegotiationEngine } from './NegotiationEngine';
import { LiveNegotiationAdvisor } from './LiveNegotiationAdvisor';
import { CompanyResearchEngine } from './CompanyResearchEngine';
import { tryBuildManualProfileFastPathAnswer } from '../../../electron/llm/manualProfileIntelligence';
import { isProfileGroundingV2Enabled } from '../../../electron/llm/profileGroundingV2';

type GenerateContentFn = (contents: Array<{ text: string }> | string) => Promise<string>;
type EmbedFn = (text: string) => Promise<number[]>;
type FastQueryEmbed = () => {
  dimensions: number | null;
  space: string | null;
  embed: (text: string) => Promise<number[] | null>;
};
type ConversationContext = { recentInterviewerComp: boolean; lastInterviewerTurn?: string } | null;

function floatsToBlob(vec: number[]): Buffer {
  const buf = Buffer.alloc(vec.length * 4);
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i] ?? 0, i * 4);
  return buf;
}

function tryParseJSON<T = any>(text: string): T | null {
  if (!text) return null;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text) as T;
  } catch {
    return null;
  }
}

const RESUME_EXTRACTION_PROMPT = (text: string): string =>
  'Extract structured profile data from the RESUME TEXT below. Return STRICT JSON ' +
  'with keys: identity{name,email,phone,location,linkedin,github,website,summary}, ' +
  'skills (array of strings), experience[{company,role,start_date,end_date,bullets[]}], ' +
  'projects[{name,description,technologies[],url}], ' +
  'education[{institution,degree,field,start_date,end_date,gpa}], achievements[], ' +
  'certifications[], leadership[]. Do not invent data.\n\nRESUME TEXT:\n' + text;

const JD_EXTRACTION_PROMPT = (text: string): string =>
  'Extract structured fields from the JOB DESCRIPTION below. Return STRICT JSON with ' +
  'keys: title, company, location, description_summary, level, employment_type, ' +
  'min_years_experience, compensation_hint, requirements[], nice_to_haves[], ' +
  'responsibilities[], technologies[], keywords[]. Do not invent data.\n\n' +
  'JOB DESCRIPTION TEXT:\n' + text;

const DEBOUNCE_MS = 30000;
const NEGOTIATION_DECAY_TURNS = 2;
// Upper bound on re-embed passes so a corpus that keeps sprouting fresh stale
// nodes (or a persistently-failing embedder) can never spin forever.
const MAX_REEMBED_PASSES = 5;

export class KnowledgeOrchestrator {
  db: KnowledgeDatabaseManager;
  cachedNodes: ContextNode[] = [];
  _reembedInFlight = false;
  _indexSpace: string | undefined = undefined;
  _lastConvergeAt = 0;

  embedFn: EmbedFn | null = null;
  embedQueryFn: EmbedFn | null = null;
  fastQueryEmbedFn: FastQueryEmbed | null = null;
  activeSpaceFn: (() => string | undefined) | null = null;
  generateContentFn: GenerateContentFn | null = null;
  liveCoachingContentFn: GenerateContentFn | null = null;
  conversationContextProvider: (() => ConversationContext) | null = null;

  activeResume: KnowledgeDocument<StructuredResume> | null = null;
  activeJD: KnowledgeDocument<StructuredJD> | null = null;

  private _knowledgeMode = false;
  private customNotes = '';
  private _cachedNegotiationScript: any = null;
  private _negotiationStreak = 0;

  private documentReader = new DocumentReader();
  private negotiationTracker = new NegotiationConversationTracker();
  private negotiationEngine = new NegotiationEngine();
  private liveAdvisor = new LiveNegotiationAdvisor();
  private companyResearchEngine = new CompanyResearchEngine();

  constructor(db: KnowledgeDatabaseManager) {
    this.db = db;
    this.refreshCache();
  }

  // ── Dependency injection (wired by electron/main.ts) ───────────────────────

  setGenerateContentFn(fn: GenerateContentFn): void {
    this.generateContentFn = fn;
    this.negotiationEngine.setGenerateContentFn(fn);
    this.companyResearchEngine.setGenerateContentFn(fn);
  }
  setLiveCoachingContentFn(fn: GenerateContentFn): void {
    this.liveCoachingContentFn = fn;
    this.liveAdvisor.setLiveCoachingContentFn(fn);
  }
  setEmbedFn(fn: EmbedFn): void { this.embedFn = fn; }
  setEmbedQueryFn(fn: EmbedFn): void { this.embedQueryFn = fn; }
  setFastQueryEmbedFn(fn: FastQueryEmbed): void { this.fastQueryEmbedFn = fn; }
  setActiveSpaceFn(fn: () => string | undefined): void { this.activeSpaceFn = fn; }
  setConversationContextProvider(fn: () => ConversationContext): void {
    this.conversationContextProvider = fn;
  }
  setCustomNotes(notes: string): void { this.customNotes = notes ?? ''; }

  setKnowledgeMode(enabled: boolean): void { this._knowledgeMode = !!enabled; }
  isKnowledgeMode(): boolean { return this._knowledgeMode && this.hasResume(); }
  hasResume(): boolean { return !!this.activeResume?.structured_data; }

  // ── Cache / active document refresh ────────────────────────────────────────

  private refreshCache(): void {
    try {
      this.refreshActiveDocs();
      if (typeof this.db.getAllNodes === 'function') {
        this.cachedNodes = this.db.getAllNodes();
      }
      // Best-effort: converge embedding space once (no-op until embed fns wired).
      this.ensureEmbeddingSpace().catch(() => {});
    } catch {
      /* defensive: a partial/stub db must not crash construction */
    }
  }

  private refreshActiveDocs(): void {
    if (typeof (this.db as any).getDocumentByType !== 'function') return;
    try {
      let r = this.db.getDocumentByType(DocType.RESUME) as KnowledgeDocument<StructuredResume> | null;
      const j = this.db.getDocumentByType(DocType.JD) as KnowledgeDocument<StructuredJD> | null;
      if (r && r.structured_data) r = this.migrateResumeIfLegacy(r);
      this.activeResume = r && r.structured_data ? r : null;
      this.activeJD = j && j.structured_data ? j : null;
    } catch {
      /* ignore */
    }
  }

  /**
   * Backfill a legacy v1 resume (flat-array skills, no schema version) to the v2
   * categorized shape and persist it, so retrieval and the per-bucket skill
   * answers work. Idempotent: a v2 doc is returned unchanged.
   */
  private migrateResumeIfLegacy(
    doc: KnowledgeDocument<StructuredResume>,
  ): KnowledgeDocument<StructuredResume> {
    const sd: any = doc.structured_data;
    const needsMigration = Array.isArray(sd.skills) || sd._schema_version !== 2;
    if (!needsMigration) return doc;
    sd.skills = coerceSkills(sd.skills);
    sd.skills_flat = flattenSkills(sd.skills);
    sd._schema_version = 2;
    try {
      if (typeof (this.db as any).updateDocumentStructuredData === 'function') {
        this.db.updateDocumentStructuredData(DocType.RESUME, sd);
      }
    } catch {
      /* persistence is best-effort */
    }
    return { ...doc, structured_data: sd };
  }

  // ── Embedding-space convergence (degrade-to-local) ─────────────────────────

  async ensureEmbeddingSpace(): Promise<void> {
    if (this._reembedInFlight) return;
    this._reembedInFlight = true;
    try {
      const activeSpace = this.activeSpaceFn ? this.activeSpaceFn() : undefined;
      const localInfo = this.fastQueryEmbedFn ? this.fastQueryEmbedFn() : null;
      const localSpace = localInfo?.space ?? null;

      const allNodes = typeof this.db.getAllNodes === 'function' ? this.db.getAllNodes() : [];
      const embedded = allNodes.filter((n) => n.embedding);
      if (embedded.length === 0) {
        if (activeSpace) { this._indexSpace = activeSpace; this._lastConvergeAt = Date.now(); }
        return;
      }

      // Fully healthy + already committed to the active space → debounce.
      const committedEqualsActive = !!(this._indexSpace && activeSpace && this._indexSpace === activeSpace);
      if (committedEqualsActive && this.db.getNodesNeedingReembed(activeSpace!).length === 0) {
        this._lastConvergeAt = Date.now();
        return;
      }

      // 1. Converge the corpus to the ACTIVE space. Loop-until-empty so a node
      //    that appears mid-pass is still picked up; tolerant of partial failure
      //    (a failed/empty node is skipped and stays stale for the next pass).
      if (activeSpace && this.embedFn) {
        let progressed = true;
        let passes = 0;
        while (progressed && passes < MAX_REEMBED_PASSES) {
          passes++;
          progressed = false;
          const stale = this.db.getNodesNeedingReembed(activeSpace);
          if (stale.length === 0) break;
          for (const node of stale) {
            let vec: number[] | null = null;
            try {
              vec = await this.embedFn(node.text_content);
            } catch {
              continue; // transient failure — leave stale
            }
            if (!Array.isArray(vec) || vec.length === 0) continue; // no garbage stamps
            this.db.updateNodeEmbedding(node.id as number, vec, activeSpace);
            progressed = true;
          }
        }
        if (this.db.getNodesNeedingReembed(activeSpace).length === 0) {
          this._indexSpace = activeSpace;
          this._lastConvergeAt = Date.now();
          this.cachedNodes = this.db.getAllNodes();
          return;
        }
      }

      // 2. Cloud unavailable → DEGRADE the ENTIRE corpus to the local space
      //    (all-or-nothing) so grounding keeps working at lower fidelity.
      if (localInfo?.embed && localSpace) {
        let localOk = true;
        for (const node of this.db.getAllNodes()) {
          let vec: number[] | null = null;
          try {
            vec = await localInfo.embed(node.text_content);
          } catch {
            localOk = false;
            break;
          }
          if (!Array.isArray(vec) || vec.length === 0) { localOk = false; break; }
          this.db.updateNodeEmbedding(node.id as number, vec, localSpace);
        }
        if (localOk && this.db.getNodesNeedingReembed(localSpace).length === 0) {
          this._indexSpace = localSpace;
          this._lastConvergeAt = Date.now();
          this.cachedNodes = this.db.getAllNodes();
          return;
        }
      }

      // 3. Neither achievable → leave _indexSpace uncommitted for the next retry.
    } finally {
      this._reembedInFlight = false;
    }
  }

  /**
   * The committed index space: the active space when known, otherwise the
   * majority embedding space among indexed nodes (safer than no gate). Undefined
   * when there is nothing to derive from.
   */
  private committedIndexSpace(): string | undefined {
    const active = this.activeSpaceFn ? this.activeSpaceFn() : undefined;
    if (active) return active;
    if (this._indexSpace) return this._indexSpace;
    return this.majorityEmbeddedSpace(this.cachedNodes ?? []) ?? undefined;
  }

  private majorityEmbeddedSpace(nodes: ContextNode[]): string | null {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      if (!n.embedding || !n.embedding_space) continue;
      counts.set(n.embedding_space, (counts.get(n.embedding_space) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [sp, c] of counts) if (c > bestN) { best = sp; bestN = c; }
    return best;
  }

  private indexedDimensions(): number | null {
    for (const n of this.cachedNodes ?? []) {
      if (Array.isArray(n.embedding) && n.embedding.length) return n.embedding.length;
    }
    return null;
  }

  /**
   * Nodes that are safe to search against the current query space. Keyword-only
   * nodes (no embedding) always survive; embedded nodes survive only when their
   * space matches the committed/active space. When activeSpaceFn is entirely
   * unset, no gate is applied.
   */
  _spaceGatedNodes(): ContextNode[] {
    const nodes = this.cachedNodes ?? [];
    if (!this.activeSpaceFn) return nodes; // no gate configured
    const gateSpace = this.committedIndexSpace();
    if (!gateSpace) return nodes; // nothing embedded to derive a space from
    return nodes.filter((n) => !n.embedding || n.embedding_space === gateSpace);
  }

  /**
   * Pick the query embedder. The fast on-device embedder is used ONLY when its
   * space matches the active space (or, when the active space is unknown, when
   * its dimension matches the indexed dimension). Otherwise the cloud embedFn is
   * used so query and node vectors stay in the same space.
   */
  resolveQueryEmbedder(): EmbedFn | null {
    // Prefer the asymmetric query embedder (retrieval framing) over the document
    // embedder when one is registered — same space, better recall.
    const cloudQuery: EmbedFn | null = (this.embedQueryFn ?? this.embedFn) ?? null;

    const fast = this.fastQueryEmbedFn ? this.fastQueryEmbedFn() : null;
    // No fast embedder, or one we can't dimension-check → use the cloud query path.
    if (!fast || !fast.dimensions) return cloudQuery;

    const committed = this.committedIndexSpace();
    let useFast: boolean;
    if (committed) {
      // Fast local is only comparable when its space EQUALS the committed space.
      useFast = !!fast.space && fast.space === committed;
    } else {
      // No committed space → legacy dimension check (allow when nothing to clash with).
      const dims = this.indexedDimensions();
      useFast = dims == null || fast.dimensions === dims;
    }
    if (!useFast) return cloudQuery;

    const fastIsCommitted = !!committed && fast.space === committed;
    return async (q: string): Promise<number[]> => {
      const v = await fast.embed(q);
      if (Array.isArray(v) && v.length) return v;
      // If the fast embedder IS the committed space, never cross-space fall back
      // to the cloud (that would compare a cloud query vector to local nodes).
      if (fastIsCommitted) return [];
      return cloudQuery ? await cloudQuery(q) : [];
    };
  }

  /** Embed any not-yet-embedded nodes (after a fresh ingest). Best-effort. */
  private async embedNewNodes(): Promise<void> {
    if (!this.embedFn) return;
    const space =
      (this.activeSpaceFn && this.activeSpaceFn()) ||
      (this.fastQueryEmbedFn && this.fastQueryEmbedFn()?.space) ||
      'local:default';
    for (const node of this.db.getAllNodes().filter((n) => !n.embedding)) {
      try {
        const vec = await this.embedFn(node.text_content);
        this.db.updateNodeEmbedding(node.id as number, floatsToBlob(vec), space);
      } catch {
        /* best-effort */
      }
    }
    this.cachedNodes = this.db.getAllNodes();
  }

  // ── Ingestion ──────────────────────────────────────────────────────────────

  private async extractStructured(text: string, type: DocType): Promise<any | null> {
    const prompt = type === DocType.RESUME ? RESUME_EXTRACTION_PROMPT(text) : JD_EXTRACTION_PROMPT(text);
    let raw = '';
    try {
      raw = await this.generateContentFn!([{ text: prompt }]);
    } catch {
      raw = '';
    }
    const parsed = tryParseJSON<any>(raw);
    if (parsed && typeof parsed === 'object') {
      if (type === DocType.RESUME) {
        parsed.skills = normalizeSkills(parsed.skills);
        parsed.skills_flat = flattenSkills(parsed.skills);
        parsed._schema_version = 2;
        parsed._extraction_mode = 'llm';
        parsed.identity = parsed.identity ?? {};
        parsed.experience = parsed.experience ?? [];
        parsed.projects = parsed.projects ?? [];
        parsed.education = parsed.education ?? [];
      } else {
        parsed._extraction_mode = 'llm';
      }
      return parsed;
    }

    // LLM down / unparseable → heuristic fallback so grounding still works,
    // unless the kill-switch (PI_HEURISTIC_EXTRACTION=off) disables it, which
    // restores the original "fail the ingest" behavior.
    let heuristicEnabled = true;
    try {
      heuristicEnabled = (process.env.PI_HEURISTIC_EXTRACTION || '').trim().toLowerCase() !== 'off';
    } catch {
      heuristicEnabled = true;
    }
    if (!heuristicEnabled) return null;

    const heuristic = new HeuristicExtractor();
    return type === DocType.RESUME ? heuristic.extractResume(text) : heuristic.extractJD(text);
  }

  async ingestDocument(filePath: string, type: DocType): Promise<{ success: boolean; error?: string }> {
    if (!this.generateContentFn) {
      return { success: false, error: 'LLM not configured. Add an API key to ingest documents.' };
    }

    let text = '';
    try {
      text = await this.documentReader.read(filePath);
    } catch (e: any) {
      return { success: false, error: `Could not read document: ${e?.message ?? e}` };
    }
    if (!text || !text.trim()) {
      return { success: false, error: 'Document appears to be empty.' };
    }

    let structured: any;
    try {
      structured = await this.extractStructured(text, type);
    } catch (e: any) {
      return { success: false, error: `Extraction failed: ${e?.message ?? e}` };
    }
    if (!structured) {
      return { success: false, error: 'Could not extract structured data from the document.' };
    }

    try {
      this.db.upsertDocument(type, filePath, structured);
      const nodes = createDocumentNodes(structured, type);
      this.db.replaceNodes(type, nodes);
    } catch (e: any) {
      return { success: false, error: `Failed to persist document: ${e?.message ?? e}` };
    }

    this.refreshActiveDocs();
    this.cachedNodes = this.db.getAllNodes();
    this._cachedNegotiationScript = null;

    // Embed the new nodes (best-effort; failure is non-fatal).
    try { await this.embedNewNodes(); } catch { /* non-fatal */ }

    return { success: true };
  }

  deleteDocumentsByType(type: DocType): void {
    try {
      this.db.deleteDocumentsByType(type);
    } catch {
      /* ignore */
    }
    if (type === DocType.RESUME) {
      this.activeResume = null;
      this._knowledgeMode = false;
    } else if (type === DocType.JD) {
      this.activeJD = null;
    }
    this._cachedNegotiationScript = null;
    this.refreshActiveDocs();
    try { this.cachedNodes = this.db.getAllNodes(); } catch { this.cachedNodes = []; }
  }

  // ── Question processing ─────────────────────────────────────────────────────

  /** Feed a typed question into the depth scorer (no-op hook kept for parity). */
  feedForDepthScoring(_message: string): void { /* reserved for adaptive depth */ }

  /** Feed an interviewer transcript turn into the live negotiation tracker. */
  feedInterviewerUtterance(text: string): void {
    try { this.negotiationTracker.feed(text, 'interviewer'); } catch { /* ignore */ }
  }

  async processQuestion(message: string): Promise<KnowledgeResult | null> {
    this.refreshActiveDocs();
    const resumeDoc = this.activeResume;
    const jdDoc = this.activeJD;
    const hasResume = !!resumeDoc?.structured_data;
    const hasJD = !!jdDoc?.structured_data;
    if (!hasResume && !hasJD) return null;

    // Transcript-aware intent (comp stickiness via the conversation provider).
    // The provider may throw; swallow it so routing always continues.
    let convo: ConversationContext = null;
    try {
      convo = this.conversationContextProvider ? this.conversationContextProvider() : null;
    } catch {
      convo = null;
    }
    const intent = classifyIntentWithContext(message, {
      recentInterviewerComp: convo?.recentInterviewerComp,
      recentIntentWasNegotiation: this._negotiationStreak > 0,
      negotiationActive: this.negotiationTracker.isActive(),
    });

    // Deterministic routing signal (observed by integration tests + logs).
    console.log(`[Knowledge] Intent classified: ${intent}`);

    // Decay the negotiation streak on a confident non-comp turn.
    if (intent === 'negotiation') this._negotiationStreak = NEGOTIATION_DECAY_TURNS;
    else if (this._negotiationStreak > 0) this._negotiationStreak -= 1;

    // Generic technical / assistant-meta → never inject profile context.
    if (intent === 'assistant_identity' || intent === 'technical') return null;
    // A genuine negotiation question is handled by the live-coaching path (which
    // needs an LLM). In the typed-chat path there is nothing to inject, and it
    // must NOT be flagged factualRecall (it would bypass the mode gate).
    if (intent === 'negotiation') return null;

    // Identity / intro → a deterministic first-person answer when possible.
    if (intent === 'intro' && hasResume) {
      try {
        const fp = tryBuildManualProfileFastPathAnswer({
          question: message,
          profile: resumeDoc!.structured_data as any,
          jobDescription: jdDoc?.structured_data as any,
          source: 'what_to_answer',
        });
        if (fp?.answer) {
          return { isIntroQuestion: true, introResponse: fp.answer, factualRecall: true };
        }
      } catch {
        /* fall through to grounding */
      }
    }

    const v2 = isProfileGroundingV2Enabled();
    const sd = (resumeDoc?.structured_data ?? null) as StructuredResume | null;
    const jdSd = (jdDoc?.structured_data ?? null) as StructuredJD | null;
    return this.buildGroundedResult(message, intent, sd, jdSd, v2);
  }

  /**
   * Build the grounding result. Only the category blocks the question asks about
   * are rendered (deterministic, no retrieval), with two zero-node safety nets:
   * a persona-fit fallback (real experience + achievements) and an inclusion-bias
   * compact identity for ambiguous questions. V2 wraps the resume blocks in a
   * <candidate_profile> envelope with the grounding rules; legacy emits them raw.
   */
  private buildGroundedResult(
    message: string,
    intent: QueryIntent,
    sd: StructuredResume | null,
    jdSd: StructuredJD | null,
    v2: boolean,
  ): KnowledgeResult | null {
    const hasJD = !!jdSd;

    // Scope resume categories to the question (by keyword OR by a named resume
    // entity, e.g. a project name in a follow-up); widen by intent if none match.
    let cats: ProfileCategory[] = sd
      ? [...new Set([...detectProfileCategories(message), ...detectEntityCategories(sd, message)])]
          .filter((c) => hasCategoryData(sd, c))
      : [];
    let includeJD = false;

    if (intent === 'jd_fit') {
      includeJD = hasJD;
      if (!cats.length && sd) {
        cats = (['experience', 'skills'] as ProfileCategory[]).filter((c) => hasCategoryData(sd, c));
      }
    } else if (intent === 'jd_role') {
      includeJD = hasJD;
      cats = [];
    } else if (intent === 'skill_experience') {
      if (!cats.length && sd) {
        cats = (['skills'] as ProfileCategory[]).filter((c) => hasCategoryData(sd, c));
      }
    }

    let resumeBlocks = '';
    let factual = false;
    let persona = false;
    if (cats.length && sd) {
      resumeBlocks = buildCategoryPack(sd, cats);
      factual = true;
    } else if (sd && isPersonaFitQuestion(message)) {
      resumeBlocks = buildPersonaFallback(sd);
      persona = !!resumeBlocks;
    }

    const jdBlock = includeJD && jdSd ? buildTargetJobBlock({ structured_data: jdSd }) : '';
    if ((intent === 'jd_role' || intent === 'jd_fit') && (resumeBlocks || jdBlock)) factual = true;

    // Nothing scoped → ambiguous inclusion bias (compact identity, no injection).
    if (!resumeBlocks && !jdBlock) {
      if (!sd) return null;
      const identity = buildInclusionBiasIdentity(sd);
      const block = v2
        ? `${GROUNDING_RULES}\n\n<candidate_profile>\n${identity}\n</candidate_profile>`
        : identity;
      return { contextBlock: block, systemPromptInjection: '' };
    }

    let contextBlock: string;
    if (v2) {
      const parts = [GROUNDING_RULES];
      if (resumeBlocks) parts.push(`<candidate_profile>\n${resumeBlocks}\n</candidate_profile>`);
      if (jdBlock) parts.push(jdBlock);
      contextBlock = parts.join('\n\n');
    } else {
      contextBlock = [resumeBlocks, jdBlock].filter(Boolean).join('\n\n');
    }

    const result: KnowledgeResult = { contextBlock };
    if (factual && !persona) result.factualRecall = true;
    if (this.customNotes && this.customNotes.trim()) {
      result.systemPromptInjection = `<custom_notes>\n${this.customNotes.trim()}\n</custom_notes>`;
    }
    return result;
  }

  // ── Status / profile ────────────────────────────────────────────────────────

  getStatus(): KnowledgeStatus {
    const sd = this.activeResume?.structured_data ?? null;
    const exp = (sd?.experience ?? []) as StructuredResume['experience'];
    return {
      hasResume: !!sd,
      activeMode: this.isKnowledgeMode(),
      resumeSummary: sd
        ? {
            name: sd.identity?.name,
            role: exp[0]?.role,
            totalExperienceYears: estimateYears(exp),
          }
        : undefined,
    };
  }

  getProfileData(): ProfileData | null {
    const doc = this.activeResume;
    const jd = this.activeJD?.structured_data ?? null;
    if (!doc?.structured_data) {
      // JD-only session: still surface the uploaded JD (no resume yet).
      if (jd) {
        return {
          identity: {}, skills: normalizeSkills(undefined), skillsFlat: [],
          experience: [], projects: [], experienceCount: 0, projectCount: 0,
          educationCount: 0, nodeCount: this.safeNodeCount(),
          activeJD: jd, hasActiveJD: true,
        };
      }
      return null;
    }
    const sd = doc.structured_data;
    return {
      identity: sd.identity ?? {},
      skills: normalizeSkills(sd.skills),
      skillsFlat: (sd as any).skills_flat ?? flattenSkills(sd.skills as any),
      experience: sd.experience ?? [],
      projects: sd.projects ?? [],
      experienceCount: (sd.experience ?? []).length,
      projectCount: (sd.projects ?? []).length,
      educationCount: (sd.education ?? []).length,
      nodeCount: this.safeNodeCount(),
      activeJD: jd,
      hasActiveJD: !!jd,
    };
  }

  private safeNodeCount(): number {
    try { return this.db.getNodeCount(); } catch { return this.cachedNodes.length; }
  }

  // ── Company research ────────────────────────────────────────────────────────

  getCompanyResearchEngine(): CompanyResearchEngine {
    return this.companyResearchEngine;
  }

  // ── Negotiation ─────────────────────────────────────────────────────────────

  getNegotiationTracker(): NegotiationConversationTracker {
    return this.negotiationTracker;
  }

  resetNegotiationSession(): void {
    this.negotiationTracker.reset();
    this._negotiationStreak = 0;
  }

  getNegotiationScript(): any | null {
    if (this._cachedNegotiationScript) return this._cachedNegotiationScript;
    try {
      const stored = this.db.getNegotiationScript();
      if (stored) { this._cachedNegotiationScript = stored; return stored; }
    } catch { /* ignore */ }
    return null;
  }

  async generateNegotiationScriptOnDemand(): Promise<any | null> {
    const resume = this.activeResume?.structured_data ?? null;
    const jd = this.activeJD?.structured_data ?? null;
    const script = await this.negotiationEngine.generateScript(resume, jd);
    if (script) {
      this._cachedNegotiationScript = script;
      try { this.db.saveNegotiationScript(script); } catch { /* ignore */ }
    }
    return script;
  }

  /** Live coaching: produce a tactical note for the current negotiation turn. */
  async getLiveNegotiationCoaching(lastInterviewerTurn?: string): Promise<any | null> {
    if (!this.negotiationTracker.isActive()) return null;
    return this.liveAdvisor.advise(this.negotiationTracker.getState(), lastInterviewerTurn);
  }

  /** Optional AOT pipeline accessor — no background pipeline in this fork. */
  getAOTPipeline(): { isRunning(): boolean } | undefined {
    return undefined;
  }
}

function estimateYears(experience: StructuredResume['experience'] | undefined): number {
  if (!experience || experience.length === 0) return 0;
  let earliest = Infinity;
  let latest = 0;
  for (const e of experience) {
    const start = parseYear(e.start_date);
    const end = e.end_date ? parseYear(e.end_date) : new Date().getFullYear?.() ?? start;
    if (start && start < earliest) earliest = start;
    if (end && end > latest) latest = end;
  }
  if (!isFinite(earliest) || latest === 0) return 0;
  return Math.max(0, latest - earliest);
}

function parseYear(date: string | null | undefined): number {
  if (!date) return 0;
  const m = String(date).match(/\d{4}/);
  return m ? parseInt(m[0], 10) : 0;
}
