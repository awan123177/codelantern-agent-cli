import path from 'node:path';
import pc from 'picocolors';
import { ProviderRegistry } from '../provider/registry.js';
import { ToolRegistry } from '../tools/registry.js';
import { McpManager } from '../mcp/mcpManager.js';
import { ApprovalEngine } from '../approval/approver.js';
import { loadProjectInstructions } from '../config/projectInstructions.js';
import { saveSession } from '../session/sessionManager.js';
import { shouldCompact, compactTurns } from '../session/compactor.js';
import { SkillManager } from '../skills/skillManager.js';
import { TerminalSpinner } from '../ui/spinner.js';
import { sanitizeSecrets } from '../security/secrets.js';
import { EmptyResponseError } from '../provider/errors.js';
import type {
  OrbitSession,
  AgentContext,
  ConversationTurn,
  ToolCallItem,
  ToolResultItem,
  TokenUsage,
  FileAttachment,
  TimingDiagnostics,
  Skill
} from '../types.js';

export class LanternAgent {
  private providerRegistry: ProviderRegistry;
  private tools: ToolRegistry;
  private mcpManager: McpManager;
  private skillManager: SkillManager;
  private approvalEngine: ApprovalEngine;
  private spinner: TerminalSpinner;

  constructor() {
    this.providerRegistry = new ProviderRegistry();
    this.tools = new ToolRegistry();
    this.mcpManager = new McpManager();
    this.skillManager = new SkillManager();
    this.approvalEngine = new ApprovalEngine({});
    this.spinner = new TerminalSpinner();
  }

  public getProviderRegistry(): ProviderRegistry {
    return this.providerRegistry;
  }

  public getSkillManager(): SkillManager {
    return this.skillManager;
  }

  public async initMcp(): Promise<void> {
    try {
      const mcpTools = await this.mcpManager.initialize();
      this.tools.registerTools(mcpTools);
    } catch {
      // MCP failure should not crash agent
    }
  }

  public async shutdown(): Promise<void> {
    await this.mcpManager.closeAll();
  }

  public buildSystemPrompt(workspace: string, planMode = false, activeSkills: Skill[] = []): string {
    const projectInstructions = loadProjectInstructions(workspace);

    const basePrompt = [
      'You are Code Lantern, an elite AI coding assistant operating directly in the terminal.',
      `Current Workspace: ${path.resolve(workspace)}`,
      `Environment OS: ${process.platform} (${process.arch})`,
      '',
      'CORE OPERATING PRINCIPLES:',
      '1. Be direct, pragmatic, and helpful. Prioritize working, robust code over verbosity.',
      '2. Inspect files before proposing edits to understand real project conventions and existing code.',
      '3. Always use the provided tools to read, search, edit, create files, or run commands.',
      '4. When editing files with edit_file, ensure the target string matches exactly, including indentation.',
      '5. Safety boundaries: Never attempt to read secret files (.env, keys) or escape the workspace.',
      '6. Never run destructive commands that wipe unrelated data, partitions, or system drives.',
      '7. Never push code, make commits, or publish artifacts unless explicitly instructed by the user.'
    ];

    if (planMode) {
      basePrompt.push(
        '',
        'PLAN MODE IS ACTIVE (READ-ONLY):',
        '- Your objective is to thoroughly inspect the codebase and produce a detailed, actionable implementation plan.',
        '- You may inspect files and search code using read_file, file_search, grep_search, and project_tree.',
        '- Do NOT attempt to write files, edit files, or run mutating commands.',
        '- Structure your plan clearly: Overview, Architecture & Files Impacted, Step-by-Step Implementation, and Verification Strategy.'
      );
    }

    if (projectInstructions.found && projectInstructions.content) {
      basePrompt.push(
        '',
        `PROJECT INSTRUCTIONS (${path.basename(projectInstructions.filePath || 'instructions')}):`,
        '---',
        projectInstructions.content,
        '---'
      );
    }

    // Inject active skills as reference instructions
    if (activeSkills.length > 0) {
      basePrompt.push('', 'ACTIVE SKILLS & GUIDELINES:');
      for (const skill of activeSkills) {
        basePrompt.push(
          `### Skill: ${skill.name}`,
          `Description: ${skill.description}`,
          'Instructions:',
          skill.content,
          '---'
        );
      }
    }

    return basePrompt.join('\n');
  }

