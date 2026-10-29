import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../types.js';

export interface OrbitTool {
  definition: ToolDefinition;
  execute: (args: Record<string, any>, context: ToolExecutionContext) => Promise<ToolExecutionResult>;
}
