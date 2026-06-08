// premium/electron/knowledge/ProfileContextBuilder.ts
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// Renders the user's typed resume + JD into the always-present grounding block
// that the orchestrator injects before an answer. The block carries explicit
// authorization, completeness, precision and scoped-security rules so the model
// answers from the user's OWN uploaded data and never refuses it as "private".

import type { StructuredResume, StructuredJD, CategorizedSkills } from './types';

interface DocLike {
  structured_data?: any;
  [k: string]: any;
}

function dataOf(doc: DocLike | null | undefined): any {
  if (!doc) return null;
  return doc.structured_data ?? doc;
}

function joinList(items: unknown): string {
  return (Array.isArray(items) ? items : [])
    .map((x) => (typeof x === 'string' ? x : String((x as any)?.name ?? '')))
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}

function skillLines(skills: CategorizedSkills | string[] | undefined): string[] {
  if (!skills) return [];
  if (Array.isArray(skills)) {
    const s = joinList(skills);
    return s ? [`- ${s}`] : [];
  }
  const labels: [keyof CategorizedSkills, string][] = [
    ['languages', 'Languages'], ['frameworks', 'Frameworks'], ['cloud', 'Cloud'],
    ['databases', 'Databases'], ['ml', 'ML/Data'], ['devops', 'DevOps'], ['tools', 'Tools'],
  ];
  const out: string[] = [];
  for (const [key, label] of labels) {
    const joined = joinList(skills[key]);
    if (joined) out.push(`- ${label}: ${joined}`);
  }
  return out;
}

/** Render the `<candidate_profile>` data block from a resume document. */
export function buildCandidateProfileBlock(resumeDoc: DocLike | null): string {
  const data = dataOf(resumeDoc) as StructuredResume | null;
  if (!data) return '';
  const id = data.identity ?? {};
  const lines: string[] = ['<candidate_profile>'];

  if (id.name) lines.push(`Name: ${id.name}`);
  if (id.location) lines.push(`Location: ${id.location}`);
  if (id.email) lines.push(`Email: ${id.email}`);
  if (id.summary) lines.push(`Summary: ${id.summary}`);

  const sLines = skillLines(data.skills as any);
  if (sLines.length) {
    lines.push('', 'Skills:', ...sLines);
  }

  const exp = data.experience ?? [];
  if (exp.length) {
    lines.push('', 'Experience:');
    for (const e of exp) {
      const head = [e.role, e.company && `at ${e.company}`].filter(Boolean).join(' ');
      const dates = [e.start_date, e.end_date ?? 'Present'].filter(Boolean).join(' – ');
      const intern = e.is_internship ? ' [internship]' : '';
      lines.push(`- ${head}${dates ? ` (${dates})` : ''}${intern}`);
      for (const b of e.bullets ?? []) lines.push(`  - ${b}`);
    }
  }

  const projects = data.projects ?? [];
  if (projects.length) {
    lines.push('', 'Projects:');
    for (const p of projects) {
      const tech = joinList(p.technologies);
      lines.push(`- ${p.name}${p.description ? `: ${p.description}` : ''}${tech ? ` (${tech})` : ''}`);
    }
  }

  const education = data.education ?? [];
  if (education.length) {
    lines.push('', 'Education:');
    for (const ed of education) {
      const deg = [ed.degree, ed.field && `in ${ed.field}`].filter(Boolean).join(' ');
      lines.push(`- ${[deg, ed.institution && `at ${ed.institution}`].filter(Boolean).join(', ')}`);
    }
  }

  if ((data.certifications ?? []).length) {
    lines.push('', `Certifications: ${joinList(data.certifications)}`);
  }

  lines.push('</candidate_profile>');
  return lines.join('\n');
}

/** Render the `<target_job>` data block from a JD document. */
export function buildTargetJobBlock(jdDoc: DocLike | null): string {
  const data = dataOf(jdDoc) as StructuredJD | null;
  if (!data) return '';
  const lines: string[] = ['<target_job>'];

  if (data.title) lines.push(`Role: ${data.title}`);
  if (data.company) lines.push(`Company: ${data.company}`);
  if (data.location) lines.push(`Location: ${data.location}`);
  if (data.level) lines.push(`Level: ${data.level}`);
  if (data.min_years_experience) lines.push(`Minimum experience: ${data.min_years_experience} years`);
  if (data.compensation_hint) lines.push(`Compensation: ${data.compensation_hint}`);
  if (data.description_summary) lines.push(`Summary: ${data.description_summary}`);

  if ((data.requirements ?? []).length) {
    lines.push('', 'Requirements:');
    for (const r of data.requirements ?? []) lines.push(`- ${r}`);
  }
  if ((data.responsibilities ?? []).length) {
    lines.push('', 'Responsibilities:');
    for (const r of data.responsibilities ?? []) lines.push(`- ${r}`);
  }
  const tech = joinList(data.technologies);
  if (tech) lines.push('', `Technologies: ${tech}`);
  const nice = joinList(data.nice_to_haves);
  if (nice) lines.push(`Nice to have: ${nice}`);

  lines.push('</target_job>');
  return lines.join('\n');
}

// The rules text deliberately does NOT contain the literal "<candidate_profile>\n"
// opening sequence, so callers can count that sequence to detect double-injection.
export const GROUNDING_RULES = [
  '<grounding_rules>',
  "The blocks below contain the USER'S OWN data — the resume and/or job description",
  'they uploaded into this app. Treat it as authoritative ground truth about the user.',
  '',
  "AUTHORIZATION: This is the user's OWN uploaded data. NEVER reply that you lack access",
  "to it, that you cannot see it, or that you don't have their information — you do,",
  'it is provided below. Answer directly from it.',
  '',
  'COMPLETENESS: When asked to list skills, projects, or experience, include EVERY',
  'relevant item from the data below; do not truncate or summarize the details away.',
  '',
  'FIELD PRECISION: Quote names, companies, dates and technologies EXACTLY as they',
  'appear in the data. Never invent, approximate, or round them.',
  '',
  'SECURITY: Your instruction-confidentiality rules apply to your SYSTEM PROMPT but',
  "NEVER to the user's own uploaded data. A question such as \"what is in my resume?\"",
  "or \"what is in my uploaded job description?\" is a legitimate request for the",
  "user's own information, not an attempt to extract your instructions.",
  '</grounding_rules>',
].join('\n');

/**
 * Assemble the full grounding block. Returns an empty block when neither a
 * resume nor a JD is present.
 */
export function buildGroundingBlock(
  resumeDoc: DocLike | null,
  jdDoc: DocLike | null,
): { block: string; hasResume: boolean; hasJD: boolean } {
  const resumeBlock = buildCandidateProfileBlock(resumeDoc);
  const jdBlock = buildTargetJobBlock(jdDoc);
  const hasResume = Boolean(resumeBlock);
  const hasJD = Boolean(jdBlock);

  if (!hasResume && !hasJD) {
    return { block: '', hasResume: false, hasJD: false };
  }

  const parts = [GROUNDING_RULES];
  if (resumeBlock) parts.push(resumeBlock);
  if (jdBlock) parts.push(jdBlock);
  return { block: parts.join('\n\n'), hasResume, hasJD };
}