  public async runTurn(
    session: OrbitSession,
    userPrompt: string,
    context: AgentContext,
    attachments: FileAttachment[] = []
  ): Promise<{
    reply: string;
    toolCount: number;
    usage: TokenUsage;
    timing: TimingDiagnostics;
  }> {
    const turnStartTime = Date.now();
    this.approvalEngine = new ApprovalEngine({
      yolo: context.yolo,
      planMode: context.planMode
    });

    // 1. Resolve active skills
    let activeSkills: Skill[] = [];

    if (context.noSkills) {
      activeSkills = [];
    } else if (context.activeSkills && context.activeSkills.length > 0) {
      // User explicitly selected skills with --skill or in-session /skills
      activeSkills = context.activeSkills
        .map(name => this.skillManager.getSkill(name, context.workspace))
        .filter((s): s is Skill => s !== null && s.enabled);
    } else {
      // Normal request: automatically select only a small number of relevant skills (max 2)
      activeSkills = this.skillManager.matchSkillsForPrompt(userPrompt, context.workspace);
    }

    if (activeSkills.length > 0 && !context.jsonOutput) {
      const names = activeSkills.map(s => pc.yellow(s.name)).join(', ');
      console.log(pc.dim(`💡 Active Skills: ${names}`));
    }

    session.activeSkills = activeSkills.map(s => s.name);

    // 2. Select Provider
    const provider = this.providerRegistry.getProvider(context.provider);
    session.provider = provider.id;
    session.model = context.model;

    const systemPrompt = this.buildSystemPrompt(context.workspace, context.planMode, activeSkills);
    const activeTools = this.tools.getDefinitions(context.planMode);

    // Append user turn
    const userTurn: ConversationTurn = {
      role: 'user',
      text: userPrompt,
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp: new Date().toISOString()
    };
    session.turns.push(userTurn);

    let step = 0;
    const maxSteps = context.maxSteps || 25;
    let totalToolsExecuted = 0;
    let finalAssistantText = '';

    const sessionUsage: TokenUsage = {
      promptTokens: 0,
      candidatesTokens: 0,
      totalTokens: 0
    };

    const aggregatedTiming: TimingDiagnostics = {
      totalMs: 0,
      toolExecutionMs: {}
    };

    while (step < maxSteps) {
      step++;

      // Check for user cancellation (Ctrl+C)
      if (context.signal?.aborted) {
        this.spinner.stop();
        throw context.signal.reason || new Error('Operation cancelled by user.');
      }

      this.spinner.start(`Connecting to ${provider.displayName} (${context.model})...`);

      let currentStepText = '';
      let currentToolCalls: ToolCallItem[] = [];

      try {
        const streamResult = await provider.streamGenerate({
          model: context.model,
          systemInstruction: systemPrompt,
          history: session.turns,
          tools: activeTools,
          signal: context.signal,
          temperature: 0.2,
          timeoutMs: context.timeoutMs,
          connectTimeoutMs: context.connectTimeoutMs,
          firstTokenTimeoutMs: context.firstTokenTimeoutMs,
          lowLatency: context.lowLatency,
          callbacks: {
            onStateChange: (state: string) => {
              if (state === 'resolving_credentials') {
                this.spinner.resolvingCredentials(provider.displayName);
              } else if (state === 'connecting') {
                this.spinner.connecting(provider.displayName, context.model);
              } else if (state === 'waiting_first_token') {
                this.spinner.waitingFirstToken(provider.displayName, context.model);
              } else if (state.startsWith('retrying:')) {
                const attempt = state.split(':')[1];
                this.spinner.retrying(parseInt(attempt, 10), 3, 1500);
              } else if (state === 'streaming' || state === 'receiving') {
                this.spinner.stop();
              }
            },
            onChunk: (chunk: string) => {
              this.spinner.stop();
              currentStepText += chunk;
              if (!context.jsonOutput) {
                process.stdout.write(chunk);
              }
            },
            onToolCalls: (calls: ToolCallItem[]) => {
              this.spinner.stop();
              currentToolCalls = calls;
            },
            onUsage: (usage: TokenUsage) => {
              sessionUsage.promptTokens = usage.promptTokens;
              sessionUsage.candidatesTokens = usage.candidatesTokens;
              sessionUsage.totalTokens = usage.totalTokens;
            }
          }
        });

        this.spinner.stop();

        // Update timing metrics
        if (streamResult.timing) {
          aggregatedTiming.providerInitMs = streamResult.timing.providerInitMs;
          aggregatedTiming.connectMs = streamResult.timing.connectMs;
          aggregatedTiming.ttftMs = streamResult.timing.ttftMs;
          aggregatedTiming.streamMs = streamResult.timing.streamMs;
        }

        if (currentStepText) {
          if (!currentStepText.endsWith('\n')) {
            console.log('');
          }
          finalAssistantText = currentStepText;
        }

        // If no tool calls requested, model turn complete
        if (!streamResult.toolCalls || streamResult.toolCalls.length === 0) {
          session.turns.push({
            role: 'model',
            text: currentStepText,
            timestamp: new Date().toISOString()
          });
          break;
        }

        // Record model turn containing tool calls
        session.turns.push({
          role: 'model',
          text: currentStepText || undefined,
          toolCalls: streamResult.toolCalls,
          timestamp: new Date().toISOString()
        });

        // Execute each tool call with real-time feedback
        const toolResults: ToolResultItem[] = [];

        for (const call of streamResult.toolCalls) {
          // Check cancellation between tool calls
          if (context.signal?.aborted) {
            throw context.signal.reason || new Error('Cancelled by user.');
          }

          totalToolsExecuted++;
          const callSummary = `${call.name}(${Object.keys(call.args).map(k => `${k}: ${JSON.stringify(call.args[k])}`).join(', ')})`;

          if (!context.jsonOutput) {
            console.log(pc.cyan(`\n🛠️  Tool: ${pc.bold(call.name)}`) + pc.dim(` ${callSummary.slice(0, 90)}`));
          }

          this.spinner.toolExecuting(call.name);

          const toolContext = {
            workspace: context.workspace,
            yolo: this.approvalEngine.isYolo(),
            planMode: context.planMode,
            signal: context.signal,
            requestApproval: (req: any) => {
              this.spinner.stop();
              return this.approvalEngine.requestApproval(req);
            }
          };

          const toolStart = Date.now();
          const executionResult = await this.tools.executeTool(call.name, call.args, toolContext);
          const toolDuration = Date.now() - toolStart;
          aggregatedTiming.toolExecutionMs[call.name] = (aggregatedTiming.toolExecutionMs[call.name] || 0) + toolDuration;

          this.spinner.stop();

          // Context Efficiency: Cap huge outputs (e.g. > 15KB) before storing into conversation history
          let trimmedOutput = executionResult.output;
          if (trimmedOutput.length > 15000) {
            trimmedOutput = trimmedOutput.slice(0, 15000) + '\n\n... [Output truncated to 15KB for context efficiency]';
          }

          if (executionResult.success) {
            if (!context.jsonOutput) {
              const preview = executionResult.output.length > 180
                ? executionResult.output.slice(0, 180) + '...'
                : executionResult.output;
              console.log(pc.green(`✓ Result:`) + pc.dim(` ${preview.replace(/\n/g, ' ')} (${toolDuration}ms)`));
            }
            toolResults.push({
              callId: call.id,
              name: call.name,
              result: sanitizeSecrets(trimmedOutput)
            });
          } else {
            if (!context.jsonOutput) {
              console.log(pc.red(`✗ Error: ${executionResult.error || executionResult.output}`));
            }
            toolResults.push({
              callId: call.id,
              name: call.name,
              result: { error: executionResult.error || executionResult.output },
              error: executionResult.error
            });
          }
        }

        // Append tool results turn
        session.turns.push({
          role: 'tool',
          toolResults,
          timestamp: new Date().toISOString()
        });

        // Step limit check
        if (step >= maxSteps) {
          const limitMsg = `\n[Reached maximum configured tool steps (${maxSteps}). Code Lantern paused to avoid infinite loops.]`;
          console.log(pc.yellow(limitMsg));
          finalAssistantText += limitMsg;
          break;
        }
      } catch (err: any) {
        this.spinner.stop();
        throw err;
      }
    }

    if (!finalAssistantText.trim() && totalToolsExecuted === 0) {
      throw new EmptyResponseError(provider.displayName, context.model);
    }

    // Auto-compact if session turns exceed threshold
    if (shouldCompact(session.turns)) {
      session.turns = compactTurns(session.turns);
    }

    aggregatedTiming.totalMs = Date.now() - turnStartTime;

    // Update session metrics
    session.totalUsage.promptTokens += sessionUsage.promptTokens;
    session.totalUsage.candidatesTokens += sessionUsage.candidatesTokens;
    session.totalUsage.totalTokens += sessionUsage.totalTokens;
    saveSession(session);

    return {
      reply: finalAssistantText,
      toolCount: totalToolsExecuted,
      usage: sessionUsage,
      timing: aggregatedTiming
    };
  }
}

// Backwards-compatibility alias
export { LanternAgent as OrbitAgent };
