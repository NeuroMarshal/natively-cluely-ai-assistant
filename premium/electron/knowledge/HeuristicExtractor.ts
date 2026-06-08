// premium/electron/knowledge/HeuristicExtractor.ts
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// A dependency-free, regex/heuristic parser for resume and JD text. It is the
// LLM-DOWN fallback: when the language model is unavailable or returns an
// unparseable response, the engine still produces usable structured facts so
// profile grounding keeps working (lower fidelity). Output is tagged with
// `_extraction_mode: 'heuristic'` so the UI can offer a richer re-extraction
// later.

import type { StructuredResume, StructuredJD, ResumeExperience } from './types';
import { normalizeSkills } from './skillsUtil';

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const URL_RE = /(https?:\/\/[^\s]+|(?:www\.|linkedin\.com\/|github\.com\/)[^\s]+)/i;

const SECTION_HEADERS = [
  'summary', 'objective', 'experience', 'work experience', 'employment',
  'projects', 'skills', 'technical skills', 'education', 'achievements',
  'certifications', 'leadership', 'awards', 'publications',
];

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim());
}

function isHeader(line: string): string | null {
  const lower = line.toLowerCase().replace(/[:|].*$/, '').trim();
  if (lower.length > 30) return null;
  return SECTION_HEADERS.find((h) => lower === h || lower === `${h}:`) ?? null;
}

/** Group non-empty lines under their preceding section header. */
function sectionize(lines: string[]): Record<string, string[]> {
  const sections: Record<string, string[]> = { _preamble: [] };
  let current = '_preamble';
  for (const line of lines) {
    if (!line) continue;
    const header = isHeader(line);
    if (header) {
      current = header.includes('skill') ? 'skills'
        : header.includes('experience') || header.includes('employment') ? 'experience'
        : header.includes('project') ? 'projects'
        : header.includes('education') ? 'education'
        : header.includes('summary') || header.includes('objective') ? 'summary'
        : header;
      sections[current] = sections[current] ?? [];
      continue;
    }
    (sections[current] = sections[current] ?? []).push(line);
  }
  return sections;
}

const SKILL_SPLIT_RE = /[,;|•·]/;

function parseSkills(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    // Strip a leading category label ("Languages:", "AI/ML:", "Cloud:", …).
    const cleaned = line.replace(/^[A-Za-z][A-Za-z/&+. -]{0,24}:\s*/, '');
    for (const tok of cleaned.split(SKILL_SPLIT_RE)) {
      const s = tok.trim();
      if (s && s.length <= 40) out.push(s);
    }
  }
  return [...new Set(out)];
}

const EXPERIENCE_LINE_RE = /^(.+?)\s*[|@\-–—]\s*(.+?)(?:\s*[|@\-–—]\s*(.+))?$/;
const DATE_RANGE_RE = /(\d{4}[-/.]?\d{0,2})\s*[-–—to]+\s*(present|current|\d{4}[-/.]?\d{0,2})/i;

function parseExperience(lines: string[]): ResumeExperience[] {
  const entries: ResumeExperience[] = [];
  let current: ResumeExperience | null = null;
  for (const line of lines) {
    const isBullet = /^[-*•·]/.test(line);
    if (isBullet && current) {
      (current.bullets = current.bullets ?? []).push(line.replace(/^[-*•·]\s*/, '').trim());
      continue;
    }
    const dateMatch = line.match(DATE_RANGE_RE);
    const looksLikeHeadline = /[|@]/.test(line) || dateMatch;
    if (looksLikeHeadline) {
      if (current) entries.push(current);
      const headline = line.replace(DATE_RANGE_RE, '').replace(/[|@\-–—]\s*$/, '').trim();
      const m = headline.match(EXPERIENCE_LINE_RE);
      const role = m?.[1]?.trim();
      const company = m?.[2]?.trim();
      current = {
        role: role || headline || undefined,
        company: company || undefined,
        start_date: dateMatch?.[1] ?? null,
        end_date: dateMatch ? (/present|current/i.test(dateMatch[2]) ? null : dateMatch[2]) : null,
        bullets: [],
        is_internship: /\bintern(ship)?\b/i.test(line),
      };
    } else if (current && line) {
      if (/technolog/i.test(line)) continue; // tech line handled by skills
      (current.bullets = current.bullets ?? []).push(line);
    }
  }
  if (current) entries.push(current);
  return entries.filter((e) => e.role || e.company);
}

