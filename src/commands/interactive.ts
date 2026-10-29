import pc from 'picocolors';
import { LanternAgent } from '../agent/lanternAgent.js';
import { createNewSession, loadSession, saveSession } from '../session/sessionManager.js';
import { loadConfig } from '../config/config.js';
import { loadAttachments } from '../provider/attachment.js';
import { TerminalPrompt } from '../ui/prompt.js';
import { printBanner } from '../ui/banner.js';
import { handleSlashCommand } from '../ui/slashCommands.js';
import { formatErrorMessage, CancelledError } from '../provider/errors.js';
import type { OrbitSession, AgentContext } from '../types.js';

export async function interactiveCommand(options: {
  provider?: string;
  model?: string;
  cwd?: string;
  session?: string;
  attach?: string[];
  yolo?: boolean;
  plan?: boolean;
  timing?: boolean;
  fast?: boolean;
  timeout?: number;
  firstTokenTimeout?: number;
  skill?: string[];
}): Promise<void> {
  const config = loadConfig();
  const workspace = options.cwd || process.cwd();
  let provider = options.provider || config.activeProvider || 'gemini';
  let model = options.model || config.defaultModel || 'gemini-3.8-flash';
  let yolo = Boolean(options.yolo ?? config.yolo);
  let planMode = Boolean(options.plan);
  let showTiming = Boolean(options.timing ?? config.showTiming);
  let lowLatency = Boolean(options.fast ?? config.lowLatency);
  let activeSkills = options.skill || config.activeSkills || [];

  let session: OrbitSession;
  if (options.session) {
    const loaded = loadSession(options.session);
    if (!loaded) {
      console.error(pc.red(`Error: Session '${options.session}' not found.`));
      process.exit(1);
    }
    session = loaded;
    if (session.provider) provider = session.provider;
    if (session.model) model = session.model;
    if (session.activeSkills) activeSkills = session.activeSkills;
    console.log(pc.green(`✓ Resumed session: ${session.id} (${session.turns.length} turns)`));
  } else {
    session = createNewSession(workspace, model);
    session.provider = provider;
  }

  const attachments = loadAttachments(options.attach);

  printBanner({
    version: '1.0.1',
    provider,
    model,
    workspace,
    yolo,
    planMode
  });

  if (attachments.length > 0) {
    console.log(pc.cyan(`📎 Attached ${attachments.length} file(s): ${attachments.map(a => a.name).join(', ')}\n`));
  }

  const agent = new LanternAgent();
  await agent.initMcp();

  const promptUI = new TerminalPrompt();

  const slashContext = {
    session,
    provider,
    model,
    workspace,
    yolo,
    planMode,
    showTiming,
    activeSkills,
    setProvider: (p: string) => {
      provider = p;
      session.provider = p;
      slashContext.provider = p;
    },
    setModel: (m: string) => {
      model = m;
      session.model = m;
      slashContext.model = m;
    },
    setYolo: (y: boolean) => {
      yolo = y;
      slashContext.yolo = y;
    },
    setPlanMode: (p: boolean) => {
      planMode = p;
      slashContext.planMode = p;
    },
    setShowTiming: (t: boolean) => {
      showTiming = t;
      slashContext.showTiming = t;
    },
    setActiveSkills: (skills: string[]) => {
      activeSkills = skills;
      session.activeSkills = skills;
      slashContext.activeSkills = skills;
    },
    askQuestion: (q: string) => promptUI.askQuestion(q)
  };

  try {
    while (true) {
      const provIndicator = pc.cyan(`(${provider})`);
      const modeIndicator = planMode ? pc.blue(' [plan]') : yolo ? pc.red(' [yolo]') : '';
      const promptStr = `${pc.yellow('lantern')} ${provIndicator}${modeIndicator} ${pc.dim('❯')} `;

      const input = await promptUI.askPrompt(promptStr);

      if (input === null || input === '/exit' || input === '/quit') {
        console.log(pc.dim('\nGoodbye! Session saved: ' + session.id));
        break;
      }

      const trimmed = input.trim();
      if (!trimmed) {
        continue;
      }

      // Check slash commands
      if (trimmed.startsWith('/')) {
        const shouldContinue = await handleSlashCommand(trimmed, slashContext);
        if (!shouldContinue) {
          console.log(pc.dim('Session saved. Exiting Code Lantern.'));
          break;
        }
        continue;
      }

      // Prepare cancellation controller for in-flight turn
      const abortController = new AbortController();
      const onSigInt = () => {
        abortController.abort(new CancelledError('Request cancelled by user (Ctrl+C).'));
      };
      process.on('SIGINT', onSigInt);

      const context: AgentContext = {
        workspace,
        provider,
        model,
        yolo,
        planMode,
        jsonOutput: false,
        maxSteps: config.maxSteps || 25,
        timeoutMs: options.timeout || config.timeoutMs || 60000,
        firstTokenTimeoutMs: options.firstTokenTimeout || config.firstTokenTimeoutMs || 30000,
        showTiming,
        lowLatency,
        activeSkills,
        attachments,
        signal: abortController.signal
      };

      try {
        console.log('');
        const result = await agent.runTurn(session, trimmed, context, attachments);

        // Display usage & timing diagnostics
        const parts: string[] = [];
        if (result.usage.totalTokens > 0) {
          parts.push(`Tokens: ${result.usage.totalTokens.toLocaleString()}`);
        }
        if (showTiming && result.timing) {
          const ttft = result.timing.ttftMs ? `TTFT: ${result.timing.ttftMs}ms` : '';
          const total = `Total: ${(result.timing.totalMs / 1000).toFixed(2)}s`;
          parts.push(`[${[provider, model, ttft, total].filter(Boolean).join(' | ')}]`);
        }

        if (parts.length > 0) {
          console.log(pc.dim(`\n[${parts.join(' | ')}]`));
        }
        console.log('');
      } catch (err: any) {
        if (err instanceof CancelledError || abortController.signal.aborted) {
          console.log(pc.yellow('\n[Cancelled by user]'));
        } else {
          console.error('\n' + formatErrorMessage(err) + '\n');
        }
      } finally {
        process.removeListener('SIGINT', onSigInt);
      }
    }
  } finally {
    saveSession(session);
    await agent.shutdown();
  }
}
