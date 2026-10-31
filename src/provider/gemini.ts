import { GoogleGenAI, type Content, type Part, type FunctionDeclaration, Type } from '@google/genai';
import {
  MissingApiKeyError,
  RateLimitError,
  LanternProviderError,
  ModelNotFoundError,
  AuthenticationError,
  TimeoutError,
  ConnectionTimeoutError,
  TotalTimeoutError,
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

export const VERIFIED_GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.8-pro',
  'gemini-3.8-flash-tts',
  'gemini-3.1-flash',
  'gemini-3.1-pro'
];

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
      const generatePromise = client.models.generateContent({
        model: testModel,
        contents: 'Reply only with OK.',
        config: {
          maxOutputTokens: 5,
          abortSignal: abortController.signal,
          httpOptions: { timeout: 10000 }
        }
      });

      await withTimeoutRace(
        generatePromise,
        10000,
        `Generation test for ${this.displayName} (${testModel})`,
        abortController.signal,
        () => abortController.abort(),
        (t) => new ConnectionTimeoutError(t, this.displayName, testModel)
      );

      return {
        success: true,
        latencyMs: Date.now() - startTime,
        resolvedModel: testModel
      };
    } catch (err: any) {
      const msg = String(err?.message || err);
      let formattedError = sanitizeSecrets(msg);
      if (
        msg.includes('NOT_FOUND') ||
        msg.includes('not found') ||
        msg.includes('is not supported') ||
        msg.includes('404')
      ) {
        formattedError = `Model '${this.defaultModel}' not found or unsupported by ${this.displayName}. Available verified models: ${VERIFIED_GEMINI_MODELS.join(', ')}`;
      } else if (
        msg.includes('API_KEY_INVALID') ||
        msg.includes('API key not valid') ||
        msg.includes('401') ||
        msg.includes('403') ||
        msg.includes('PERMISSION_DENIED')
      ) {
        formattedError = `Authentication failed: Invalid or restricted API key for ${this.displayName}.`;
      }
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error: formattedError
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
    return VERIFIED_GEMINI_MODELS.map(id => ({
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
    const connectTimeoutMs = params.connectTimeoutMs ?? (params.timeoutMs ? Math.min(params.timeoutMs, 15000) : 15000);

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

      const { controller, cleanup } = createLinkedAbortController(params.signal, timeoutMs, t => new TotalTimeoutError(t, this.displayName, params.model));
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
          () => controller.abort(new ConnectionTimeoutError(connectTimeoutMs, this.displayName, params.model)),
          (t) => new ConnectionTimeoutError(t, this.displayName, params.model)
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

        if (err instanceof TotalTimeoutError) {
          throw err;
        }

        const msg = String(err?.message || err);

        if (
          msg.includes('NOT_FOUND') ||
          msg.includes('not found') ||
          msg.includes('is not supported') ||
          msg.includes('404')
        ) {
          throw new ModelNotFoundError(params.model, this.displayName, VERIFIED_GEMINI_MODELS);
        }

        // Diagnostic probe: If connection or first token timed out or streaming failed, probe with minimal non-streaming call
        if (
          (err instanceof ConnectionTimeoutError ||
            err instanceof FirstTokenTimeoutError ||
            err instanceof TimeoutError ||
            msg.includes('fetch failed')) &&
          !params.signal?.aborted
        ) {
          try {
            const probeController = new AbortController();
            const probePromise = client.models.generateContent({
              model: params.model,
              contents: 'Hi',
              config: {
                maxOutputTokens: 2,
                abortSignal: probeController.signal,
                httpOptions: { timeout: 4000 }
              }
            });
            const probeRes = await withTimeoutRace(
              probePromise,
              4000,
              `Diagnostic probe for ${params.model}`,
              probeController.signal,
              () => probeController.abort(),
              (t) => new ConnectionTimeoutError(t, this.displayName, params.model)
            );

            // If probe succeeded, model is valid but streaming failed; attempt fallback non-streaming generation
            if (probeRes) {
              try {
                const fallbackRes = await client.models.generateContent({
                  model: params.model,
                  contents,
                  config: {
                    ...config,
                    httpOptions: { timeout: Math.min(timeoutMs, 30000) }
                  }
                });
                const fallbackText = fallbackRes.text || '';
                if (params.callbacks.onChunk && fallbackText) {
                  params.callbacks.onChunk(fallbackText);
                }
                timing.connectMs = Date.now() - connectStart;
                timing.streamMs = 0;
                timing.totalMs = Date.now() - overallStartTime;
                return {
                  text: fallbackText,
                  toolCalls: [],
                  usage: {
                    promptTokens: fallbackRes.usageMetadata?.promptTokenCount ?? 0,
                    candidatesTokens: fallbackRes.usageMetadata?.candidatesTokenCount ?? 0,
                    totalTokens: fallbackRes.usageMetadata?.totalTokenCount ?? 0
                  },
                  timing
                };
              } catch {
                // Fallback attempt failed, proceed to handle original error
              }
            }
          } catch (probeErr: any) {
            const probeMsg = String(probeErr?.message || probeErr);
            if (
              probeMsg.includes('NOT_FOUND') ||
              probeMsg.includes('not found') ||
              probeMsg.includes('is not supported') ||
              probeMsg.includes('404') ||
              probeMsg.includes('models/')
            ) {
              throw new ModelNotFoundError(params.model, this.displayName, VERIFIED_GEMINI_MODELS);
            }
            if (
              probeMsg.includes('API_KEY_INVALID') ||
              probeMsg.includes('API key not valid') ||
              probeMsg.includes('401') ||
              probeMsg.includes('403') ||
              probeMsg.includes('PERMISSION_DENIED')
            ) {
              throw new AuthenticationError(`Authentication failed for ${this.displayName}: Invalid or restricted API key. Please run 'lantern keys set ${this.id}' or verify GEMINI_API_KEY.`);
            }
            if (probeMsg.includes('429') || probeMsg.includes('RESOURCE_EXHAUSTED') || probeMsg.includes('quota')) {
              throw new RateLimitError(`Rate limit or quota reached for ${this.displayName}. Please wait a few seconds before retrying.`);
            }
          }
        }

        if (err instanceof ConnectionTimeoutError || err instanceof FirstTokenTimeoutError || err instanceof TimeoutError) {
          throw err;
        }

        if (
          msg.includes('API_KEY_INVALID') ||
          msg.includes('API key not valid') ||
          msg.includes('401') ||
          msg.includes('403') ||
          msg.includes('PERMISSION_DENIED')
        ) {
          throw new AuthenticationError(`Authentication failed for ${this.displayName}: Invalid or restricted API key. Please run 'lantern keys set ${this.id}' or verify GEMINI_API_KEY.`);
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
