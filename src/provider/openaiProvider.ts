import {
  MissingApiKeyError,
  RateLimitError,
  LanternProviderError,
  ModelNotFoundError,
  AuthenticationError,
  TimeoutError,
  FirstTokenTimeoutError,
  CancelledError
} from './errors.js';
import { createLinkedAbortController, wrapStreamWithFirstTokenTimeout, withTimeoutRace } from './timeout.js';
import { getApiKey, maskApiKey } from '../security/credentials.js';
import { sanitizeSecrets } from '../security/secrets.js';
import type {
  IProviderAdapter,
  ProviderStreamParams,
  ProviderStreamResult,
  ProviderTestResult
} from './types.js';
import type {
  ConversationTurn,
  ToolDefinition,
  TokenUsage,
  ToolCallItem,
  ProviderModelInfo,
  ModelCapabilities,
  TimingDiagnostics
} from '../types.js';

export class OpenAIProvider implements IProviderAdapter {
  public id: string;
  public name: string;
  public displayName: string;
  public defaultModel: string;
  public baseUrl: string;
  public customHeaders: Record<string, string>;

  private cachedModels: ProviderModelInfo[] | null = null;

  constructor(options?: {
    id?: string;
    name?: string;
    displayName?: string;
    baseUrl?: string;
    defaultModel?: string;
    headers?: Record<string, string>;
  }) {
    this.id = options?.id || 'openai';
    this.name = options?.name || 'openai';
    this.displayName = options?.displayName || 'OpenAI';
    this.baseUrl = (options?.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.defaultModel = options?.defaultModel || 'gpt-4o';
    this.customHeaders = options?.headers || {};
  }

  public isConfigured(): boolean {
    const { key } = getApiKey(this.id);
    return Boolean(key && key.trim().length > 0);
  }

  public getApiKey(): string | null {
    return getApiKey(this.id).key;
  }

  public getMaskedKey(): string {
    const key = this.getApiKey();
    return key ? maskApiKey(key) : '(not configured)';
  }

  public getCapabilities(modelId: string): ModelCapabilities {
    const lower = modelId.toLowerCase();
    const isReasoning = lower.includes('o1') || lower.includes('o3') || lower.includes('r1');
    const isMini = lower.includes('mini') || lower.includes('nano');
    return {
      streaming: true,
      tools: !isReasoning || lower.includes('o3-mini') || lower.includes('o1-mini'),
      images: !isMini && !lower.includes('embedding'),
      reasoning: isReasoning,
      contextWindow: lower.includes('gpt-4o') ? 128000 : 64000
    };
  }

  public async testConnection(): Promise<ProviderTestResult> {
    const key = this.getApiKey();
    if (!key) {
      return { success: false, latencyMs: 0, error: `Missing API key for ${this.displayName}` };
    }

    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${key}`,
          ...this.customHeaders
        },
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          latencyMs: Date.now() - startTime,
          error: `HTTP ${res.status}: ${text.slice(0, 200)}`
        };
      }

      const data = await res.json() as any;
      const count = Array.isArray(data?.data) ? data.data.length : 0;

      return {
        success: true,
        latencyMs: Date.now() - startTime,
        modelsCount: count,
        resolvedModel: this.defaultModel
      };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error: err.message || String(err)
      };
    }
  }

  public async listModels(refresh = false): Promise<ProviderModelInfo[]> {
    if (!refresh && this.cachedModels && this.cachedModels.length > 0) {
      return this.cachedModels;
    }

    const key = this.getApiKey();
    if (key) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(`${this.baseUrl}/models`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${key}`,
            ...this.customHeaders
          },
          signal: controller.signal
        });

        clearTimeout(timer);

        if (res.ok) {
          const json = await res.json() as any;
          if (Array.isArray(json?.data)) {
            const models: ProviderModelInfo[] = [];
            for (const item of json.data) {
              const id = item.id;
              if (typeof id !== 'string') continue;

              // Filter out whisper, tts, dall-e, embedding models
              const lower = id.toLowerCase();
              if (
                lower.includes('whisper') ||
                lower.includes('tts') ||
                lower.includes('dall-e') ||
                lower.includes('text-embedding') ||
                lower.includes('moderation')
              ) {
                continue;
              }

              models.push({
                id,
                name: id,
                provider: this.id,
                capabilities: this.getCapabilities(id)
              });
            }

            if (models.length > 0) {
              this.cachedModels = models;
              return models;
            }
          }
        }
      } catch {
        // Fall back to verified catalog
      }
    }

    const verified = [
      'gpt-4o',
      'gpt-4o-mini',
      'o3-mini',
      'o1',
      'o1-mini',
      'gpt-4-turbo'
    ];

    return verified.map(id => ({
      id,
      name: id,
      provider: this.id,
      capabilities: this.getCapabilities(id)
    }));
  }

  public async streamGenerate(params: ProviderStreamParams): Promise<ProviderStreamResult> {
    const key = this.getApiKey();
    if (!key) {
      throw new MissingApiKeyError(this.id, `${this.id.toUpperCase()}_API_KEY`);
    }

    const overallStartTime = Date.now();
    const timing: TimingDiagnostics = {
      totalMs: 0,
      toolExecutionMs: {}
    };

    const messages = this.convertHistoryToMessages(params.systemInstruction, params.history);
    const tools = this.convertTools(params.tools);

    const payload: Record<string, unknown> = {
      model: params.model,
      messages,
      stream: true,
      stream_options: { include_usage: true }
    };

    const caps = this.getCapabilities(params.model);
    if (caps.tools && tools.length > 0) {
      payload.tools = tools;
    }

    if (typeof params.temperature === 'number') {
      payload.temperature = params.temperature;
    }

    if (params.maxOutputTokens) {
      payload.max_tokens = params.maxOutputTokens;
    }

    const timeoutMs = params.timeoutMs || 60000;
    const firstTokenTimeoutMs = params.firstTokenTimeoutMs || 30000;
    const connectTimeoutMs = Math.min(timeoutMs, 15000);

    if (params.callbacks.onStateChange) {
      params.callbacks.onStateChange('resolving_credentials');
    }

    let attempts = 0;
    const maxAttempts = 3;
    let lastError: unknown = null;

    while (attempts < maxAttempts) {
      attempts++;
      const connectStart = Date.now();

      if (params.signal?.aborted) {
        throw params.signal.reason || new CancelledError();
      }

      if (params.callbacks.onStateChange) {
        params.callbacks.onStateChange(attempts > 1 ? `retrying:${attempts}` : 'connecting');
      }

      const { controller, cleanup } = createLinkedAbortController(params.signal, timeoutMs);

      try {
        const fetchPromise = fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`,
            ...this.customHeaders
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        const response = await withTimeoutRace(
          fetchPromise,
          connectTimeoutMs,
          `Connection to ${this.displayName} (${params.model})`,
          controller.signal,
          () => controller.abort(new TimeoutError(connectTimeoutMs, `Connection to ${this.displayName} (${params.model})`))
        );

        timing.connectMs = Date.now() - connectStart;

        if (!response.ok) {
          const errorBody = await response.text();
          if (response.status === 401 || response.status === 403) {
            throw new AuthenticationError(`OpenAI Auth Error (${response.status}): ${errorBody}`);
          }
          if (response.status === 429) {
            throw new RateLimitError(`OpenAI Rate Limit: ${errorBody}`);
          }
          if (response.status === 404) {
            throw new ModelNotFoundError(params.model, this.displayName);
          }
          throw new LanternProviderError(`OpenAI API Error (${response.status}): ${errorBody}`, response.status, this.id);
        }

        if (!response.body) {
          throw new LanternProviderError('OpenAI response body is null', undefined, this.id);
        }

        if (params.callbacks.onStateChange) {
          params.callbacks.onStateChange('waiting_first_token');
        }

        const rawStream = this.readSSEStream(response.body);

        let fullText = '';
        const toolCallsMap: Record<number, { id: string; name: string; argsText: string }> = {};
        const usage: TokenUsage = { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 };

        const wrappedStream = wrapStreamWithFirstTokenTimeout(
          rawStream,
          firstTokenTimeoutMs,
          this.displayName,
          params.model,
          controller.signal,
          latencyMs => {
            timing.ttftMs = latencyMs;
            if (params.callbacks.onStateChange) {
              params.callbacks.onStateChange('streaming');
            }
          }
        );

        const streamStart = Date.now();

        for await (const chunk of wrappedStream) {
          const delta = chunk.choices?.[0]?.delta;

          if (delta?.content) {
            fullText += delta.content;
            if (params.callbacks.onChunk) {
              params.callbacks.onChunk(delta.content);
            }
          }

          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0;
              if (!toolCallsMap[index]) {
                toolCallsMap[index] = {
                  id: tc.id || `call_${Date.now()}_${index}`,
                  name: tc.function?.name || '',
                  argsText: tc.function?.arguments || ''
                };
              } else {
                if (tc.id) toolCallsMap[index].id = tc.id;
                if (tc.function?.name) toolCallsMap[index].name = tc.function.name;
                if (tc.function?.arguments) toolCallsMap[index].argsText += tc.function.arguments;
              }
            }
          }

          if (chunk.usage) {
            usage.promptTokens = chunk.usage.prompt_tokens ?? usage.promptTokens;
            usage.candidatesTokens = chunk.usage.completion_tokens ?? usage.candidatesTokens;
            usage.totalTokens = chunk.usage.total_tokens ?? usage.totalTokens;
            if (params.callbacks.onUsage) {
              params.callbacks.onUsage(usage);
            }
          }
        }

        timing.streamMs = Date.now() - streamStart;
        timing.totalMs = Date.now() - overallStartTime;

        const collectedToolCalls: ToolCallItem[] = Object.values(toolCallsMap).map(tc => {
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(tc.argsText || '{}');
          } catch {
            parsedArgs = { raw: tc.argsText };
          }
          return {
            id: tc.id,
            name: tc.name,
            args: parsedArgs
          };
        });

        if (params.callbacks.onToolCalls && collectedToolCalls.length > 0) {
          params.callbacks.onToolCalls(collectedToolCalls);
        }

        cleanup();

        return {
          text: fullText,
          toolCalls: collectedToolCalls,
          usage,
          timing
        };
      } catch (err: any) {
        cleanup();
        lastError = err;

        if (params.signal?.aborted) {
          throw err;
        }

        const msg = String(err?.message || err);
        const isRateLimit = msg.includes('429') || err instanceof RateLimitError;
        const isTransient = msg.includes('503') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('socket hang up');

        if ((isRateLimit || isTransient) && attempts < maxAttempts) {
          const backoff = Math.min(1000 * Math.pow(1.5, attempts), 3000);
          if (params.callbacks.onStateChange) {
            params.callbacks.onStateChange(`retrying:${attempts}`);
          }
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }

        throw err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private convertHistoryToMessages(systemInstruction: string, history: ConversationTurn[]): any[] {
    const messages: any[] = [];

    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }

    for (const turn of history) {
      if (turn.role === 'user') {
        const contentParts: any[] = [];
        if (turn.text) {
          contentParts.push({ type: 'text', text: turn.text });
        }
        if (turn.attachments) {
          for (const att of turn.attachments) {
            if (att.base64Data && att.mimeType.startsWith('image/')) {
              contentParts.push({
                type: 'image_url',
                image_url: { url: `data:${att.mimeType};base64,${att.base64Data}` }
              });
            } else if (att.textContent) {
              contentParts.push({
                type: 'text',
                text: `[Attached File: ${att.name}]\n\`\`\`\n${att.textContent}\n\`\`\``
              });
            }
          }
        }
        messages.push({
          role: 'user',
          content: contentParts.length === 1 && contentParts[0].type === 'text' ? contentParts[0].text : contentParts
        });
      } else if (turn.role === 'model') {
        const msg: any = { role: 'assistant' };
        if (turn.text) msg.content = turn.text;
        if (turn.toolCalls && turn.toolCalls.length > 0) {
          msg.tool_calls = turn.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args)
            }
          }));
        }
        messages.push(msg);
      } else if (turn.role === 'tool') {
        if (turn.toolResults) {
          for (const tr of turn.toolResults) {
            messages.push({
              role: 'tool',
              tool_call_id: tr.callId,
              content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
            });
          }
        }
      }
    }

    return messages;
  }

  private convertTools(tools: ToolDefinition[]): any[] {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
  }

  private async *readSSEStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<any, void, unknown> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === '[DONE]') return;

            try {
              yield JSON.parse(dataStr);
            } catch {
              // Ignore partial JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
