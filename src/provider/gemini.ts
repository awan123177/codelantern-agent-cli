import { GoogleGenAI, type Content, type Part, type FunctionDeclaration, Type } from '@google/genai';
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

export class GeminiProvider implements IProviderAdapter {
  public id = 'gemini';
  public name = 'gemini';
  public displayName = 'Google Gemini';
  public defaultModel = 'gemini-3.8-flash';

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

  private getClient(httpOptions?: { timeout?: number }): GoogleGenAI {
    const key = this.getApiKey();
    if (!key) {
      throw new MissingApiKeyError('gemini', 'GEMINI_API_KEY');
    }
    return new GoogleGenAI({
      apiKey: key,
      httpOptions: httpOptions || { timeout: 30000 }
    });
  }

  public getCapabilities(modelId: string): ModelCapabilities {
    const isPro = modelId.includes('pro');
    const isThinking = modelId.includes('thinking') || modelId.includes('2.0-flash-thinking');
    return {
      streaming: true,
      tools: true,
      images: true,
      reasoning: isThinking || isPro,
      contextWindow: isPro ? 2000000 : 1000000
    };
  }

  public async testConnection(): Promise<ProviderTestResult> {
    if (!this.isConfigured()) {
      return { success: false, latencyMs: 0, error: `Missing API key for ${this.displayName}` };
    }
    const startTime = Date.now();
    try {
      const client = this.getClient({ timeout: 10000 });
      const testModel = this.defaultModel;

      const abortController = new AbortController();
      const countPromise = client.models.countTokens({
        model: testModel,
        contents: 'test',
        config: {
          abortSignal: abortController.signal,
          httpOptions: { timeout: 10000 }
        }
      });

      await withTimeoutRace(
        countPromise,
        10000,
        `Connection check for ${this.displayName}`,
        abortController.signal,
        () => abortController.abort()
      );

      return {
        success: true,
        latencyMs: Date.now() - startTime,
        resolvedModel: testModel
      };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error: sanitizeSecrets(err.message || String(err))
      };
    }
  }

  public async listModels(refresh = false): Promise<ProviderModelInfo[]> {
    if (!refresh && this.cachedModels && this.cachedModels.length > 0) {
      return this.cachedModels;
    }

    try {
      const client = this.getClient({ timeout: 10000 });
      const abortController = new AbortController();
      const listPromise = client.models.list({
        config: {
          abortSignal: abortController.signal,
          httpOptions: { timeout: 10000 }
        }
      });

      const pagedList = await withTimeoutRace(
        listPromise,
        10000,
        `Model listing for ${this.displayName}`,
        abortController.signal,
        () => abortController.abort()
      );

      const models: ProviderModelInfo[] = [];

      for await (const m of pagedList) {
        const rawName = m.name || '';
        // Gemini model names are usually 'models/gemini-...'
        const modelId = rawName.startsWith('models/') ? rawName.slice(7) : rawName;

        // Filter to text/chat generative models
        if (!modelId.includes('gemini')) {
          continue;
        }

        const capabilities = this.getCapabilities(modelId);
        models.push({
          id: modelId,
          name: m.displayName || modelId,
          provider: this.id,
          description: m.description,
          contextWindow: capabilities.contextWindow,
          capabilities
        });
      }

      if (models.length > 0) {
        this.cachedModels = models;
        return models;
      }
    } catch {
      // If listing API is restricted or fails, fall back to known verified Gemini model catalog
    }

    // Fallback to verified catalog if discovery API call failed
    const verifiedModels = [
      'gemini-3.8-flash',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-flash',
      'gemini-1.5-pro'
    ];

    return verifiedModels.map(id => ({
      id,
      name: id,
      provider: this.id,
      capabilities: this.getCapabilities(id),
      contextWindow: id.includes('pro') ? 2000000 : 1000000
    }));
  }

  public async streamGenerate(params: ProviderStreamParams): Promise<ProviderStreamResult> {
    const overallStartTime = Date.now();
    const timing: TimingDiagnostics = {
      totalMs: 0,
      toolExecutionMs: {}
    };

    if (params.callbacks.onStateChange) {
      params.callbacks.onStateChange('resolving_credentials');
    }

    if (params.signal?.aborted) {
      throw params.signal.reason || new CancelledError();
    }

    const key = this.getApiKey();
    if (!key) {
      throw new MissingApiKeyError(this.id, 'GEMINI_API_KEY');
    }

    const contents = this.convertHistoryToContents(params.history);
    const functionDeclarations = this.convertToolsToDeclarations(params.tools);

    const timeoutMs = params.timeoutMs || 60000;
    const firstTokenTimeoutMs = params.firstTokenTimeoutMs || 30000;
    const connectTimeoutMs = Math.min(timeoutMs, 15000); // Bounded connection setup timeout

    const client = this.getClient({ timeout: connectTimeoutMs });

    const config: Record<string, unknown> = {
      systemInstruction: params.systemInstruction,
      temperature: params.temperature ?? (params.lowLatency ? 0.1 : 0.2),
      httpOptions: { timeout: connectTimeoutMs }
    };

    if (params.maxOutputTokens) {
      config.maxOutputTokens = params.maxOutputTokens;
    }

    const toolList: Array<Record<string, unknown>> = [];
    if (functionDeclarations.length > 0) {
      toolList.push({ functionDeclarations });
    }
    if (params.enableSearchGrounding) {
      toolList.push({ googleSearch: {} });
    }
    if (toolList.length > 0) {
      config.tools = toolList;
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
      config.abortSignal = controller.signal;

      try {
        // Bounded connection establishment with reliable provider-level timeout
        const connectionPromise = client.models.generateContentStream({
          model: params.model,
          contents,
          config
        });

        const responseStream = await withTimeoutRace(
          connectionPromise,
          connectTimeoutMs,
          `Connection to ${this.displayName} (${params.model})`,
          controller.signal,
          () => controller.abort(new TimeoutError(connectTimeoutMs, `Connection to ${this.displayName} (${params.model})`))
        );

        timing.connectMs = Date.now() - connectStart;

        if (params.callbacks.onStateChange) {
          params.callbacks.onStateChange('waiting_first_token');
        }

        let fullText = '';
        const collectedToolCalls: ToolCallItem[] = [];
        const usage: TokenUsage = {
          promptTokens: 0,
          candidatesTokens: 0,
          totalTokens: 0
        };

        const wrappedStream = wrapStreamWithFirstTokenTimeout(
          responseStream,
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
          if (controller.signal.aborted) {
            throw controller.signal.reason || new CancelledError();
          }

          if (chunk.text) {
            fullText += chunk.text;
            if (params.callbacks.onChunk) {
              params.callbacks.onChunk(chunk.text);
            }
          }

          if (chunk.functionCalls && chunk.functionCalls.length > 0) {
            for (const fc of chunk.functionCalls) {
              collectedToolCalls.push({
                id: fc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                name: fc.name || '',
                args: (fc.args as Record<string, unknown>) || {}
              });
            }
            if (params.callbacks.onStateChange) {
              params.callbacks.onStateChange('streaming');
            }
          }

          if (chunk.usageMetadata) {
            usage.promptTokens = chunk.usageMetadata.promptTokenCount ?? usage.promptTokens;
            usage.candidatesTokens = chunk.usageMetadata.candidatesTokenCount ?? usage.candidatesTokens;
            usage.totalTokens = chunk.usageMetadata.totalTokenCount ?? usage.totalTokens;
            if (params.callbacks.onUsage) {
              params.callbacks.onUsage(usage);
            }
          }
        }

        timing.streamMs = Date.now() - streamStart;
        timing.totalMs = Date.now() - overallStartTime;

        if (params.callbacks.onToolCalls && collectedToolCalls.length > 0) {
          params.callbacks.onToolCalls(collectedToolCalls);
        }

        cleanup();

        // Handle empty text chunks or function-call-only responses gracefully
        if (!fullText && collectedToolCalls.length === 0) {
          fullText = `[Received empty response from ${this.displayName} (${params.model})]`;
        }

        return {
          text: fullText,
          toolCalls: collectedToolCalls,
          usage,
          timing
        };
      } catch (err: any) {
        cleanup();
        lastError = err;

        if (params.signal?.aborted || err instanceof CancelledError) {
          throw err instanceof CancelledError ? err : (params.signal?.reason || new CancelledError());
        }

        if (err instanceof TimeoutError || err instanceof FirstTokenTimeoutError) {
          throw err;
        }

        const msg = String(err?.message || err);

        if (
          msg.includes('API_KEY_INVALID') ||
          msg.includes('API key not valid') ||
          msg.includes('401') ||
          msg.includes('403') ||
          msg.includes('PERMISSION_DENIED')
        ) {
          throw new AuthenticationError(`Authentication failed for ${this.displayName}: Invalid or restricted API key. Please run 'lantern keys set ${this.id}' or verify GEMINI_API_KEY.`);
        }

        if (
          msg.includes('NOT_FOUND') ||
          msg.includes('not found') ||
          msg.includes('is not supported') ||
          msg.includes('models/')
        ) {
          throw new ModelNotFoundError(params.model, this.displayName);
        }

        const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota');
        const isTransient =
          msg.includes('503') ||
          msg.includes('500') ||
          msg.includes('overloaded') ||
          msg.includes('ECONNRESET') ||
          msg.includes('ETIMEDOUT') ||
          msg.includes('socket hang up') ||
          msg.includes('fetch failed');

        if ((isRateLimit || isTransient) && attempts < maxAttempts && !params.signal?.aborted) {
          const backoff = Math.min(1000 * Math.pow(1.5, attempts), 3000);
          if (params.callbacks.onStateChange) {
            params.callbacks.onStateChange(`retrying:${attempts}`);
          }
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }

        if (isRateLimit) {
          throw new RateLimitError(`Rate limit or quota reached for ${this.displayName}. Please wait a few seconds before retrying.`);
        }

        throw new LanternProviderError(`Gemini request failed: ${sanitizeSecrets(msg)}`, undefined, this.id);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(sanitizeSecrets(String(lastError)));
  }

  private convertHistoryToContents(turns: ConversationTurn[]): Content[] {
    const contents: Content[] = [];

    for (const turn of turns) {
      const parts: Part[] = [];

      if (turn.role === 'user') {
        if (turn.text) {
          parts.push({ text: turn.text });
        }

        if (turn.attachments && turn.attachments.length > 0) {
          for (const att of turn.attachments) {
            if (att.base64Data && att.mimeType) {
              parts.push({
                inlineData: {
                  mimeType: att.mimeType,
                  data: att.base64Data
                }
              });
            } else if (att.textContent) {
              parts.push({
                text: `[Attached File: ${att.name}]\n\`\`\`\n${att.textContent}\n\`\`\``
              });
            }
          }
        }

        if (parts.length > 0) {
          contents.push({ role: 'user', parts });
        }
      } else if (turn.role === 'model') {
        if (turn.text) {
          parts.push({ text: turn.text });
        }

        if (turn.toolCalls && turn.toolCalls.length > 0) {
          for (const tc of turn.toolCalls) {
            parts.push({
              functionCall: {
                id: tc.id,
                name: tc.name,
                args: tc.args
              }
            });
          }
        }

        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }
      } else if (turn.role === 'tool') {
        if (turn.toolResults && turn.toolResults.length > 0) {
          for (const res of turn.toolResults) {
            parts.push({
              functionResponse: {
                id: res.callId,
                name: res.name,
                response: {
                  result: res.error ? { error: res.error } : res.result
                }
              }
            });
          }
        }

        if (parts.length > 0) {
          contents.push({ role: 'tool', parts });
        }
      }
    }

    return contents;
  }

  private convertToolsToDeclarations(tools: ToolDefinition[]): FunctionDeclaration[] {
    return tools.map(tool => {
      const properties: Record<string, any> = {};

      for (const [propName, propDef] of Object.entries(tool.parameters.properties)) {
        let typeVal = Type.STRING;
        switch (propDef.type) {
          case 'number':
          case 'integer':
            typeVal = Type.NUMBER;
            break;
          case 'boolean':
            typeVal = Type.BOOLEAN;
            break;
          case 'array':
            typeVal = Type.ARRAY;
            break;
          case 'object':
            typeVal = Type.OBJECT;
            break;
          default:
            typeVal = Type.STRING;
        }

        properties[propName] = {
          type: typeVal,
          description: propDef.description,
          ...(propDef.enum ? { enum: propDef.enum } : {}),
          ...(propDef.items ? { items: { type: Type.STRING } } : {})
        };
      }

      return {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: Type.OBJECT,
          properties,
          required: tool.parameters.required || []
        }
      };
    });
  }
}
