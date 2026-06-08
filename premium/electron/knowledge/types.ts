// premium/electron/knowledge/types.ts
//
// Open-source local re-implementation of the formerly-proprietary "premium"
// knowledge layer. This file is part of the AGPL-3.0 Natively fork and replaces
// the closed-source git submodule that the upstream project kept private.
//
// Shared types for the knowledge / profile-intelligence engine.

/**
 * Document kinds the knowledge engine can ingest. The string values double as
 * the `source_type` column value written into `context_nodes`, and several
 * call sites compare `DocType.RESUME === 'resume'` / `DocType.JD === 'jd'`,
 * so the values MUST stay lowercase.
 */
export enum DocType {
  RESUME = 'resume',
  JD = 'jd',
}

// ─── Structured profile facts (canonical schema shared with the OSS LLM layer) ─

export interface ResumeIdentity {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  summary?: string;
}

export interface ResumeExperience {
  company?: string;
  role?: string;
  start_date?: string | null;
  end_date?: string | null;
  bullets?: string[];
  is_internship?: boolean;
}

export interface ResumeProject {
  name?: string;
  description?: string;
  technologies?: string[];
  url?: string;
}

export interface ResumeEducation {
  institution?: string;
  degree?: string;
  field?: string;
  start_date?: string;
  end_date?: string;
  gpa?: string;
}

/**
 * Categorized skills (v2 schema). Each bucket is a string list. The engine also
 * derives a flat list (`skillsFlat` / `skills_flat`) for the OSS fast-path.
 */
export interface CategorizedSkills {
  languages: string[];
  frameworks: string[];
  cloud: string[];
  databases: string[];
  ml: string[];
  devops: string[];
  tools: string[];
}

export interface StructuredResume {
  _schema_version?: number;
  _extraction_mode?: 'llm' | 'heuristic';
  identity: ResumeIdentity;
  skills: CategorizedSkills | string[];
  skills_flat?: string[];
  experience: ResumeExperience[];
  projects: ResumeProject[];
  education: ResumeEducation[];
  achievements?: string[];
  certifications?: string[];
  leadership?: string[];
}

export interface StructuredJD {
  _extraction_mode?: 'llm' | 'heuristic';
  title?: string;
  company?: string;
  location?: string;
  description_summary?: string;
  level?: string;
  employment_type?: string;
  min_years_experience?: number;
  compensation_hint?: string;
  requirements?: string[];
  nice_to_haves?: string[];
  responsibilities?: string[];
  technologies?: string[];
  keywords?: string[];
}

/** A stored document row (resume or JD) with its parsed structured data. */
export interface KnowledgeDocument<T = any> {
  id: number;
  type: 'resume' | 'jd';
  source_uri: string;
  created_at: number;
  structured_data: T;
}

/** A single retrievable knowledge node persisted in `context_nodes`. */
export interface ContextNode {
  id?: number;
  source_type: string; // DocType value
  category: string;
  title: string;
  text_content: string;
  tags: string; // JSON array string
  embedding?: Buffer | null;
  embedding_space?: string | null;
}

/** Result of `KnowledgeOrchestrator.processQuestion`. */
export interface KnowledgeResult {
  isIntroQuestion?: boolean;
  introResponse?: string;
  factualRecall?: boolean;
  liveNegotiationResponse?: LiveCoachingResponse | null;
  systemPromptInjection?: string;
  contextBlock?: string;
}

/** Result of `KnowledgeOrchestrator.getStatus`. */
export interface KnowledgeStatus {
  hasResume: boolean;
  activeMode: boolean;
  resumeSummary?: {
    name?: string;
    role?: string;
    totalExperienceYears?: number;
  };
}

/** Result of `KnowledgeOrchestrator.getProfileData`. */
export interface ProfileData {
  identity: ResumeIdentity;
  skills: CategorizedSkills | string[];
  skillsFlat: string[];
  experience: ResumeExperience[];
  projects: ResumeProject[];
  experienceCount: number;
  projectCount: number;
  educationCount: number;
  nodeCount: number;
  activeJD: StructuredJD | null;
  hasActiveJD: boolean;
}

// ─── Negotiation types ──────────────────────────────────────────────────────

export enum NegotiationPhase {
  IDLE = 'idle',
  DISCOVERY = 'discovery',
  ANCHORING = 'anchoring',
  COUNTERING = 'countering',
  CLOSING = 'closing',
}

export interface OfferEvent {
  kind: 'comp_mention' | 'offer' | 'counter' | 'question';
  text: string;
  value?: number | null;
  currency?: string;
  timestamp: number;
  speaker?: 'interviewer' | 'candidate';
}

export interface OfferState {
  base?: number | null;
  equity?: number | null;
  bonus?: number | null;
  total?: number | null;
  currency?: string;
}

export interface NegotiationState {
  phase: NegotiationPhase;
  offer: OfferState;
  events: OfferEvent[];
  isActive: boolean;
  theirOffer?: number | null;
  yourTarget?: number | null;
  currency?: string;
}

export interface LiveCoachingResponse {
  tacticalNote: string;
  exactScript: string;
  phase: NegotiationPhase | string;
  theirOffer?: number | null;
  yourTarget?: number | null;
  currency?: string;
  showSilenceTimer?: boolean;
  rationale?: string;
}
