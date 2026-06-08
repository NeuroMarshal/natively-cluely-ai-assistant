// premium/electron/knowledge/CompanyResearchEngine.ts
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// Produces a tailored "company dossier" for interview prep. It optionally pulls
// fresh web context via a search provider (Tavily or Natively API), then asks the
// injected LLM to synthesize a dossier scoped to the candidate's target role.

import type { SearchProvider } from './TavilySearchProvider';

export type GenerateContentFn = (
  contents: Array<{ text: string }> | string,
) => Promise<string>;

export interface CompanyDossier {
  company: string;
  overview: string;
  products: string[];
  culture: string[];
  interviewFocus: string[];
  recentNews: string[];
  tailoredTalkingPoints: string[];
  sources: string[];
  generatedAt: number;
}

function tryParseJSON<T>(text: string): T | null {
  if (!text) return null;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text) as T;
  } catch {
    return null;
  }
}

export class CompanyResearchEngine {
  searchProvider: SearchProvider | null = null;

  constructor(private generateFn: GenerateContentFn | null = null) {}

  setGenerateContentFn(fn: GenerateContentFn): void {
    this.generateFn = fn;
  }

  setSearchProvider(provider: SearchProvider): void {
    this.searchProvider = provider;
  }

  async researchCompany(
    companyName: string,
    jdContext: Record<string, any> = {},
    _tailor = true,
  ): Promise<CompanyDossier> {
    const sources: string[] = [];
    let webContext = '';

    if (this.searchProvider) {
      const queries = [
        `${companyName} company overview products`,
        `${companyName} engineering interview process`,
        `${companyName} recent news ${new Date().getFullYear?.() ?? ''}`.trim(),
      ];
      for (const q of queries) {
        const results = await this.searchProvider.search(q);
        for (const r of results.slice(0, 4)) {
          if (r.url) sources.push(r.url);
          if (r.content) webContext += `\n- ${r.title}: ${r.content.slice(0, 400)}`;
        }
      }
    }

    const fallback: CompanyDossier = {
      company: companyName,
      overview: '',
      products: [],
      culture: [],
      interviewFocus: [],
      recentNews: [],
      tailoredTalkingPoints: [],
      sources: [...new Set(sources)],
      generatedAt: Date.now(),
    };

    if (!this.generateFn) return fallback;

    const prompt = [
      `Build a concise interview-prep dossier for the company "${companyName}".`,
      'Return STRICT JSON: {"overview": string, "products": string[], "culture": string[],',
      '"interviewFocus": string[], "recentNews": string[], "tailoredTalkingPoints": string[]}.',
      jdContext && Object.keys(jdContext).length
        ? `Tailor it to this target role context: ${JSON.stringify(jdContext)}`
        : '',
      webContext ? `Use these freshly retrieved facts where relevant:${webContext}` : '',
      'Keep each list to 3–6 items. Be specific and accurate; do not invent facts.',
    ].filter(Boolean).join('\n');

    let raw = '';
    try {
      raw = await this.generateFn([{ text: prompt }]);
    } catch {
      return fallback;
    }
    const parsed = tryParseJSON<Partial<CompanyDossier>>(raw);
    if (!parsed) return { ...fallback, overview: raw.slice(0, 1500) };

    return {
      company: companyName,
      overview: parsed.overview ?? '',
      products: parsed.products ?? [],
      culture: parsed.culture ?? [],
      interviewFocus: parsed.interviewFocus ?? [],
      recentNews: parsed.recentNews ?? [],
      tailoredTalkingPoints: parsed.tailoredTalkingPoints ?? [],
      sources: [...new Set(sources)],
      generatedAt: Date.now(),
    };
  }
}
