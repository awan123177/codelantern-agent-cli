/**
 * Core type definitions for Code Lantern CLI
 */

export type ModelRole = 'user' | 'model' | 'tool' | 'system';

export interface FileAttachment {
  path: string;
  name: string;
  mimeType: string;
  size: number;
  base64Data?: string;
  textContent?: string;
}

export interface ToolCallItem {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultItem {
  callId: string;
  name: string;
  result: unknown;
  error?: string;
}

export interface ConversationTurn {
  role: ModelRole;
  text?: string;
  toolCalls?: ToolCallItem[];
  toolResults?: ToolResultItem[];
  attachments?: FileAttachment[];
  timestamp: string;
}

export interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
}

export interface OrbitSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspace: string;
  provider?: string;
  model: string;
  turns: ConversationTurn[];
  totalUsage: TokenUsage;
  activeSkills?: string[];
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

export type ProviderType = 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'custom';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}

export interface ModelCapabilities {
  streaming: boolean;
  tools: boolean;
  images: boolean;
  reasoning: boolean;
  contextWindow?: number;
}

export interface ProviderModelInfo {
  id: string;
  name: string;
  provider: string;
  description?: string;
  contextWindow?: number;
  capabilities: ModelCapabilities;
  pricing?: {
    promptPer1k?: number;
    completionPer1k?: number;
  };
}

export interface TimingDiagnostics {
  providerInitMs?: number;
  connectMs?: number;
  ttftMs?: number; // Time to First Token
  streamMs?: number;
  totalMs: number;
  toolExecutionMs: Record<string, number>;
}

export interface Skill {
  name: string;
  description: string;
  path: string;
  source: 'project' | 'user';
  enabled: boolean;
  content: string;
  references?: string[];
  tags?: string[];
}

export interface OrbitConfig {
  activeProvider: string;
  defaultModel: string;
  maxSteps: number;
  temperature: number;
  maxOutputTokens?: number;
  yolo: boolean;
  theme: 'default' | 'ocean' | 'minimal';
  autoCompactThreshold: number;
  mcpServers?: Record<string, McpServerConfig>;
  timeoutMs: number;
  firstTokenTimeoutMs: number;
  connectTimeoutMs?: number;
  showTiming: boolean;
  lowLatency: boolean;
  activeSkills: string[];
  disabledSkills?: string[];
  providers?: Record<string, ProviderConfig>;
}

export interface ApprovalRequest {
  type: 'file_edit' | 'file_write' | 'command';
  summary: string;
  details?: {
    path?: string;
    before?: string;
    after?: string;
    diff?: string;
    command?: string;
  };
}

export type ApprovalDecision = 'allow' | 'deny' | 'yolo_all';

export interface AgentContext {
  workspace: string;
  provider: string;
  model: string;
  yolo: boolean;
  planMode: boolean;
  jsonOutput: boolean;
  maxSteps: number;
  timeoutMs: number;
  firstTokenTimeoutMs: number;
  connectTimeoutMs?: number;
  showTiming: boolean;
  lowLatency: boolean;
  activeSkills?: string[];
  noSkills?: boolean;
  attachments?: FileAttachment[];
  signal?: AbortSignal;
  onStateChange?: (state: string) => void;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required?: string[];
  };
  readOnly?: boolean;
}

export interface ToolExecutionContext {
  workspace: string;
  yolo: boolean;
  planMode: boolean;
  requestApproval: (request: ApprovalRequest) => Promise<boolean>;
  signal?: AbortSignal;
}

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}
