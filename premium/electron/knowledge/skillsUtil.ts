// premium/electron/knowledge/skillsUtil.ts
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// Helpers for the categorized-skills schema (v2). Skills are bucketed into
// {languages, frameworks, cloud, databases, ml, devops, tools}; an unknown skill
// always lands in `tools` (never dropped). A flat list is derived for the
// open-source profile fast-path, and a question→category mapper lets a "what
// cloud tools do I know?" answer return ONLY cloud skills (RC-3).

import type { CategorizedSkills } from './types';

export type SkillCategory = keyof CategorizedSkills;

export const ALL_CATEGORIES: SkillCategory[] = [
  'languages', 'frameworks', 'cloud', 'databases', 'ml', 'devops', 'tools',
];

const LANGUAGES = new Set([
  'python', 'javascript', 'typescript', 'java', 'c', 'c++', 'c#', 'go', 'golang',
  'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'r', 'matlab', 'perl',
  'objective-c', 'dart', 'elixir', 'haskell', 'lua', 'sql', 'html', 'css',
  'solidity', 'clojure', 'f#', 'julia', 'groovy',
]);

const FRAMEWORKS = new Set([
  'react', 'react.js', 'reactjs', 'angular', 'vue', 'vue.js', 'svelte', 'next.js',
  'nextjs', 'nuxt', 'node.js', 'nodejs', 'express', 'express.js', 'django', 'flask',
  'fastapi', 'spring', 'spring boot', 'rails', 'ruby on rails', 'laravel', 'symfony',
  '.net', 'asp.net', 'flutter', 'react native', 'electron', 'qt', 'tailwind',
  'redux', 'graphql', 'rest', 'jquery', 'bootstrap', 'gatsby', 'remix',
  'nestjs', 'phoenix', 'fiber', 'gin',
]);

const CLOUD = new Set([
  'aws', 'amazon web services', 'gcp', 'google cloud', 'azure', 'microsoft azure',
  'digitalocean', 'heroku', 'vercel', 'netlify', 'cloudflare', 'firebase',
  'lambda', 's3', 'ec2', 'cloudfront', 'route53', 'rds',
]);

const DATABASES = new Set([
  'postgresql', 'postgres', 'mysql', 'mariadb', 'sqlite', 'mongodb', 'redis',
  'cassandra', 'dynamodb', 'elasticsearch', 'neo4j', 'couchdb', 'oracle',
  'mssql', 'sql server', 'snowflake', 'bigquery', 'redshift', 'clickhouse',
  'influxdb', 'cockroachdb', 'supabase', 'firestore', 'pgvector', 'pinecone',
  'weaviate', 'qdrant', 'chroma',
]);

const ML = new Set([
  'tensorflow', 'pytorch', 'keras', 'scikit-learn', 'sklearn', 'pandas', 'numpy',
  'scipy', 'hugging face', 'huggingface', 'transformers', 'opencv', 'spacy',
  'nltk', 'xgboost', 'lightgbm', 'machine learning', 'deep learning', 'nlp',
  'computer vision', 'llm', 'langchain', 'llamaindex', 'jax', 'mlflow', 'spark',
  'hadoop', 'data analysis', 'analytics', 'statistics', 'tableau', 'power bi',
]);

const DEVOPS = new Set([
  'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'jenkins', 'gitlab ci',
  'github actions', 'circleci', 'travis', 'prometheus', 'grafana', 'datadog',
  'kafka', 'rabbitmq', 'nginx', 'apache', 'helm', 'argocd', 'vault', 'consul',
  'ci/cd', 'linux', 'bash', 'grpc',
]);

/** Bucket a single skill. Unknown → 'tools'. */
export function classifySkill(skill: string): SkillCategory {
  const s = (skill ?? '').toString().trim().toLowerCase();
  if (!s) return 'tools';
  if (LANGUAGES.has(s)) return 'languages';
  if (FRAMEWORKS.has(s)) return 'frameworks';
  if (CLOUD.has(s)) return 'cloud';
  if (DATABASES.has(s)) return 'databases';
  if (ML.has(s)) return 'ml';
  if (DEVOPS.has(s)) return 'devops';
  return 'tools';
}

