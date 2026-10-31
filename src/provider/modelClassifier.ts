import type { ModelCapabilities, ProviderModelInfo } from '../types.js';

export type ModelCategory = 'coding' | 'chat' | 'specialized';

export interface ModelClassification {
  id: string;
  category: ModelCategory;
  specializedType?: string;
  isRecommendedForCoding: boolean;
  capabilities: ModelCapabilities;
  warning?: string;
}

const DEFAULT_RECOMMENDED_CODING_MODELS: Record<string, string[]> = {
  gemini: ['gemini-3.8-flash', 'gemini-3.8-pro', 'gemini-3.1-flash', 'gemini-3.1-pro'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'gpt-4-turbo'],
  anthropic: ['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
  openrouter: [
    'anthropic/claude-3.7-sonnet',
    'anthropic/claude-3.5-sonnet',
    'openai/gpt-4o',
    'google/gemini-2.5-flash',
    'meta-llama/llama-3.3-70b-instruct',
    'deepseek/deepseek-chat'
  ]
};

/**
 * Inspects a model ID and optional capability hints to classify whether it is
 * suitable for interactive autonomous coding (tools + chat), chat-only, or specialized.
 */
export function classifyModel(
  modelId: string,
  capabilities?: Partial<ModelCapabilities>,
  description?: string
): ModelClassification {
  const lower = modelId.toLowerCase();
  const desc = (description || '').toLowerCase();

  // 1. Specialized: Embeddings
  if (lower.includes('embedding') || lower.includes('embed') || desc.includes('embedding')) {
    return {
      id: modelId,
      category: 'specialized',
      specializedType: 'Embedding',
      isRecommendedForCoding: false,
      capabilities: {
        streaming: false,
        tools: false,
        images: false,
        reasoning: false,
        ...capabilities
      },
      warning: 'Embeddings model: generates vector representations, not conversational text or tool calls.'
    };
  }

  // 2. Specialized: Image Generation
  if (
    lower.includes('dall-e') ||
    lower.includes('imagen') ||
    lower.includes('stable-diffusion') ||
    desc.includes('image generation')
  ) {
    return {
      id: modelId,
      category: 'specialized',
      specializedType: 'Image Generation',
      isRecommendedForCoding: false,
      capabilities: {
        streaming: false,
        tools: false,
        images: false,
        reasoning: false,
        ...capabilities
      },
      warning: 'Image generation model: generates graphics/images, cannot execute coding tools.'
    };
  }

  // 3. Specialized: Audio / Speech / Transcription
  if (
    lower.includes('whisper') ||
    lower.includes('tts') ||
    lower.includes('speech') ||
    lower.includes('audio') ||
    lower.includes('realtime') ||
    desc.includes('audio') ||
    desc.includes('transcription')
  ) {
    return {
      id: modelId,
      category: 'specialized',
      specializedType: 'Audio/Speech',
      isRecommendedForCoding: false,
      capabilities: {
        streaming: Boolean(capabilities?.streaming),
        tools: false,
        images: false,
        reasoning: false,
        ...capabilities
      },
      warning: 'Audio/Speech model: designed for audio processing, not interactive text coding.'
    };
  }

  // 4. Specialized: Batch-only models
  if (lower.includes(':batch') || lower.includes('-batch') || desc.includes('batch only')) {
    return {
      id: modelId,
      category: 'specialized',
      specializedType: 'Batch Processing',
      isRecommendedForCoding: false,
      capabilities: {
        streaming: false,
        tools: Boolean(capabilities?.tools),
        images: Boolean(capabilities?.images),
        reasoning: Boolean(capabilities?.reasoning),
        ...capabilities
      },
      warning: 'Batch model: processed asynchronously in queues with high latency, not interactive.'
    };
  }

  // 5. Specialized: Moderation / Reranking
  if (lower.includes('moderation') || lower.includes('rerank')) {
    return {
      id: modelId,
      category: 'specialized',
      specializedType: lower.includes('rerank') ? 'Reranker' : 'Moderation',
      isRecommendedForCoding: false,
      capabilities: {
        streaming: false,
        tools: false,
        images: false,
        reasoning: false,
        ...capabilities
      },
      warning: 'Specialized classification or reranking filter, not an interactive assistant.'
    };
  }

  // 6. Check tool use capabilities
  // Explicitly false in capabilities OR known non-tool model (e.g. o1-preview, raw free tiers)
  const isKnownNonTool =
    lower.includes('o1-preview') ||
    lower.includes(':free') && !lower.includes('gemini') ||
    lower.includes('deepseek-r1') && !lower.includes('distill');

  const toolsSupported = capabilities?.tools !== undefined ? capabilities.tools : !isKnownNonTool;
  const streamingSupported = capabilities?.streaming ?? true;
  const imagesSupported = capabilities?.images ?? (
    lower.includes('vision') ||
    lower.includes('gpt-4o') ||
    lower.includes('claude-3') ||
    lower.includes('gemini')
  );
  const reasoningSupported = capabilities?.reasoning ?? (
    lower.includes('o1') ||
    lower.includes('o3') ||
    lower.includes('r1') ||
    lower.includes('thinking')
  );

  const resolvedCapabilities: ModelCapabilities = {
    streaming: streamingSupported,
    tools: toolsSupported,
    images: imagesSupported,
    reasoning: reasoningSupported,
    contextWindow: capabilities?.contextWindow || 128000
  };

  if (!toolsSupported) {
    return {
      id: modelId,
      category: 'chat',
      isRecommendedForCoding: false,
      capabilities: resolvedCapabilities,
      warning: 'Chat-only model: does not support tool/function calling (cannot inspect files, apply edits, or execute commands).'
    };
  }

  return {
    id: modelId,
    category: 'coding',
    isRecommendedForCoding: true,
    capabilities: resolvedCapabilities
  };
}

/**
 * Returns a list of known compatible coding models for the given provider.
 */
export function getRecommendedCodingModels(
  providerId: string,
  availableModels?: ProviderModelInfo[]
): string[] {
  const norm = providerId.toLowerCase();

  if (availableModels && availableModels.length > 0) {
    const fromList = availableModels
      .filter(m => {
        const c = classifyModel(m.id, m.capabilities, m.description);
        return c.category === 'coding';
      })
      .map(m => m.id);

    if (fromList.length > 0) {
      return fromList.slice(0, 5);
    }
  }

  return DEFAULT_RECOMMENDED_CODING_MODELS[norm] || ['gemini-3.8-flash', 'gpt-4o', 'claude-3-7-sonnet'];
}
