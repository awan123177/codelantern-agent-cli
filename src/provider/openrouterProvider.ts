import { OpenAIProvider } from './openaiProvider.js';
import type { ProviderModelInfo, ModelCapabilities } from '../types.js';

export class OpenRouterProvider extends OpenAIProvider {
  constructor() {
    super({
      id: 'openrouter',
      name: 'openrouter',
      displayName: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'anthropic/claude-3.7-sonnet',
      headers: {
        'HTTP-Referer': 'https://github.com/codelantern/codelantern-agent-cli',
        'X-Title': 'Code Lantern CLI'
      }
    });
  }

  public override getCapabilities(modelId: string): ModelCapabilities {
    const lower = modelId.toLowerCase();
    const isReasoning = lower.includes('r1') || lower.includes('o1') || lower.includes('o3') || lower.includes('reason');
    return {
      streaming: true,
      tools: !lower.includes(':free') && !lower.includes('deepseek-r1'), // Most OpenRouter models support tool calling
      images: lower.includes('vision') || lower.includes('gpt-4o') || lower.includes('claude-3') || lower.includes('gemini'),
      reasoning: isReasoning,
      contextWindow: 128000
    };
  }

  public override async listModels(refresh = false): Promise<ProviderModelInfo[]> {
    const key = this.getApiKey();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      const headers: Record<string, string> = { ...this.customHeaders };
      if (key) {
        headers['Authorization'] = `Bearer ${key}`;
      }

      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      clearTimeout(timer);

      if (res.ok) {
        const json = await res.json() as any;
        if (Array.isArray(json?.data)) {
          const models: ProviderModelInfo[] = json.data.slice(0, 100).map((m: any) => {
            const hasTools = Array.isArray(m.supported_parameters)
              ? m.supported_parameters.includes('tools')
              : !m.id.includes(':free') && !m.id.includes('deepseek-r1');
            const hasVision = typeof m.architecture?.modality === 'string'
              ? m.architecture.modality.includes('image')
              : (m.id.includes('vision') || m.id.includes('gpt-4o') || m.id.includes('claude-3'));
            const isReasoning = m.id.includes('r1') || m.id.includes('o1') || m.id.includes('o3') || m.id.includes('reason');

            return {
              id: m.id,
              name: m.name || m.id,
              provider: this.id,
              description: m.description,
              contextWindow: m.context_length || 128000,
              capabilities: {
                streaming: true,
                tools: hasTools,
                images: hasVision,
                reasoning: isReasoning,
                contextWindow: m.context_length || 128000
              },
              pricing: m.pricing ? {
                promptPer1k: parseFloat(m.pricing.prompt) * 1000,
                completionPer1k: parseFloat(m.pricing.completion) * 1000
              } : undefined
            };
          });
          return models;
        }
      }
    } catch {
      // ignore discovery failure and fall back
    }

    const verified = [
      'anthropic/claude-3.7-sonnet',
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o',
      'openai/o3-mini',
      'google/gemini-2.5-flash',
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.3-70b-instruct'
    ];

    return verified.map(id => ({
      id,
      name: id,
      provider: this.id,
      capabilities: this.getCapabilities(id)
    }));
  }
}