function emptyCategorized(): CategorizedSkills {
  return { languages: [], frameworks: [], cloud: [], databases: [], ml: [], devops: [], tools: [] };
}

function skillName(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object') return String((raw as any).name ?? (raw as any).skill ?? '').trim();
  return '';
}

/** Push a skill into a bucket, de-duplicating case-insensitively. */
function pushUnique(bucket: string[], name: string): void {
  const lower = name.toLowerCase();
  if (!bucket.some((x) => x.toLowerCase() === lower)) bucket.push(name);
}

/** Deterministically bucket a flat skill list. Unknown skills → tools. */
export function categorizeFlatSkills(flat: unknown): CategorizedSkills {
  const out = emptyCategorized();
  const list = Array.isArray(flat) ? flat : [];
  for (const raw of list) {
    const name = skillName(raw);
    if (!name) continue;
    pushUnique(out[classifySkill(name)], name);
  }
  return out;
}

/** True if the value is the legacy flat-array skill shape. */
export function isLegacyFlatSkills(raw: unknown): boolean {
  return Array.isArray(raw);
}

/**
 * Coerce any historical skills shape into a fully-populated categorized object:
 *   - undefined/null            → all-empty buckets
 *   - flat array                → deterministically categorized
 *   - partial/full object       → known buckets kept, missing filled with []
 *   - unknown category keys     → folded into `tools` (never dropped)
 * De-duplicates within each bucket case-insensitively.
 */
export function coerceSkills(raw: unknown): CategorizedSkills {
  if (raw == null) return emptyCategorized();
  if (Array.isArray(raw)) return categorizeFlatSkills(raw);
  if (typeof raw === 'object') {
    const out = emptyCategorized();
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const target: SkillCategory = (ALL_CATEGORIES as string[]).includes(key)
        ? (key as SkillCategory)
        : 'tools';
      for (const item of value) {
        const name = skillName(item);
        if (name) pushUnique(out[target], name);
      }
    }
    return out;
  }
  return emptyCategorized();
}

/** Flatten a categorized object (or legacy flat array) into a string list. */
export function flattenSkills(skills: CategorizedSkills | string[] | null | undefined): string[] {
  if (!skills) return [];
  if (Array.isArray(skills)) return skills.map(skillName).filter(Boolean);
  const out: string[] = [];
  for (const v of Object.values(skills)) {
    if (Array.isArray(v)) for (const item of v) { const n = skillName(item); if (n) out.push(n); }
  }
  return out;
}

// Question → category keyword mapping (RC-3). An empty result means "all
// buckets" (a generic "what are my skills?" ask).
const CATEGORY_QUESTION_PATTERNS: [SkillCategory, RegExp][] = [
  ['languages', /\b(programming|coding)\s+languages?\b/],
  ['languages', /\blanguages?\b/],
  ['cloud', /\bcloud\b/],
  ['devops', /\b(devops|dev\s?ops|infrastructure|ci\/cd|pipelines?)\b/],
  ['databases', /\b(databases?|datastores?|data\s+stores?)\b/],
  ['ml', /\b(ai|a\.i\.|machine\s+learning|deep\s+learning|\bml\b|data\s+science|nlp)\b/],
  ['frameworks', /\bframeworks?\b/],
];

/**
 * Map a natural-language question to the skill buckets it asks about. Returns []
 * when the question is generic (no specific bucket), meaning "all skills".
 */
export function detectSkillCategories(question: string): SkillCategory[] {
  const q = (question ?? '').toLowerCase();
  const found: SkillCategory[] = [];
  for (const [cat, re] of CATEGORY_QUESTION_PATTERNS) {
    if (re.test(q) && !found.includes(cat)) found.push(cat);
  }
  return found;
}

// ── Back-compat aliases used elsewhere in the engine ──────────────────────────

/** Alias of {@link coerceSkills}. */
export function normalizeSkills(raw: unknown): CategorizedSkills {
  return coerceSkills(raw);
}

/** Alias of {@link categorizeFlatSkills}. */
export function categorizeSkills(flat: unknown): CategorizedSkills {
  return categorizeFlatSkills(flat);
}
