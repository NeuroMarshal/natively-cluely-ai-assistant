// premium/electron/knowledge/ProfilePackBuilder.ts
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// The LEGACY (Profile-Grounding-V2 flag OFF, the default) grounding path. Instead
// of one big <candidate_profile> block, it renders ONLY the category blocks the
// question asks about (<candidate_projects>, <candidate_experience>, …) as a
// deterministic "structured pack" — so a terse "what are my projects?" returns
// the real projects even with NO embedder and NO LLM.
//
// It also provides the two zero-retrieval safety nets:
//   - persona-fit fallback: a candidate-directed "why should they hire me?"
//     question seeds REAL experience + achievements so the model cites genuine
//     material instead of fabricating metrics into a void.
//   - inclusion-bias identity: an ambiguous question gets a compact
//     <candidate_identity> rather than the whole profile.

import type { StructuredResume } from './types';
import { flattenSkills } from './skillsUtil';

export type ProfileCategory =
  | 'skills' | 'experience' | 'projects' | 'education' | 'achievements' | 'certifications';

const CATEGORY_PATTERNS: [ProfileCategory, RegExp][] = [
  ['projects', /\bprojects?\b/],
  ['experience', /\b(experience|work\s+history|employment|companies|worked|career|roles?)\b/],
  ['skills', /\bskills?\b|\btech\s*stack\b|\btechnolog|\b(programming|coding)\s+languages?\b|\blanguages?\b/],
  ['education', /\b(education|school|degree|university|college|studi|gpa|alma\s+mater|major)\b/],
  ['achievements', /\b(achievements?|awards?|honou?rs?|patents?|publications?|recogni)\b/],
  ['certifications', /\b(certifications?|certs?|certified|credential)\b/],
];

const PERSONA_FIT_PATTERNS = [
  /\bhire\s+me\b/,
  /\bwhy\s+(should|would|will)\b.*\b(hire|pick|choose|select|me)\b/,
  /\bright\s+fit\b/,
  /\bbest\s+(candidate|fit|choice|person)\b/,
  /\bmake\s+(your|the|my|a)\s+case\b/,
  /\bsell\s+(yourself|me)\b/,
  /\bwhy\s+(are\s+)?you\b.*\b(right|best|ideal|good|fit)\b/,
  /\bpitch\s+(yourself|me)\b/,
  /\bwhy\s+you\b/,
];

const norm = (q: string): string => (q || '').toLowerCase();

/** Which profile categories does the question explicitly ask about? */
export function detectProfileCategories(question: string): ProfileCategory[] {
  const q = norm(question);
  const out: ProfileCategory[] = [];
  for (const [cat, re] of CATEGORY_PATTERNS) {
    if (re.test(q) && !out.includes(cat)) out.push(cat);
  }
  return out;
}

/** A candidate-directed "make your case / why hire me" question. */
export function isPersonaFitQuestion(question: string): boolean {
  const q = norm(question);
  return PERSONA_FIT_PATTERNS.some((re) => re.test(q));
}

const arrAny = (v: any): any[] => (Array.isArray(v) ? v : []);
const strAny = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Categories implied by a NAMED entity from the resume appearing in the question
 * ("tell me about my LedgerFlow" → projects, "my time at Drift Systems" →
 * experience). Lets a drill-in / follow-up about a specific project or company
 * pull the right block even without a category keyword.
 */
export function detectEntityCategories(sd: StructuredResume, question: string): ProfileCategory[] {
  const q = norm(question);
  const out: ProfileCategory[] = [];
  for (const p of arrAny(sd?.projects)) {
    const name = strAny(p?.name).toLowerCase();
    if (name.length >= 4 && q.includes(name)) { out.push('projects'); break; }
  }
  for (const e of arrAny(sd?.experience)) {
    const company = strAny(e?.company).toLowerCase();
    const role = strAny(e?.role).toLowerCase();
    if ((company.length >= 4 && q.includes(company)) || (role.length >= 6 && q.includes(role))) {
      out.push('experience');
      break;
    }
  }
  return out;
}

const arr = <T>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function experienceLines(sd: StructuredResume): string[] {
  return arr(sd.experience).map((e) => {
    const head = [str(e.role), str(e.company) && `at ${str(e.company)}`].filter(Boolean).join(' ');
    const dates = [str(e.start_date as any), e.end_date ? str(e.end_date as any) : 'Present'].filter(Boolean).join(' – ');
    const lines = [`- ${head}${dates ? ` (${dates})` : ''}`];
    for (const b of arr(e.bullets)) if (str(b)) lines.push(`  - ${str(b)}`);
    return lines.join('\n');
  }).filter(Boolean);
}

