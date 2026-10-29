import { MissingApiKeyError, RateLimitError, LanternProviderError, ModelNotFoundError, AuthenticationError } from './errors.js';
import { createLinkedAbortController, wrapStreamWithFirstTokenTimeout } from './timeout.js';
import { getApiKey, maskApiKey } from '../security/credentials.js';
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

export class AnthropicProvider implements IProviderAdapter {
  public id = 'anthropic';
  public name = 'anthropic';
  public displayName = 'Anthropic Claude';
  public defaultModel = 'claude-3-7-sonnet-20250219';
  public baseUrl = 'https://api.anthropic.com/v1';

  private cachedModels: ProviderModelInfo[] | null = null;

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
    const isSonnet = lower.includes('sonnet');
    const isOpus = lower.includes('opus');
    return {
      streaming: true,
      tools: true,
      images: true,
      reasoning: isSonnet || isOpus,
      contextWindow: 200000
    };
  }

  public async testConnection(): Promise<ProviderTestResult> {
    const key = this.getApiKey();
    if (!key) {
      return { success: false, latencyMs: 0, error: 'Missing ANTHROPIC_API_KEY' };
    }

    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      // Lightweight test request with max_tokens: 1
      const res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }]
        }),
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

      return {
        success: true,
        latencyMs: Date.now() - startTime,
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
        const timer = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(`${this.baseUrl}/models`, {
          method: 'GET',
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01'
          },
          signal: controller.signal
        });

        clearTimeout(timer);

        if (res.ok) {
          const json = await res.json() as any;
          if (Array.isArray(json?.data)) {
            const models: ProviderModelInfo[] = json.data.map((m: any) => ({
              id: m.id,
              name: m.display_name || m.id,
              provider: this.id,
              capabilities: this.getCapabilities(m.id),
              contextWindow: 200000
            }));
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
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229'
    ];

    return verified.map(id => ({
      id,
      name: id,
      provider: this.id,
      capabilities: this.getCapabilities(id),
      contextWindow: 200000
    }));
  }

  public async streamGenerate(params: ProviderStreamParams): Promise<ProviderStreamResult> {
    const key = this.getApiKey();
    if (!key) {
      throw new MissingApiKeyError(this.id, 'ANTHROPIC_API_KEY');
    }

    const overallStartTime = Date.now();
    const timing: TimingDiagnostics = {
      totalMs: 0,
      toolExecutionMs: {}
    };

    const { messages, system } = this.convertHistoryToMessages(params.systemInstruction, params.history);
    const tools = this.convertTools(params.tools);

    const payload: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.maxOutputTokens || 4096,
      stream: true
    };

    if (system) {
      payload.system = system;
    }

    if (tools.length > 0) {
      payload.tools = tools;
    }

    if (typeof params.temperature === 'number') {
      payload.temperature = params.temperature;
    }

    const timeoutMs = params.timeoutMs || 60000;
    const firstTokenTimeoutMs = params.firstTokenTimeoutMs || 30000;

    let attempts = 0;
    const maxAttempts = 3;
    let lastError: unknown = null;

    while (attempts < maxAttempts) {
      attempts++;
      const connectStart = Date.now();

      if (params.callbacks.onStateChange) {
        params.callbacks.onStateChange(attempts > 1 ? `retrying:${attempts}` : 'connecting');
      }

      const { controller, cleanup } = createLinkedAbortController(params.signal, timeoutMs);

      try {
        const response = await fetch(`${this.baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        timing.connectMs = Date.now() - connectStart;

        if (!response.ok) {
          const errorBody = await response.text();
          if (response.status === 401 || response.status === 403) {
            throw new AuthenticationError(`Anthropic Auth Error (${response.status}): ${errorBody}`);
          }
          if (response.status === 429) {
            throw new RateLimitError(`Anthropic Rate Limit: ${errorBody}`);
          }
          if (response.status === 404) {
            throw new ModelNotFoundError(params.model, this.displayName);
          }
          throw new LanternProviderError(`Anthropic API Error (${response.status}): ${errorBody}`, response.status, this.id);
        }

        if (!response.body) {
          throw new LanternProviderError('Anthropic response body is null', undefined, this.id);
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

        for await (const event of wrappedStream) {
          const type = event.type;

          if (type === 'message_start' && event.message?.usage) {
            usage.promptTokens = event.message.usage.input_tokens || 0;
          }

          if (type === 'content_block_start') {
            const index = event.index ?? 0;
            if (event.content_block?.type === 'tool_use') {
              toolCallsMap[index] = {
                id: event.content_block.id || `call_${Date.now()}_${index}`,
                name: event.content_block.name || '',
                argsText: ''
              };
            }
          }

          if (type === 'content_block_delta') {
            const index = event.index ?? 0;
            const delta = event.delta;

            if (delta?.type === 'text_delta' && delta.text) {
              fullText += delta.text;
              if (params.callbacks.onChunk) {
                params.callbacks.onChunk(delta.text);
              }
            } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
              if (toolCallsMap[index]) {
                toolCallsMap[index].argsText += delta.partial_json;
              }
            }
          }

          if (type === 'message_delta' && event.usage) {
            usage.candidatesTokens = event.usage.output_tokens || 0;
            usage.totalTokens = usage.promptTokens + usage.candidatesTokens;
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
        const isTransient = msg.includes('503') || msg.includes('overloaded') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT');

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

  private convertHistoryToMessages(systemInstruction: string, history: ConversationTurn[]): { messages: any[]; system?: string } {
    const messages: any[] = [];

    for (const turn of history) {
      if (turn.role === 'user') {
        const content: any[] = [];
        if (turn.text) {
          content.push({ type: 'text', text: turn.text });
        }
        if (turn.attachments) {
          for (const att of turn.attachments) {
            if (att.base64Data && att.mimeType.startsWith('image/')) {
              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: att.mimeType,
                  data: att.base64Data
                }
              });
            } else if (att.textContent) {
              content.push({
                type: 'text',
                text: `[Attached File: ${att.name}]\n\`\`\`\n${att.textContent}\n\`\`\``
              });
            }
          }
        }
        messages.push({ role: 'user', content });
      } else if (turn.role === 'model') {
        const content: any[] = [];
        if (turn.text) {
          content.push({ type: 'text', text: turn.text });
        }
        if (turn.toolCalls) {
          for (const tc of turn.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.args
            });
          }
        }
        messages.push({ role: 'assistant', content });
      } else if (turn.role === 'tool') {
        if (turn.toolResults) {
          const content: any[] = [];
          for (const tr of turn.toolResults) {
            content.push({
              type: 'tool_result',
              tool_use_id: tr.callId,
              content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
            });
          }
          messages.push({ role: 'user', content });
        }
      }
    }

    return { messages, system: systemInstruction || undefined };
  }

  private convertTools(tools: ToolDefinition[]): any[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
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