export class HeuristicExtractor {
  extractResume(text: string): StructuredResume {
    const lines = splitLines(text);
    const sections = sectionize(lines);
    const nonEmpty = lines.filter(Boolean);

    const email = text.match(EMAIL_RE)?.[0] ?? '';
    const phone = text.match(PHONE_RE)?.[0]?.trim() ?? '';
    const github = text.match(/github\.com\/[A-Za-z0-9_.-]+/i)?.[0] ?? '';
    const linkedin = text.match(/linkedin\.com\/(?:in\/)?[A-Za-z0-9_.-]+/i)?.[0] ?? '';
    const website = text.match(/https?:\/\/[^\s|]+/i)?.[0] ?? github ?? linkedin ?? '';
    // Name: first non-empty line that isn't an email/header/contact line and that
    // contains a lowercase letter (rejects ALL-CAPS section headers like "RESUME").
    const name = nonEmpty.find((l) =>
      !EMAIL_RE.test(l) && !isHeader(l) && !/^\+?\d/.test(l) && /[a-z]/.test(l) && l.split(' ').length <= 5,
    ) ?? '';

    const skillsFlat = parseSkills(sections.skills ?? []);
    const experience = parseExperience(sections.experience ?? []);
    const projects = (sections.projects ?? [])
      .filter((l) => !/^[-*•·]/.test(l))
      .map((l) => {
        // Split name/description on the FIRST colon only — never on hyphens, so a
        // hyphenated project name ("ABTest-Framework") stays intact.
        const idx = l.indexOf(':');
        const pname = (idx >= 0 ? l.slice(0, idx) : l).trim();
        const desc = idx >= 0 ? l.slice(idx + 1).trim() : '';
        return { name: pname, description: desc || undefined, technologies: [] as string[] };
      })
      .filter((p) => p.name);
    const education = (sections.education ?? []).map((l) => {
      const parts = l.split(/[|]/).map((p) => p.trim());
      return { institution: parts[0], degree: parts[1], field: parts[2], start_date: '', end_date: '' };
    }).filter((e) => e.institution);

    return {
      _schema_version: 2,
      _extraction_mode: 'heuristic',
      identity: {
        name, email, phone,
        location: '', linkedin, github, website,
        summary: (sections.summary ?? []).join(' ').slice(0, 600),
      },
      skills: normalizeSkills(skillsFlat),
      skills_flat: skillsFlat,
      experience,
      projects,
      education,
      achievements: sections.achievements ?? [],
      certifications: sections.certifications ?? [],
      leadership: sections.leadership ?? [],
    };
  }

  extractJD(text: string): StructuredJD {
    const lines = splitLines(text);
    const field = (label: RegExp): string => {
      const line = lines.find((l) => label.test(l));
      return line ? line.replace(label, '').replace(/^[:\-\s]+/, '').trim() : '';
    };
    const listAfter = (label: RegExp): string[] => {
      const idx = lines.findIndex((l) => label.test(l));
      if (idx < 0) return [];
      const out: string[] = [];
      for (let i = idx + 1; i < lines.length; i++) {
        const l = lines[i];
        if (!l) { if (out.length) break; else continue; }
        if (/^[A-Z][a-z]+.*:$/.test(l) && !/^[-*•·]/.test(l)) break; // next header
        out.push(l.replace(/^[-*•·]\s*/, '').trim());
      }
      return out.filter(Boolean);
    };

    const technologies = parseSkills([field(/technolog\w*/i)]);
    // Map free text to the closed enum sets the downstream code expects, with
    // safe defaults so a missing field never crashes a consumer.
    const lower = text.toLowerCase();
    const level = /\bprincipal\b/.test(lower) ? 'principal'
      : /\bstaff\b/.test(lower) ? 'staff'
      : /\bsenior\b/.test(lower) ? 'senior'
      : /\b(junior|entry[\s-]?level)\b/.test(lower) ? 'entry'
      : /\bintern(ship)?\b/.test(lower) ? 'intern'
      : 'mid';
    const employment_type = /\bpart[\s-]?time\b/.test(lower) ? 'part_time'
      : /\bcontract(or)?\b/.test(lower) ? 'contract'
      : /\bintern(ship)?\b/.test(lower) ? 'internship'
      : 'full_time';
    return {
      _extraction_mode: 'heuristic',
      title: field(/job\s*title/i) || field(/^title/i) || lines.find(Boolean) || '',
      company: field(/company/i),
      location: field(/location/i),
      description_summary: field(/summary|about/i),
      level,
      employment_type,
      min_years_experience: parseInt(field(/(years|experience)/i).match(/\d+/)?.[0] ?? '0', 10) || 0,
      compensation_hint: field(/salary|compensation|pay/i),
      requirements: listAfter(/requirements?/i),
      nice_to_haves: listAfter(/nice[\s-]to[\s-]haves?|preferred/i),
      responsibilities: listAfter(/responsibilit/i),
      technologies,
      keywords: technologies,
    };
  }
}

// ── Functional wrappers (the public API used by the rest of the engine) ───────

const _sharedExtractor = new HeuristicExtractor();

/** LLM-free resume parser → minimal structured profile facts. */
export function heuristicResumeExtract(text: string): StructuredResume {
  return _sharedExtractor.extractResume(text);
}

/** LLM-free JD parser → minimal structured job facts. */
export function heuristicJDExtract(text: string): StructuredJD {
  return _sharedExtractor.extractJD(text);
}
