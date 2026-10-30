import pc from 'picocolors';
import { listSessions, exportSessionMarkdown } from '../session/sessionManager.js';
import { ProviderRegistry } from '../provider/registry.js';
import { SkillManager } from '../skills/skillManager.js';
import { loadConfig, setConfigValue } from '../config/config.js';
import { getApiKey, setApiKey, maskApiKey, promptMaskedApiKey, getStoreName } from '../security/credentials.js';
import { classifyModel, getRecommendedCodingModels } from '../provider/modelClassifier.js';
import type { OrbitSession, ProviderModelInfo } from '../types.js';

export interface SlashCommandContext {
  session: OrbitSession;
  provider: string;
  model: string;
  workspace: string;
  yolo: boolean;
  planMode: boolean;
  showTiming: boolean;
  activeSkills: string[];
  setProvider: (p: string) => void;
  setModel: (m: string) => void;
  setYolo: (y: boolean) => void;
  setPlanMode: (p: boolean) => void;
  setShowTiming: (t: boolean) => void;
  setActiveSkills: (skills: string[]) => void;
  askQuestion?: (query: string) => Promise<string>;
}

export async function handleSlashCommand(input: string, context: SlashCommandContext): Promise<boolean> {
  const parts = input.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ');

  switch (command) {
    case '/help':
      console.log('\n' + pc.bold(pc.yellow('🏮 Code Lantern CLI — Help & Commands')));
      console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
      console.log(pc.bold('Slash Commands (Entered inside Lantern session):'));
      console.log(`  ${pc.cyan('/help')}                 Show this help overview`);
      console.log(`  ${pc.cyan('/clear')}                Clear the terminal screen`);
      console.log(`  ${pc.cyan('/status')}               Display session, provider, model, and skill status`);
      console.log(`  ${pc.cyan('/provider')}             List configured providers and select one interactively`);
      console.log(`  ${pc.cyan('/provider <name>')}      Switch current session to provider (gemini, openrouter, openai, anthropic)`);
      console.log(`  ${pc.cyan('/provider default <name>')} Set provider as default and switch session`);
      console.log(`  ${pc.cyan('/model')}                Discover & browse models for active provider with interactive selection`);
      console.log(`  ${pc.cyan('/model <model-id>')}     Switch current session to specified model`);
      console.log(`  ${pc.cyan('/model default <id>')}   Set model as default and switch session`);
      console.log(`  ${pc.cyan('/skills [name]')}        List, enable, or disable active skills`);
      console.log(`  ${pc.cyan('/timing [on|off]')}      Toggle request timing diagnostics display`);
      console.log(`  ${pc.cyan('/plan [on|off]')}        Toggle read-only planning mode`);
      console.log(`  ${pc.cyan('/yolo [on|off]')}        Toggle YOLO auto-approval mode`);
      console.log(`  ${pc.cyan('/sessions')}             List saved local sessions`);
      console.log(`  ${pc.cyan('/history')}              Display recent turns in current session`);
      console.log(`  ${pc.cyan('/export [md|json]')}     Export current conversation transcript`);
      console.log(`  ${pc.cyan('/exit')} or ${pc.cyan('/quit')}        Exit Code Lantern CLI`);
      console.log('');
      console.log(pc.bold('Keyboard Shortcuts:'));
      console.log(`  ${pc.dim('Enter')}                  Submit prompt`);
      console.log(`  ${pc.dim('\\ + Enter')}              Continue prompt on next line (multiline)`);
      console.log(`  ${pc.dim('""" ... """')}            Multiline prompt block`);
      console.log(`  ${pc.dim('Up/Down Arrows')}         Navigate prompt history`);
      console.log(`  ${pc.dim('Ctrl+C')}                 Cancel active request / double-tap to exit`);
      console.log(`  ${pc.dim('Ctrl+D')}                 Exit session`);
      console.log('');
      return true;

    case '/clear':
      console.clear();
      return true;

    case '/status':
      console.log('\n' + pc.bold(pc.yellow('🏮 Code Lantern Status')));
      console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
      console.log(`${pc.bold('Session ID:')}       ${pc.cyan(context.session.id)}`);
      console.log(`${pc.bold('Workspace:')}        ${pc.blue(context.workspace)}`);
      console.log(`${pc.bold('Active Provider:')}  ${pc.magenta(context.provider)}`);
      console.log(`${pc.bold('Active Model:')}     ${pc.green(context.model)}`);
      console.log(`${pc.bold('Active Skills:')}    ${context.activeSkills.length > 0 ? pc.yellow(context.activeSkills.join(', ')) : pc.dim('none')}`);
      console.log(`${pc.bold('Turns:')}            ${context.session.turns.length}`);
      console.log(`${pc.bold('Total Tokens:')}     ${context.session.totalUsage.totalTokens.toLocaleString()}`);
      console.log(`${pc.bold('Timing Logs:')}      ${context.showTiming ? pc.green('ON') : pc.dim('OFF')}`);
      console.log(`${pc.bold('YOLO Mode:')}        ${context.yolo ? pc.red('ON (Auto-approve)') : pc.green('OFF (Prompt approval)')}`);
      console.log(`${pc.bold('Plan Mode:')}        ${context.planMode ? pc.blue('ON (Read-only)') : pc.dim('OFF (Full execution)')}`);
      console.log('');
      return true;

    case '/provider': {
      const registry = new ProviderRegistry();
      const trimmedArg = arg.trim();

      const switchProvider = async (target: string, isDefault = false): Promise<void> => {
        const norm = target.toLowerCase().trim();
        if (!registry.hasProvider(norm)) {
          console.log(pc.red(`Provider '${target}' not found. Available: ${registry.listProviders().map(p => p.id).join(', ')}`));
          return;
        }

        const p = registry.getProvider(norm);
        if (!p.isConfigured()) {
          console.log('\n' + pc.yellow(`🏮 No API key configured for ${p.displayName} (${norm}).`));
          console.log(pc.dim(`Lantern will securely save this key to your ${getStoreName()} so you never have to re-enter it.`));
          const key = await promptMaskedApiKey(`Enter API key for '${norm}' (or press Enter to cancel)`);
          if (!key) {
            console.log(pc.dim('Provider switch cancelled.\n'));
            return;
          }
          setApiKey(norm, key);
          console.log(pc.green(`✓ Saved key for '${p.displayName}' to ${getStoreName()} (${maskApiKey(key)})\n`));
        }

        // Connection verification check
        console.log(pc.dim(`Verifying connection to ${p.displayName}...`));
        const testRes = await p.testConnection();
        if (!testRes.success) {
          console.log(pc.yellow(`⚠️ Connection warning for ${p.displayName}: ${testRes.error || 'Network error'}`));
          console.log(pc.dim(`  You can test provider connectivity from the shell: lantern providers test ${norm}`));
        } else {
          console.log(pc.dim(`✓ Verified ${p.displayName} connection (${testRes.latencyMs}ms)`));
        }

        // Update active session & context immediately
        context.setProvider(norm);
        context.setModel(p.defaultModel);

        if (isDefault) {
          setConfigValue('activeProvider', norm);
          console.log(pc.green(`✓ Saved '${p.displayName}' as default provider and switched active session.`));
        } else {
          console.log(pc.green(`✓ Switched provider to '${p.displayName}' (model: ${p.defaultModel}).`));
        }

        if (context.session.turns.length > 0) {
          console.log(pc.dim(`  Preserved ${context.session.turns.length} conversation turn(s) for this session.`));
        }
      };

      if (trimmedArg.toLowerCase().startsWith('default ')) {
        const target = trimmedArg.slice(8).trim();
        if (!target) {
          console.log(pc.yellow('Usage: /provider default <name> (e.g. /provider default openrouter)'));
          return true;
        }
        await switchProvider(target, true);
        return true;
      }

      if (trimmedArg) {
        await switchProvider(trimmedArg, false);
        return true;
      }

      // No arguments: list configured providers and allow selection
      const providers = registry.listProviders();
      console.log('\n' + pc.bold(pc.yellow('🏮 Configured AI Providers')));
      console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
      console.log(
        pc.bold('#'.padEnd(4)) +
        pc.bold('Provider'.padEnd(16)) +
        pc.bold('Status'.padEnd(16)) +
        pc.bold('Default Model'.padEnd(28)) +
        pc.bold('Key Source')
      );
      console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));

      for (let i = 0; i < providers.length; i++) {
        const p = providers[i];
        const num = pc.dim(`${i + 1}.`.padEnd(4));
        const activeMarker = p.id === context.provider ? pc.green(' (active)') : '';
        const nameCol = (p.id + activeMarker).padEnd(20);
        const statusCol = p.isConfigured ? pc.green('✓ Ready').padEnd(18) : pc.yellow('! Needs Key').padEnd(18);
        const modelCol = pc.cyan(p.defaultModel).padEnd(30);
        const keyInfo = getApiKey(p.id);
        const srcCol = keyInfo.sourceDescription ? pc.cyan(`[${keyInfo.sourceDescription}]`) : pc.dim('(missing)');

        console.log(`${num}${nameCol}${statusCol}${modelCol}${srcCol}`);
      }

      console.log(pc.dim('\nUsage:'));
      console.log(pc.dim('  /provider <name>            Switch current session to provider'));
      console.log(pc.dim('  /provider default <name>    Set as persistent default and switch session'));

      if (context.askQuestion) {
        const answer = await context.askQuestion(
          pc.cyan(`\nSelect provider [1-${providers.length} or enter name] (Enter to cancel): `)
        );
        if (answer) {
          const num = parseInt(answer, 10);
          if (!isNaN(num) && num >= 1 && num <= providers.length) {
            await switchProvider(providers[num - 1].id, false);
          } else {
            await switchProvider(answer, false);
          }
        }
      }
      return true;
    }

    case '/model': {
      const registry = new ProviderRegistry();
      const p = registry.getProvider(context.provider);
      const trimmedArg = arg.trim();

      const switchModel = (targetModelId: string, isDefault = false): void => {
        const classification = classifyModel(targetModelId);

        if (classification.category === 'specialized') {
          console.log('\n' + pc.red(`❌ Cannot use specialized ${classification.specializedType} model '${targetModelId}' for interactive coding.`));
          if (classification.warning) {
            console.log(pc.dim(`  ${classification.warning}`));
          }
          const recs = getRecommendedCodingModels(context.provider);
          console.log(pc.yellow(`\nCompatible coding models for ${p.displayName}:`));
          for (const rec of recs) {
            console.log(`  - ${pc.bold(pc.cyan(rec))}`);
          }
          console.log('');
          return;
        }

        if (classification.category === 'chat') {
          console.log('\n' + pc.yellow(`⚠️ Warning: Model '${targetModelId}' does not support tool use / function calling.`));
          console.log(pc.dim('  Lantern will answer chat questions, but cannot inspect files, edit code, or run shell commands.'));
          const recs = getRecommendedCodingModels(context.provider);
          console.log(pc.dim(`  Recommended coding models with tool support: ${recs.join(', ')}\n`));
        }

        // Apply switch
        context.setModel(targetModelId);

        if (isDefault) {
          setConfigValue('defaultModel', targetModelId);
          console.log(pc.green(`✓ Saved model '${targetModelId}' as default and switched active session.`));
        } else {
          console.log(pc.green(`✓ Switched model to: ${targetModelId}`));
        }

        if (context.session.turns.length > 0) {
          console.log(pc.dim(`  Preserved ${context.session.turns.length} conversation turn(s) for this session.`));
        }
      };

      if (trimmedArg.toLowerCase().startsWith('default ')) {
        const target = trimmedArg.slice(8).trim();
        if (!target) {
          console.log(pc.yellow('Usage: /model default <model-id> (e.g. /model default gemini-3.8-flash)'));
          return true;
        }
        switchModel(target, true);
        return true;
      }

      if (trimmedArg) {
        switchModel(trimmedArg, false);
        return true;
      }

      // No arguments: discover models for active provider
      if (!p.isConfigured()) {
        console.log('\n' + pc.yellow(`🏮 No API key configured for ${p.displayName} (${p.id}).`));
        console.log(pc.dim(`Lantern will securely save this key to your ${getStoreName()} so you won't need to enter it again.`));
        const key = await promptMaskedApiKey(`Enter API key for '${p.id}' (or press Enter to cancel)`);
        if (key) {
          setApiKey(p.id, key);
          console.log(pc.green(`✓ Saved key for '${p.displayName}' to ${getStoreName()} (${maskApiKey(key)})\n`));
        }
      }

      console.log(pc.dim(`\nDiscovering available models for ${p.displayName}...`));
      let models: ProviderModelInfo[] = [];
      let discoveryError: string | null = null;

      try {
        models = await p.listModels();
      } catch (err: any) {
        discoveryError = err.message || String(err);
      }

      if (models.length === 0) {
        if (discoveryError) {
          console.log(pc.yellow(`⚠️ Model discovery unavailable for ${p.displayName}: ${discoveryError}`));
        } else {
          console.log(pc.yellow(`No models returned by discovery for ${p.displayName}.`));
        }
        console.log(pc.dim(`You can manually enter any model ID supported by ${p.displayName}.`));
        console.log(`Current model: ${pc.cyan(context.model)}`);

        if (context.askQuestion) {
          const manual = await context.askQuestion(
            pc.cyan(`Enter model ID to switch (or press Enter to cancel): `)
          );
          if (manual) {
            switchModel(manual, false);
          }
        }
        return true;
      }

      // Separate into interactive coding models vs chat-only vs specialized
      const codingModels: Array<{ info: ProviderModelInfo; classification: ReturnType<typeof classifyModel> }> = [];
      const chatOnlyModels: Array<{ info: ProviderModelInfo; classification: ReturnType<typeof classifyModel> }> = [];
      const specializedModels: Array<{ info: ProviderModelInfo; classification: ReturnType<typeof classifyModel> }> = [];

      for (const m of models) {
        const c = classifyModel(m.id, m.capabilities, m.description);
        if (c.category === 'coding') {
          codingModels.push({ info: m, classification: c });
        } else if (c.category === 'chat') {
          chatOnlyModels.push({ info: m, classification: c });
        } else {
          specializedModels.push({ info: m, classification: c });
        }
      }

      console.log('\n' + pc.bold(pc.yellow(`🏮 Available Models for ${p.displayName}`)));
      console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
      console.log(
        pc.bold('#'.padEnd(4)) +
        pc.bold('Model ID'.padEnd(36)) +
        pc.bold('Tools'.padEnd(8)) +
        pc.bold('Vision'.padEnd(8)) +
        pc.bold('Reasoning'.padEnd(12)) +
        pc.bold('Context Window')
      );
      console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));

      const selectableList: Array<{ id: string; category: string }> = [];

      // Render Coding Models
      let index = 1;
      for (const item of codingModels) {
        const m = item.info;
        const isCurrent = m.id === context.model;
        const marker = isCurrent ? pc.green(' (active)') : '';
        const idCol = (m.id + marker).slice(0, 34).padEnd(36);
        const toolsCol = pc.green('✓').padEnd(8);
        const visionCol = m.capabilities.images ? pc.green('✓').padEnd(8) : pc.dim('✗').padEnd(8);
        const reasoningCol = m.capabilities.reasoning ? pc.magenta('✓').padEnd(12) : pc.dim('✗').padEnd(12);
        const ctxCol = m.contextWindow ? `${(m.contextWindow / 1000).toFixed(0)}k` : pc.dim('standard');

        console.log(`${pc.dim(`${index}.`.padEnd(4))}${idCol}${toolsCol}${visionCol}${reasoningCol}${ctxCol}`);
        selectableList.push({ id: m.id, category: 'coding' });
        index++;
      }

      // Render Chat-Only Models if any exist
      if (chatOnlyModels.length > 0) {
        console.log(pc.dim('\nChat-Only Models (No tool execution / file editing):'));
        for (const item of chatOnlyModels.slice(0, 5)) {
          const m = item.info;
          const isCurrent = m.id === context.model;
          const marker = isCurrent ? pc.green(' (active)') : '';
          const idCol = (m.id + marker).slice(0, 34).padEnd(36);
          const toolsCol = pc.dim('✗').padEnd(8);
          const visionCol = m.capabilities.images ? pc.green('✓').padEnd(8) : pc.dim('✗').padEnd(8);
          const reasoningCol = m.capabilities.reasoning ? pc.magenta('✓').padEnd(12) : pc.dim('✗').padEnd(12);
          const ctxCol = m.contextWindow ? `${(m.contextWindow / 1000).toFixed(0)}k` : pc.dim('standard');

          console.log(`${pc.dim(`${index}.`.padEnd(4))}${idCol}${toolsCol}${visionCol}${reasoningCol}${ctxCol}`);
          selectableList.push({ id: m.id, category: 'chat' });
          index++;
        }
      }

      // Show summary of specialized models if any
      if (specializedModels.length > 0) {
        console.log(pc.dim('\nSpecialized Models (Embeddings, Batch, Audio, Images - not suitable for coding):'));
        const samples = specializedModels.slice(0, 6).map(s => `${s.info.id} [${s.classification.specializedType || 'Specialized'}]`).join(', ');
        console.log(pc.dim(`  ${samples}${specializedModels.length > 6 ? ` (+${specializedModels.length - 6} more)` : ''}`));
      }

      console.log(pc.dim('\nUsage:'));
      console.log(pc.dim('  /model <model-id>           Switch current session to model'));
      console.log(pc.dim('  /model default <model-id>   Set as persistent default and switch session'));

      if (context.askQuestion) {
        const answer = await context.askQuestion(
          pc.cyan(`\nSelect model [1-${selectableList.length} or enter model ID] (Enter to keep current): `)
        );
        if (answer) {
          const num = parseInt(answer, 10);
          if (!isNaN(num) && num >= 1 && num <= selectableList.length) {
            switchModel(selectableList[num - 1].id, false);
          } else {
            switchModel(answer, false);
          }
        }
      }
      return true;
    }

    case '/skills': {
      const manager = new SkillManager();
      const skills = manager.listSkills(context.workspace);

      if (arg) {
        const target = arg.trim();
        const skill = manager.getSkill(target, context.workspace);
        if (skill) {
          const isCurrentlyActive = context.activeSkills.includes(skill.name);
          if (isCurrentlyActive) {
            context.setActiveSkills(context.activeSkills.filter(s => s !== skill.name));
            console.log(pc.yellow(`✓ Deactivated skill '${skill.name}' for this session.`));
          } else {
            context.setActiveSkills([...context.activeSkills, skill.name]);
            console.log(pc.green(`✓ Activated skill '${skill.name}' for this session.`));
          }
        } else {
          console.log(pc.red(`Skill '${target}' not found.`));
        }
      } else {
        console.log('\n' + pc.bold(pc.yellow('🏮 Code Lantern Skills:')));
        if (skills.length === 0) {
          console.log(pc.dim('  (No skills currently installed. Add one with: lantern skills add <path>)'));
        } else {
          for (const s of skills) {
            const isSessionActive = context.activeSkills.includes(s.name);
            const status = isSessionActive ? pc.green('● ACTIVE') : s.enabled ? pc.cyan('○ default') : pc.dim('○ inactive');
            console.log(`  ${status} ${pc.bold(s.name)} - ${pc.dim(s.description.slice(0, 50))}`);
          }
        }
        console.log(pc.dim(`\nToggle skill for session: /skills <name>\n`));
      }
      return true;
    }

    case '/timing':
      if (arg === 'off') {
        context.setShowTiming(false);
        console.log(pc.yellow('✓ Timing diagnostics disabled.'));
      } else if (arg === 'on') {
        context.setShowTiming(true);
        console.log(pc.green('✓ Timing diagnostics enabled.'));
      } else {
        const next = !context.showTiming;
        context.setShowTiming(next);
        console.log(next ? pc.green('✓ Timing diagnostics enabled.') : pc.yellow('✓ Timing diagnostics disabled.'));
      }
      return true;

    case '/plan':
      if (arg === 'off') {
        context.setPlanMode(false);
        console.log(pc.green('✓ Plan mode disabled (execution tools enabled).'));
      } else if (arg === 'on') {
        context.setPlanMode(true);
        console.log(pc.blue('✓ Plan mode enabled (read-only inspection).'));
      } else {
        const next = !context.planMode;
        context.setPlanMode(next);
        console.log(next ? pc.blue('✓ Plan mode enabled (read-only inspection).') : pc.green('✓ Plan mode disabled.'));
      }
      return true;

    case '/yolo':
      if (arg === 'off') {
        context.setYolo(false);
        console.log(pc.green('✓ YOLO mode disabled (safe approval prompts active).'));
      } else if (arg === 'on') {
        context.setYolo(true);
        console.log(pc.red('⚡ YOLO mode enabled (auto-approving edits & commands).'));
      } else {
        const next = !context.yolo;
        context.setYolo(next);
        console.log(next ? pc.red('⚡ YOLO mode enabled.') : pc.green('✓ Safe mode enabled.'));
      }
      return true;

    case '/sessions': {
      const list = listSessions();
      console.log('\n' + pc.bold('Recent Sessions:'));
      if (list.length === 0) {
        console.log(pc.dim('  (No saved sessions)'));
      } else {
        for (const s of list.slice(0, 8)) {
          const isCurrent = s.id === context.session.id ? pc.green(' (current)') : '';
          console.log(`  ${pc.cyan(s.id)} - ${s.title}${isCurrent} [${s.turnCount} turns]`);
        }
      }
      console.log('');
      return true;
    }

    case '/history':
      console.log('\n' + pc.bold('Session History:'));
      if (context.session.turns.length === 0) {
        console.log(pc.dim('  (No messages yet in this session)'));
      } else {
        for (const t of context.session.turns) {
          const roleBadge = t.role === 'user' ? pc.cyan('[User]') : t.role === 'model' ? pc.yellow('[Lantern]') : pc.dim('[Tool]');
          const preview = t.text ? t.text.slice(0, 100).replace(/\n/g, ' ') : `(Tool calls: ${t.toolCalls?.map(c => c.name).join(', ')})`;
          console.log(`  ${roleBadge} ${preview}`);
        }
      }
      console.log('');
      return true;

    case '/export': {
      const format = arg.toLowerCase() === 'json' ? 'json' : 'markdown';
      if (format === 'json') {
        console.log('\n' + JSON.stringify(context.session, null, 2));
      } else {
        console.log('\n' + exportSessionMarkdown(context.session));
      }
      return true;
    }

    case '/exit':
    case '/quit':
      return false;

    default:
      console.log(pc.yellow(`Unknown slash command '${command}'. Type ${pc.bold('/help')} for available commands.`));
      return true;
  }
}
