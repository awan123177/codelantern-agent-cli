import { GoogleGenAI, type Content, type Part, type FunctionDeclaration, Type } from '@google/genai';
import { MissingApiKeyError, RateLimitError, LanternProviderError, ModelNotFoundError } from './errors.js';
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

  private getClient(): GoogleGenAI {
    const key = this.getApiKey();
    if (!key) {
      throw new MissingApiKeyError('gemini', 'GEMINI_API_KEY');
    }
    return new GoogleGenAI({ apiKey: key });
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
    const startTime = Date.now();
    try {
      const client = this.getClient();
      const testModel = this.defaultModel;

      await client.models.countTokens({
        model: testModel,
        contents: 'test'
      });

      return {
        success: true,
        latencyMs: Date.now() - startTime,
        resolvedModel: testModel
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

    try {
      const client = this.getClient();
      const pagedList = await client.models.list();
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

    const client = this.getClient();
    const contents = this.convertHistoryToContents(params.history);
    const functionDeclarations = this.convertToolsToDeclarations(params.tools);

    const config: Record<string, unknown> = {
      systemInstruction: params.systemInstruction,
      temperature: params.temperature ?? (params.lowLatency ? 0.1 : 0.2)
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
        const responseStream = await client.models.generateContentStream({
          model: params.model,
          contents,
          config
        });

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
        if (msg.includes('API_KEY_INVALID') || msg.includes('401') || msg.includes('403')) {
          throw new LanternProviderError(`Authentication failed: ${msg}`, 401, this.id);
        }
        if (msg.includes('NOT_FOUND') || msg.includes('models/')) {
          throw new ModelNotFoundError(params.model, this.displayName);
        }

        const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
        const isTransient = msg.includes('503') || msg.includes('overloaded') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('socket hang up');

        if ((isRateLimit || isTransient) && attempts < maxAttempts) {
          const backoff = Math.min(1000 * Math.pow(1.5, attempts), 3000); // Capped small backoff (max 3s)
          if (params.callbacks.onStateChange) {
            params.callbacks.onStateChange(`retrying:${attempts}`);
          }
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }

        if (isRateLimit) {
          throw new RateLimitError(msg);
        }

        throw new LanternProviderError(`Gemini request failed: ${msg}`, undefined, this.id);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
