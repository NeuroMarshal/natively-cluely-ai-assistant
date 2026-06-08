// premium/electron/knowledge/TavilySearchProvider.ts
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// Thin wrapper over the user's own Tavily API key for company research. Uses the
// already-bundled `@tavily/core` dependency, loaded lazily.

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface SearchProvider {
  search(query: string): Promise<SearchResult[]>;
  quotaExhausted?: boolean;
}

export class TavilySearchProvider implements SearchProvider {
  quotaExhausted = false;
  private client: any = null;

  constructor(private apiKey: string) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    const mod: any = await import('@tavily/core');
    const factory = mod.tavily ?? mod.default ?? mod;
    this.client = typeof factory === 'function' ? factory({ apiKey: this.apiKey }) : factory;
    return this.client;
  }

  async search(query: string): Promise<SearchResult[]> {
    try {
      const client = await this.getClient();
      const res = await client.search(query, { maxResults: 6, searchDepth: 'basic' });
      const results = res?.results ?? [];
      return results.map((r: any) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        content: r.content ?? r.rawContent ?? '',
      }));
    } catch (err: any) {
      if (/quota|rate|429|limit/i.test(err?.message ?? '')) this.quotaExhausted = true;
      return [];
    }
  }
}