function projectLines(sd: StructuredResume): string[] {
  return arr(sd.projects).map((p) => {
    const tech = arr(p.technologies).map(str).filter(Boolean).join(', ');
    return `- ${str(p.name)}${str(p.description) ? `: ${str(p.description)}` : ''}${tech ? ` (${tech})` : ''}`;
  }).filter((l) => l.replace(/^-\s*/, '').trim());
}

function educationLines(sd: StructuredResume): string[] {
  return arr(sd.education).map((ed) => {
    const deg = [str(ed.degree), str(ed.field) && `in ${str(ed.field)}`].filter(Boolean).join(' ');
    const dates = [str(ed.start_date), str(ed.end_date)].filter(Boolean).join(' – ');
    return `- ${[deg, str(ed.institution) && `at ${str(ed.institution)}`].filter(Boolean).join(', ')}${dates ? ` (${dates})` : ''}`;
  }).filter((l) => l.replace(/^-\s*/, '').trim());
}

function achievementLines(sd: StructuredResume): string[] {
  return arr(sd.achievements as any[]).map((a: any) => {
    if (typeof a === 'string') return str(a) ? `- ${str(a)}` : '';
    const title = str(a?.title) || str(a?.name);
    const desc = str(a?.description);
    return title ? `- ${title}${desc ? ` — ${desc}` : ''}` : '';
  }).filter(Boolean);
}

function certificationLines(sd: StructuredResume): string[] {
  return arr(sd.certifications as any[]).map((c: any) => {
    if (typeof c === 'string') return str(c) ? `- ${str(c)}` : '';
    const name = str(c?.name) || str(c?.title);
    const issuer = str(c?.issuer);
    return name ? `- ${name}${issuer ? ` (${issuer})` : ''}` : '';
  }).filter(Boolean);
}

function block(tag: string, lines: string[]): string {
  if (!lines.length) return '';
  return `<${tag}>\n${lines.join('\n')}\n</${tag}>`;
}

/** Does the resume hold any data for this category? */
export function hasCategoryData(sd: StructuredResume, cat: ProfileCategory): boolean {
  switch (cat) {
    case 'skills': return flattenSkills(sd.skills as any).length > 0;
    case 'experience': return experienceLines(sd).length > 0;
    case 'projects': return projectLines(sd).length > 0;
    case 'education': return educationLines(sd).length > 0;
    case 'achievements': return achievementLines(sd).length > 0;
    case 'certifications': return certificationLines(sd).length > 0;
    default: return false;
  }
}

function categoryBlock(sd: StructuredResume, cat: ProfileCategory): string {
  switch (cat) {
    case 'skills': return block('candidate_skills', [flattenSkills(sd.skills as any).join(', ')].filter(Boolean));
    case 'experience': return block('candidate_experience', experienceLines(sd));
    case 'projects': return block('candidate_projects', projectLines(sd));
    case 'education': return block('candidate_education', educationLines(sd));
    case 'achievements': return block('candidate_achievements', achievementLines(sd));
    case 'certifications': return block('candidate_certifications', certificationLines(sd));
    default: return '';
  }
}

/** Build the structured pack for the requested categories (only non-empty ones). */
export function buildCategoryPack(sd: StructuredResume, categories: ProfileCategory[]): string {
  const blocks = categories.map((c) => categoryBlock(sd, c)).filter(Boolean);
  return blocks.join('\n\n');
}

/**
 * Zero-retrieval persona fallback: ground REAL experience + achievements so a
 * "why should they hire me?" question has genuine material to cite. Returns ''
 * when there is nothing real to seed.
 */
export function buildPersonaFallback(sd: StructuredResume): string {
  const blocks = [
    block('candidate_experience', experienceLines(sd)),
    block('candidate_achievements', achievementLines(sd)),
  ].filter(Boolean);
  return blocks.join('\n\n');
}

/** Compact identity block for an ambiguous question (inclusion bias). */
export function buildInclusionBiasIdentity(sd: StructuredResume): string {
  const id = sd.identity ?? {};
  const lines = [
    str(id.name) && `Name: ${str(id.name)}`,
    str(id.location) && `Location: ${str(id.location)}`,
    str(id.summary) && `Summary: ${str(id.summary)}`,
  ].filter(Boolean) as string[];
  return block('candidate_identity', lines.length ? lines : ['(profile loaded)']);
}
