import pc from 'picocolors';
import { LanternAgent } from '../agent/lanternAgent.js';
import { createNewSession } from '../session/sessionManager.js';
import { loadConfig } from '../config/config.js';
import { loadAttachments } from '../provider/attachment.js';
import { formatErrorMessage, CancelledError } from '../provider/errors.js';
import type { AgentContext } from '../types.js';

export async function askCommand(
  question: string,
  options: {
    provider?: string;
    model?: string;
    cwd?: string;
    attach?: string[];
    yolo?: boolean;
    json?: boolean;
    maxSteps?: number;
    timeout?: number;
    firstTokenTimeout?: number;
    timing?: boolean;
    fast?: boolean;
    skill?: string[];
  }
): Promise<void> {
  const config = loadConfig();
  const workspace = options.cwd || process.cwd();
  const provider = options.provider || config.activeProvider || 'gemini';
  const model = options.model || config.defaultModel || 'gemini-3.8-flash';
  const yolo = Boolean(options.yolo ?? config.yolo);
  const jsonOutput = Boolean(options.json);
  const showTiming = Boolean(options.timing ?? config.showTiming);
  const lowLatency = Boolean(options.fast ?? config.lowLatency);

  const attachments = loadAttachments(options.attach);
  const session = createNewSession(workspace, model, `Ask: ${question.slice(0, 40)}`);
  session.provider = provider;

  const agent = new LanternAgent();
  await agent.initMcp();

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
    planMode: false,
    jsonOutput,
    maxSteps: options.maxSteps || config.maxSteps || 25,
    timeoutMs: options.timeout || config.timeoutMs || 60000,
    firstTokenTimeoutMs: options.firstTokenTimeout || config.firstTokenTimeoutMs || 30000,
    showTiming,
    lowLatency,
    activeSkills: options.skill || config.activeSkills || [],
    attachments,
    signal: abortController.signal
  };

  try {
    const result = await agent.runTurn(session, question, context, attachments);

    if (jsonOutput) {
      console.log(JSON.stringify({
        sessionId: session.id,
        provider,
        model,
        question,
        reply: result.reply,
        toolCount: result.toolCount,
        usage: result.usage,
        timing: result.timing
      }, null, 2));
    } else {
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
    }
  } catch (err: any) {
    if (jsonOutput) {
      console.error(JSON.stringify({ error: err.message }));
    } else if (err instanceof CancelledError || abortController.signal.aborted) {
      console.log(pc.yellow('\n[Cancelled by user]'));
    } else {
      console.error(formatErrorMessage(err));
    }
    process.exit(1);
  } finally {
    process.removeListener('SIGINT', onSigInt);
    await agent.shutdown();
  }
}
