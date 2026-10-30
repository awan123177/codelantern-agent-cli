import pc from 'picocolors';
import { LanternAgent } from '../agent/lanternAgent.js';
import { createNewSession } from '../session/sessionManager.js';
import { loadConfig } from '../config/config.js';
import { loadAttachments } from '../provider/attachment.js';
import { formatErrorMessage, CancelledError } from '../provider/errors.js';
import { getApiKey, setApiKey, maskApiKey, promptMaskedApiKey, getStoreName } from '../security/credentials.js';
import { ProviderRegistry } from '../provider/registry.js';
import type { AgentContext } from '../types.js';

export async function planCommand(
  task: string,
  options: {
    provider?: string;
    model?: string;
    cwd?: string;
    attach?: string[];
    json?: boolean;
    maxSteps?: number;
    timeout?: number;
    firstTokenTimeout?: number;
    timing?: boolean;
    skill?: string[];
  }
): Promise<void> {
  const config = loadConfig();
  const workspace = options.cwd || process.cwd();
  const provider = options.provider || config.activeProvider || 'gemini';
  const model = options.model || config.defaultModel || 'gemini-3.8-flash';
  const jsonOutput = Boolean(options.json);
  const showTiming = Boolean(options.timing ?? config.showTiming);

  const attachments = loadAttachments(options.attach);
  const session = createNewSession(workspace, model, `Plan: ${task.slice(0, 40)}`);
  session.provider = provider;

  const initialKeyInfo = getApiKey(provider);
  if (!initialKeyInfo.key && process.stdin.isTTY && !jsonOutput) {
    const p = new ProviderRegistry().getProvider(provider);
    console.log(pc.yellow(`\n🏮 No API key configured for ${p.displayName} (${provider}).`));
    console.log(pc.dim(`Lantern will securely store this key in your ${getStoreName()} so you only enter it once.\n`));
    const entered = await promptMaskedApiKey(`Enter API key for '${provider}'`);
    if (entered) {
      setApiKey(provider, entered);
      console.log(pc.green(`✓ Saved ${p.displayName} API key to ${getStoreName()} (${maskApiKey(entered)})\n`));
    }
  }

  if (!jsonOutput) {
    console.log(pc.bold(pc.yellow('\n🏮 Code Lantern Plan Mode (Read-Only)')));
    console.log(pc.dim(`Inspecting workspace with ${provider} (${model})...\n`));
  }

  const agent = new LanternAgent();
  await agent.initMcp();

  const abortController = new AbortController();
  const onSigInt = () => {
    abortController.abort(new CancelledError('Plan cancelled by user (Ctrl+C).'));
  };
  process.on('SIGINT', onSigInt);

  const context: AgentContext = {
    workspace,
    provider,
    model,
    yolo: false,
    planMode: true,
    jsonOutput,
    maxSteps: options.maxSteps || config.maxSteps || 25,
    timeoutMs: options.timeout || config.timeoutMs || 60000,
    firstTokenTimeoutMs: options.firstTokenTimeout || config.firstTokenTimeoutMs || 30000,
    showTiming,
    lowLatency: false,
    activeSkills: options.skill || config.activeSkills || [],
    attachments,
    signal: abortController.signal
  };

  const planPrompt = `Please inspect the codebase as needed and generate a detailed, structured, read-only implementation plan for the following task:\n\n${task}`;

  try {
    const result = await agent.runTurn(session, planPrompt, context, attachments);

    if (jsonOutput) {
      console.log(JSON.stringify({
        sessionId: session.id,
        provider,
        model,
        task,
        plan: result.reply,
        usage: result.usage,
        timing: result.timing
      }, null, 2));
    } else {
      console.log(pc.dim(`\n[Plan complete. Session ID: ${session.id}]`));
      if (showTiming && result.timing) {
        console.log(pc.dim(`[Total Plan Time: ${(result.timing.totalMs / 1000).toFixed(2)}s]`));
      }
    }
  } catch (err: any) {
    if (jsonOutput) {
      console.error(JSON.stringify({ error: err.message }));
    } else if (err instanceof CancelledError || abortController.signal.aborted) {
      console.log(pc.yellow('\n[Plan cancelled by user]'));
    } else {
      console.error(formatErrorMessage(err));
    }
    process.exit(1);
  } finally {
    process.removeListener('SIGINT', onSigInt);
    await agent.shutdown();
  }
}
