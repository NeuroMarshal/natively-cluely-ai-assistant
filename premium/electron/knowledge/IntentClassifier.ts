// premium/electron/knowledge/IntentClassifier.ts
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// Routes an incoming question to a knowledge intent so the orchestrator knows
// which context to inject (resume, JD, both, or none) and whether to engage the
// live negotiation path. Reuses the open-source assistant-identity detector.
//
// Three entry points:
//   classifyIntent(q)                       — stateless base intent
//   classifyIntentWithContext(q, ctx)       — transcript-aware (comp stickiness)
//   looksLikeGarbledComp(q)                 — deterministic STT-typo comp rescue

import { isAssistantIdentityQuestion } from '../../../electron/llm/manualProfileIntelligence';
import { textHasCompEvidence } from './NegotiationConversationTracker';

export type QueryIntent =
  | 'assistant_identity'
  | 'intro'
  | 'profile_detail'
  | 'skill_experience'
  | 'jd_role'
  | 'jd_fit'
  | 'negotiation'
  | 'technical'
  | 'general';

export interface IntentContext {
  /** The last 1–2 interviewer turns carried comp evidence. */
  recentInterviewerComp?: boolean;
  /** The previous classified intent was negotiation (sticky thread). */
  recentIntentWasNegotiation?: boolean;
  /** The live negotiation tracker is currently active. */
  negotiationActive?: boolean;
}

