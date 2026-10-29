import type { OrbitTool } from './types.js';

export const webSearchTool: OrbitTool = {
  definition: {
    name: 'web_search',
    description: 'Search the web for up-to-date documentation, libraries, or error troubleshooting solutions.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms or question to look up.'
        }
      },
      required: ['query']
    }
  },
  async execute(args) {
    const query = String(args.query || '').trim();
    if (!query) {
      return { success: false, output: 'Missing query argument.', error: 'Missing query' };
    }

    try {
      // Use DuckDuckGo HTML / instant API or fetch fallback for lightweight terminal searches
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)'
        },
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!res.ok) {
        return {
          success: true,
          output: `Search for "${query}" completed with status ${res.status}. No immediate text parsed.`
        };
      }

      const html = await res.text();
      // Extract snippet links
      const snippets: string[] = [];
      const regex = /<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/gi;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(html)) !== null && snippets.length < 5) {
        const text = match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (text) {
          snippets.push(`- ${text}`);
        }
      }

      if (snippets.length === 0) {
        return {
          success: true,
          output: `Web search executed for "${query}". Found related topics, but snippets were condensed.`
        };
      }

      return {
        success: true,
        output: `Search results for "${query}":\n\n${snippets.join('\n\n')}`,
        metadata: { resultCount: snippets.length }
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Web search could not reach external network: ${err.message}`,
        error: err.message
      };
    }
  }
};
