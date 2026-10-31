import type {
  ConversationTurn,
  ToolDefinition,
  ToolCallItem,
  TokenUsage,
  ProviderModelInfo,
  ModelCapabilities,
  TimingDiagnostics
} from '../types.js';

export interface StreamCallbacks {
  onChunk?: (text: string) => void;
  onToolCalls?: (toolCalls: ToolCallItem[]) => void;
  onUsage?: (usage: TokenUsage) => void;
  onStateChange?: (state: string) => void;
}

export interface ProviderStreamParams {
  model: string;
  systemInstruction: string;
  history: ConversationTurn[];
  tools: ToolDefinition[];
  callbacks: StreamCallbacks;
  signal?: AbortSignal;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  firstTokenTimeoutMs?: number;
  connectTimeoutMs?: number;
  lowLatency?: boolean;
  enableSearchGrounding?: boolean;
}

export interface ProviderStreamResult {
  text: string;
  toolCalls: ToolCallItem[];
  usage: TokenUsage;
  timing: TimingDiagnostics;
}

export interface ProviderTestResult {
  success: boolean;
  latencyMs: number;
  error?: string;
  modelsCount?: number;
  resolvedModel?: string;
}

export interface IProviderAdapter {
  id: string;
  name: string;
  displayName: string;
  defaultModel: string;

  isConfigured(): boolean;
  getApiKey(): string | null;
  getMaskedKey(): string;

  streamGenerate(params: ProviderStreamParams): Promise<ProviderStreamResult>;
  listModels(refresh?: boolean): Promise<ProviderModelInfo[]>;
  testConnection(): Promise<ProviderTestResult>;
  getCapabilities(modelId: string): ModelCapabilities;
}
