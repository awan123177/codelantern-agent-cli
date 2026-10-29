import pc from 'picocolors';
import { listSessions, exportSessionMarkdown } from '../session/sessionManager.js';
import { ProviderRegistry } from '../provider/registry.js';
import { SkillManager } from '../skills/skillManager.js';
import type { OrbitSession } from '../types.js';

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
}

export async function handleSlashCommand(input: string, context: SlashCommandContext): Promise<boolean> {
  const parts = input.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ');

  switch (command) {
    case '/help':
      console.log('\n' + pc.bold(pc.yellow('🏮 Code Lantern CLI — Help & Commands')));
      console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
      console.log(pc.bold('Slash Commands:'));
      console.log(`  ${pc.cyan('/help')}                 Show this help overview`);
      console.log(`  ${pc.cyan('/clear')}                Clear the terminal screen`);
      console.log(`  ${pc.cyan('/status')}               Display session, provider, model, and skill status`);
      console.log(`  ${pc.cyan('/provider [name]')}      View or switch active AI provider (gemini, openai, anthropic, openrouter)`);
      console.log(`  ${pc.cyan('/model [id]')}           View or switch active model`);
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
      if (arg) {
        const norm = arg.toLowerCase().trim();
        if (registry.hasProvider(norm)) {
          context.setProvider(norm);
          const p = registry.getProvider(norm);
          context.setModel(p.defaultModel);
          console.log(pc.green(`✓ Switched provider to '${p.displayName}' (default model: ${p.defaultModel})`));
        } else {
          console.log(pc.red(`Provider '${arg}' not found. Available: ${registry.listProviders().map(p => p.id).join(', ')}`));
        }
      } else {
        const providers = registry.listProviders();
        console.log(`\nCurrent provider: ${pc.magenta(context.provider)}`);
        console.log('Available providers:');
        for (const p of providers) {
          const active = p.id === context.provider ? pc.green(' (active)') : '';
          console.log(`  - ${pc.bold(p.id)}: ${p.displayName} [${p.isConfigured ? pc.green('Ready') : pc.yellow('Needs key')}]${active}`);
        }
        console.log(pc.dim(`Usage: /provider <name> (e.g. /provider openai)`));
      }
      return true;
    }

    case '/model':
      if (arg) {
        context.setModel(arg.trim());
        console.log(pc.green(`✓ Model changed to: ${arg.trim()}`));
      } else {
        console.log(`Current model: ${pc.cyan(context.model)} (Provider: ${context.provider})`);
        console.log(pc.dim(`Usage: /model <model-id> (or run 'lantern models list' to view available models)`));
      }
      return true;

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
