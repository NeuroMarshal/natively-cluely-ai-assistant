// premium/electron/knowledge/DocumentChunker.ts
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// Turns a parsed resume / JD into a set of retrievable `context_nodes`. Resume
// and JD use DISJOINT category namespaces so a mixed corpus stays separable.

import { DocType } from './types';
import type {
  ContextNode, StructuredResume, StructuredJD, ResumeExperience, ResumeProject,
} from './types';
import { coerceSkills } from './skillsUtil';

function node(source_type: string, category: string, title: string, text: string): ContextNode {
  return {
    source_type,
    category,
    title: title || category,
    text_content: text.trim(),
    tags: '[]',
    embedding: null,
    embedding_space: null,
  };
}

function experienceText(e: ResumeExperience): string {
  const head = [e.role, e.company && `at ${e.company}`].filter(Boolean).join(' ');
  const dates = [e.start_date, e.end_date ?? 'Present'].filter(Boolean).join(' – ');
  const bullets = (e.bullets ?? []).map((b) => `- ${b}`).join('\n');
  return [head, dates, bullets].filter(Boolean).join('\n');
}

function projectText(p: ResumeProject): string {
  const tech = (p.technologies ?? []).join(', ');
  return [p.name, p.description, tech && `Tech: ${tech}`].filter(Boolean).join('\n');
}

function createResumeNodes(data: StructuredResume): ContextNode[] {
  const nodes: ContextNode[] = [];
  const id = data.identity ?? {};
  const identityText = [
    id.name && `Name: ${id.name}`,
    id.location && `Location: ${id.location}`,
    id.email && `Email: ${id.email}`,
    id.summary && `Summary: ${id.summary}`,
  ].filter(Boolean).join('\n');
  if (identityText) nodes.push(node(DocType.RESUME, 'identity', id.name || 'Identity', identityText));

  if (id.summary) nodes.push(node(DocType.RESUME, 'summary', 'Summary', id.summary));

  // Per-category skill nodes (skills_languages, skills_cloud, …) so a
  // "what cloud tools do I know?" retrieval can isolate one bucket. Empty
  // categories emit no node.
  const categorized = coerceSkills(data.skills as any);
  for (const [category, list] of Object.entries(categorized)) {
    if (Array.isArray(list) && list.length) {
      nodes.push(node(DocType.RESUME, `skills_${category}`, `Skills: ${category}`, list.join(', ')));
    }
  }

  for (const e of data.experience ?? []) {
    const t = experienceText(e);
    if (t.trim()) nodes.push(node(DocType.RESUME, 'experience', [e.role, e.company].filter(Boolean).join(' @ '), t));
  }

  for (const p of data.projects ?? []) {
    const t = projectText(p);
    if (t.trim()) nodes.push(node(DocType.RESUME, 'projects', p.name || 'Project', t));
  }

  for (const ed of data.education ?? []) {
    const t = [ed.degree, ed.field && `in ${ed.field}`, ed.institution && `at ${ed.institution}`].filter(Boolean).join(' ');
    if (t.trim()) nodes.push(node(DocType.RESUME, 'education', ed.institution || 'Education', t));
  }

  for (const a of data.achievements ?? []) {
    if (a && a.trim()) nodes.push(node(DocType.RESUME, 'achievements', 'Achievement', a));
  }

  return nodes;
}

function createJDNodes(data: StructuredJD): ContextNode[] {
  const nodes: ContextNode[] = [];
  const overview = [
    data.title && `Role: ${data.title}`,
    data.company && `Company: ${data.company}`,
    data.location && `Location: ${data.location}`,
    data.level && `Level: ${data.level}`,
    data.description_summary,
  ].filter(Boolean).join('\n');
  if (overview) nodes.push(node(DocType.JD, 'jd_overview', data.title || 'Job Overview', overview));

  if ((data.requirements ?? []).length) {
    nodes.push(node(DocType.JD, 'jd_requirements', 'Requirements', (data.requirements ?? []).map((r) => `- ${r}`).join('\n')));
  }
  if ((data.responsibilities ?? []).length) {
    nodes.push(node(DocType.JD, 'jd_responsibilities', 'Responsibilities', (data.responsibilities ?? []).map((r) => `- ${r}`).join('\n')));
  }
  if ((data.technologies ?? []).length) {
    nodes.push(node(DocType.JD, 'jd_technologies', 'Technologies', (data.technologies ?? []).join(', ')));
  }
  if ((data.nice_to_haves ?? []).length) {
    nodes.push(node(DocType.JD, 'jd_nice_to_haves', 'Nice to have', (data.nice_to_haves ?? []).map((r) => `- ${r}`).join('\n')));
  }
  return nodes;
}

/**
 * Build the `context_nodes` rows for a parsed document. Embeddings are attached
 * later by the orchestrator once an embedding space is known.
 */
export function createDocumentNodes(structuredData: any, type: DocType): ContextNode[] {
  if (!structuredData || typeof structuredData !== 'object') return [];
  return type === DocType.JD
    ? createJDNodes(structuredData as StructuredJD)
    : createResumeNodes(structuredData as StructuredResume);
}