const norm = (q: string): string =>
  (q || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const any = (q: string, pats: RegExp[]): boolean => pats.some((p) => p.test(q));

// ── Pattern tables ────────────────────────────────────────────────────────────

const JD_FIT_PATTERNS = [
  /\bhow\s+do\s+i\s+fit\b/,
  /\bhow\s+am\s+i\s+a\s+(fit|match)\b/,
  /\bwhy\s+am\s+i\s+a\s+(good\s+)?(fit|match)\b/,
  /\bfit\s+(this\s+)?(jd|job|role|position)\b/,
  /\bmatch\s+(this\s+)?(jd|job|role|position)\b/,
  /\bam\s+i\s+qualified\b/,
];

const JD_ROLE_PATTERNS = [
  /\brole\s+am\s+i\s+applying\s+for\b/,
  /\bwhat\s+(job|position|role)\b.*\b(applying|targeting)\b/,
  /\btarget\s+(role|job|position)\b/,
  /\bwhich\s+(role|job|position)\s+am\s+i\b/,
  // Questions ABOUT the target job/role itself → pull the JD into context.
  /\bwhat\s+does\s+(this|the)\s+(job|role|position)\b/,
  /\b(this|the)\s+(job|role|position)\b.*\b(require|need|description|responsib|about|entail|involve)\b/,
  /\bwhat('s| is)\s+(this|the)\s+(job|role|position)\b/,
  /\babout\s+(this|the)\s+(job|role|position)\b/,
];

const NAME_PATTERNS = [
  /\bwhat\s+(is|s)\s+my\s+name\b/,
  /\bwho\s+am\s+i\b/,
  /\bwhat\s+(is|s)\s+your\s+(full\s+)?name\b/,
  /\bwhats\s+your\s+name\b/,
  /\bwho\s+are\s+you\b/,
  /\bstate\s+(your|my)\s+name\b/,
];

const INTRO_PATTERNS = [
  /\btell\s+me\s+about\s+(yourself|your\s*self)\b/,
  /\bintroduce\s+(yo?u?r?se?l?[fd]|u?r?se?l?[fd])\b/,
  /\b(quick|brief|short)\s+intro\b/,
  /\bdescribe\s+yourself\b/,
  /\bwalk\s+me\s+through\s+your\s+(background|journey|career|profile)\b/,
];

const SKILL_EXPERIENCE_PATTERNS = [
  /\bexperience\s+(with|in|using)\b/,
  /\bhave\s+(you|i)\s+(used|worked\s+with)\b/,
  /\bworked\s+with\b/,
  /\bfamiliar\s+with\b/,
  /\bdo\s+you\s+know\s+\w/,
];

const PROFILE_DETAIL_PATTERNS = [
  /\b(my|your)\s+projects?\b/,
  /\b(my|your)\s+(main\s+|technical\s+|key\s+|core\s+)?skills?\b/,
  /\b(my|your)\s+experiences?\b/,
  /\bwork\s+(experience|history)\b/,
  /\b(my|your)\s+education(al)?\b/,
  /\b(my|your)\s+(strengths?|weakness(es)?)\b/,
  /\bwhat\s+are\s+my\s+(strengths?|weakness(es)?)\b/,
  /\bprogramming\s+languages?\b/,
  /\b(my|your)\b.{0,24}\blanguages?\b/,
  /\bmy\s+resume\b/,
  /\bon\s+my\s+resume\b/,
  /\b(my|your)\s+(degree|gpa|certifications?|achievements?)\b/,
  /\bwhat\s+all\s+projects?\b/,
];

const TECHNICAL_PATTERNS = [
  /\bwrite\s+(a\s+|an\s+)?(function|method|program|code|query|algorithm|script|class|component)\b/,
  /\b(reverse|sort|implement|debug|optimi[sz]e|refactor|traverse|parse)\b.*\b(string|array|list|function|algorithm|code|tree|graph|number|matrix)\b/,
  // "explain X" is technical — but NOT "explain that/this/it in more detail"
  // (a candidate-framed elaboration follow-up, which must stay grounded).
  /\bexplain\b(?!\s+(that|this|it)\s+(in\s+more\s+detail|more|further|again|better)\b)(?!\s+(yourself|your)\b)/,
  /\bwhat\s+is\s+(a\s+|an\s+|the\s+)?(hash\s*map|hash\s*table|algorithm|big\s*o|recursion|closure|promise|rest|graphql|bfs|dfs|binary\s+search|linked\s+list|stack|queue|tree|graph|pointer|polymorphism|inheritance|complexity|database\s+index|mutex|semaphore|deadlock)\b/,
  /\b(hashmap|bfs|dfs|recursion|leetcode|time\s+complexity|space\s+complexity|binary\s+tree)\b/,
  /\bchallenging\s+(bug|problem|technical)\b/,
  /\bhow\s+(do(es)?|would)\b.*\b(work|implement|algorithm|code|optimi[sz]e)\b/,
  // Coding-challenge phrasing.
  /\bsolve\b/,
  /\btwo\s?sum\b|\bfizz\s?buzz\b|\bvalid\s+parentheses\b/,
  // Sales / pitch (the candidate selling a product — never their own profile).
  /\bexpensive\b/,
  /\b(your|our|the)\s+(product|service|solution|pricing|platform)\b/,
  /\b(why|how)\s+(is|are|much)\b.*\b(product|pricing|price|cost)\b/,
];

// A general/ambiguous follow-up that, under an active comp thread, must NOT be
// pulled into negotiation: skill self-ratings and persona/fit/behavioral asks.
const NON_COMP_STICKY_GUARD = [
  /\brate\s+(your|my)self\b/,
  /\bout\s+of\s+(10|ten)\b/,
  /\bscale\s+of\b/,
  /\bhow\s+(good|skilled)\s+are\s+you\b/,
  /\bcoding\s+levels?\b/,
  /\bhire\s+(you|me|us)\b/,
  /\bwhy\s+should\s+(we|they|i|you)\b/,
  /\bmake\s+(your|the|a)\s+case\b/,
  /\b(good|right|best)\s+fit\b/,
  /\btell\s+me\s+about\s+a\s+time\b/,
  /\bdescribe\s+a\s+time\b/,
  /\bgive\s+(me\s+)?an\s+example\b/,
  /\bstrengths?\b/,
  /\bweakness/,
];

// ── Garbled-comp edit-distance gate (Phase 2) ─────────────────────────────────

const COMP_WORDS = ['salary', 'compensation', 'negotiation', 'remuneration'];
const COMP_WORD_SET = new Set(COMP_WORDS);

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * True when a token is a near-miss of a core comp word (a garbled STT/typo such
 * as "slalary", "compensaton", "negocation", "renumeration") — but NOT an exact
 * comp word (those are handled by the sync keyword scorer). Tuned for zero false
 * positives across technical / interview / look-alike vocabulary.
 */
export function looksLikeGarbledComp(text: string): boolean {
  const tokens = norm(text).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  // An exact comp word present → the keyword scorer owns it, not this gate.
  if (tokens.some((t) => COMP_WORD_SET.has(t))) return false;
  for (const tok of tokens) {
    if (tok.length < 5) continue;
    for (const comp of COMP_WORDS) {
      if (Math.abs(tok.length - comp.length) > 2) continue;
      const d = levenshtein(tok, comp);
      // d>0 (not exact) and within 25% of the target length → garbled comp.
      if (d > 0 && d / comp.length <= 0.25) return true;
    }
  }
  return false;
}

// ── Public classification ─────────────────────────────────────────────────────

/** Stateless base intent. */
export function classifyIntent(question: string): QueryIntent {
  const q = norm(question);
  if (!q) return 'general';

  if (isAssistantIdentityQuestion(question)) return 'assistant_identity';

  // Confident comp signal (exact keyword or money amount).
  if (textHasCompEvidence(question)) return 'negotiation';

  if (any(q, JD_FIT_PATTERNS)) return 'jd_fit';
  if (any(q, JD_ROLE_PATTERNS)) return 'jd_role';
  if (any(q, NAME_PATTERNS) || any(q, INTRO_PATTERNS)) return 'intro';
  if (any(q, SKILL_EXPERIENCE_PATTERNS)) return 'skill_experience';
  if (any(q, PROFILE_DETAIL_PATTERNS)) return 'profile_detail';
  if (any(q, TECHNICAL_PATTERNS)) return 'technical';

  return 'general';
}

/**
 * Transcript-aware classification. A CONFIDENT base intent always wins. Only an
 * ambiguous ('general') turn can be promoted to negotiation — either because the
 * interviewer just raised comp (sticky hint) or because it carries a garbled
 * comp word.
 */
export function classifyIntentWithContext(question: string, ctx: IntentContext = {}): QueryIntent {
  const base = classifyIntent(question);
  // A CONFIDENT base intent always wins (a genuine topic change overrides any
  // sticky comp thread).
  if (base !== 'general') return base;

  // A garbled comp word (STT typo) is rescued regardless of context.
  if (looksLikeGarbledComp(question)) return 'negotiation';

  // Under an active comp thread, an ambiguous follow-up sticks to negotiation —
  // unless it is a skill self-rating or a persona/fit/behavioral question.
  const q = norm(question);
  const active = Boolean(
    ctx.recentInterviewerComp || ctx.recentIntentWasNegotiation || ctx.negotiationActive,
  );
  if (active && !any(q, NON_COMP_STICKY_GUARD)) return 'negotiation';

  return 'general';
}

// ── Context mapping for the orchestrator ──────────────────────────────────────

export function contextForIntent(intent: QueryIntent): { wantsResume: boolean; wantsJD: boolean } {
  switch (intent) {
    case 'jd_fit':
    case 'negotiation':
      return { wantsResume: true, wantsJD: true };
    case 'jd_role':
      return { wantsResume: false, wantsJD: true };
    case 'intro':
    case 'skill_experience':
    case 'profile_detail':
      return { wantsResume: true, wantsJD: false };
    default:
      return { wantsResume: false, wantsJD: false };
  }
}

export function isFactualRecallIntent(intent: QueryIntent): boolean {
  return (
    intent === 'intro' ||
    intent === 'skill_experience' ||
    intent === 'profile_detail' ||
    intent === 'jd_role' ||
    intent === 'jd_fit'
  );
}
