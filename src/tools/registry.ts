import type { OrbitTool } from './types.js';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import { readFileTool, writeFileTool, editFileTool } from './fsTools.js';
import { listDirectoryTool, fileSearchTool, grepSearchTool, projectTreeTool } from './searchTools.js';
import { runCommandTool } from './bashTool.js';
import { gitStatusTool, gitDiffTool } from './gitTools.js';
import { webSearchTool } from './webSearchTool.js';

export class ToolRegistry {
  private tools: Map<string, OrbitTool> = new Map();

  constructor() {
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    const builtins: OrbitTool[] = [
      readFileTool,
      writeFileTool,
      editFileTool,
      listDirectoryTool,
      fileSearchTool,
      grepSearchTool,
      projectTreeTool,
      runCommandTool,
      gitStatusTool,
      gitDiffTool,
      webSearchTool
    ];

    for (const tool of builtins) {
      this.tools.set(tool.definition.name, tool);
    }
  }

  public registerTool(tool: OrbitTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  public registerTools(tools: OrbitTool[]): void {
    for (const tool of tools) {
      this.tools.set(tool.definition.name, tool);
    }
  }

  public getTool(name: string): OrbitTool | undefined {
    return this.tools.get(name);
  }

  public getDefinitions(planMode = false): ToolDefinition[] {
    const defs: ToolDefinition[] = [];

    for (const tool of this.tools.values()) {
      if (planMode && !tool.definition.readOnly) {
        // In plan mode, exclude modification tools to prevent the model from even hallucinating edits
        continue;
      }
      defs.push(tool.definition);
    }

    return defs;
  }

  public async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        success: false,
        output: `Error: Unknown tool "${name}". Available tools: ${Array.from(this.tools.keys()).join(', ')}`,
        error: 'Tool not found'
      };
    }

    if (context.planMode && !tool.definition.readOnly) {
      return {
        success: false,
        output: `Plan mode is active (read-only). Action "${name}" was blocked.`,
        error: 'Plan mode read-only restriction'
      };
    }

    try {
      return await tool.execute(args, context);
    } catch (err: any) {
      return {
        success: false,
        output: `Error executing tool "${name}": ${err.message}`,
        error: err.message
      };
    }
  }
}
