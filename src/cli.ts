import { Command } from 'commander';
import { interactiveCommand } from './commands/interactive.js';
import { askCommand } from './commands/ask.js';
import { planCommand } from './commands/plan.js';
import { resumeCommand } from './commands/resume.js';
import { sessionsCommand } from './commands/sessions.js';
import { configCommand } from './commands/configCmd.js';
import { doctorCommand } from './commands/doctor.js';
import { mcpCommand } from './commands/mcpCmd.js';
import { providersCommand } from './commands/providersCmd.js';
import { modelsCommand } from './commands/modelsCmd.js';
import { keysCommand } from './commands/keysCmd.js';
import { skillsCommand } from './commands/skillsCmd.js';
import { loadConfig } from './config/config.js';

const program = new Command();
const config = loadConfig();

program
  .name('lantern')
  .description('Code Lantern CLI — Personal AI coding assistant for the terminal with multi-provider and skills support')
  .version('1.0.3');

// Global flags
program
  .option('-p, --provider <provider>', 'AI provider to use (openrouter, gemini, openai, anthropic, or custom)', config.activeProvider || 'openrouter')
  .option('-m, --model <model>', 'Model ID to use', config.defaultModel || 'openrouter/free')
  .option('-C, --cwd <path>', 'Working directory for Code Lantern agent', process.cwd())
  .option('-s, --session <id>', 'Resume or use a specific session ID')
  .option('-a, --attach <files...>', 'Attach one or more files/images/documents to the request')
  .option('--yolo', 'Enable YOLO mode (auto-approve file edits and shell commands)', false)
  .option('--json', 'Output results formatted as JSON', false)
  .option('--timeout <ms>', 'Maximum total request duration in milliseconds (default: 60000)', (val) => parseInt(val, 10))
  .option('--connect-timeout <ms>', 'Maximum wait time for connection/headers in milliseconds (default: 15000)', (val) => parseInt(val, 10))
  .option('--first-token-timeout <ms>', 'Maximum wait time for initial token in milliseconds (default: 30000)', (val) => parseInt(val, 10))
  .option('--timing', 'Display detailed execution and latency timing diagnostics', false)
  .option('--fast', 'Enable low-latency streaming mode where supported', false)
  .option('--skill <skills>', 'Activate specific skills by name (comma-separated or repeated flag)', (val, prev: string[] = []) => {
    const parts = val.split(',').map(s => s.trim()).filter(Boolean);
    return [...prev, ...parts];
  })
  .option('--no-skills', 'Disable all skills for this run (load no skill content)', false);

// Subcommand: ask
program
  .command('ask <question...>')
  .description('Ask a single question or task and stream the answer')
  .action(async (questionParts: string[]) => {
    const opts = program.opts();
    const question = questionParts.join(' ');
    const noSkills = opts.skills === false || Boolean(opts.noSkills);
    await askCommand(question, {
      provider: opts.provider,
      model: opts.model,
      cwd: opts.cwd,
      attach: opts.attach,
      yolo: opts.yolo,
      json: opts.json,
      timeout: opts.timeout,
      connectTimeout: opts.connectTimeout,
      firstTokenTimeout: opts.firstTokenTimeout,
      timing: opts.timing,
      fast: opts.fast,
      skill: opts.skill,
      noSkills
    });
  });

// Subcommand: plan
program
  .command('plan <task...>')
  .description('Inspect the codebase and produce a read-only implementation plan')
  .action(async (taskParts: string[]) => {
    const opts = program.opts();
    const task = taskParts.join(' ');
    const noSkills = opts.skills === false || Boolean(opts.noSkills);
    await planCommand(task, {
      provider: opts.provider,
      model: opts.model,
      cwd: opts.cwd,
      attach: opts.attach,
      json: opts.json,
      timeout: opts.timeout,
      connectTimeout: opts.connectTimeout,
      firstTokenTimeout: opts.firstTokenTimeout,
      timing: opts.timing,
      skill: opts.skill,
      noSkills
    });
  });

// Subcommand: resume
program
  .command('resume [sessionId]')
  .description('Continue a saved conversation session')
  .action(async (sessionId?: string) => {
    const opts = program.opts();
    const noSkills = opts.skills === false || Boolean(opts.noSkills);
    await resumeCommand(sessionId, {
      provider: opts.provider,
      model: opts.model,
      cwd: opts.cwd,
      attach: opts.attach,
      yolo: opts.yolo,
      timeout: opts.timeout,
      connectTimeout: opts.connectTimeout,
      firstTokenTimeout: opts.firstTokenTimeout,
      timing: opts.timing,
      fast: opts.fast,
      skill: opts.skill,
      noSkills
    });
  });

// Subcommand: sessions
program
  .command('sessions')
  .description('List, delete, or export saved local sessions')
  .option('-d, --delete <id>', 'Delete session by ID')
  .option('-e, --export <id>', 'Export session transcript by ID')
  .action(async (cmdOpts: { delete?: string; export?: string }) => {
    const globalOpts = program.opts();
    await sessionsCommand({
      delete: cmdOpts.delete,
      export: cmdOpts.export,
      json: globalOpts.json
    });
  });

// Subcommand: config
program
  .command('config [action] [key] [value]')
  .description('View or update configuration (list, get, set, path)')
  .action(async (action?: string, key?: string, value?: string) => {
    await configCommand(action, key, value);
  });

// Subcommand: doctor
program
  .command('doctor')
  .description('Diagnose API keys, configuration, environment, and MCP server health')
  .action(async () => {
    await doctorCommand();
  });

// Subcommand: mcp
program
  .command('mcp [action] [serverName] [command] [args...]')
  .description('Manage configured MCP servers (list, add, remove, enable, disable, test)')
  .allowUnknownOption()
  .action(async (action?: string, serverName?: string, cmd?: string, ...rest: any[]) => {
    const rawArgs = rest.flat().filter(a => typeof a === 'string');
    await mcpCommand(action, serverName, cmd, rawArgs);
  });

// Subcommand: providers
program
  .command('providers [action] [target]')
  .description('Manage AI providers (list, set-default, test, add, remove)')
  .option('--base-url <url>', 'Base URL for custom OpenAI-compatible provider')
  .option('--api-key <key>', 'API key for provider')
  .option('--model <model>', 'Default model ID for provider')
  .action(async (action?: string, target?: string, cmdOpts?: { baseUrl?: string; apiKey?: string; model?: string }) => {
    await providersCommand(action, target, cmdOpts);
  });

// Subcommand: models (alias: model)
program
  .command('models [action] [modelId]')
  .alias('model')
  .description('List available models or switch the active model')
  .option('-p, --provider <provider>', 'Provider to inspect models for')
  .option('-r, --refresh', 'Bypass cache and query live model list', false)
  .option('--json', 'Output models list as JSON', false)
  .action(async (action?: string, modelId?: string, cmdOpts?: { provider?: string; refresh?: boolean; json?: boolean }) => {
    const globalOpts = program.opts();
    const provider = cmdOpts?.provider || globalOpts.provider;
    const json = Boolean(cmdOpts?.json || globalOpts.json);
    const refresh = Boolean(cmdOpts?.refresh);
    await modelsCommand(action, modelId, { provider, refresh, json });
  });

// Subcommand: keys
program
  .command('keys [action] [provider] [key]')
  .description('Securely manage API keys with local AES-256-GCM encryption (list, set, remove)')
  .action(async (action?: string, provider?: string, key?: string) => {
    await keysCommand(action, provider, key);
  });

// Subcommand: skills
program
  .command('skills [action] [target]')
  .description('Manage portable skills in SKILL.md format (list, show, add, enable, disable, remove)')
  .action(async (action?: string, target?: string) => {
    await skillsCommand(action, target);
  });

// Default action when no subcommand is given
program.action(async () => {
  const opts = program.opts();

  // Check if content was piped into stdin
  if (!process.stdin.isTTY) {
    let pipedData = '';
    process.stdin.setEncoding('utf8');

    for await (const chunk of process.stdin) {
      pipedData += chunk;
    }

    const trimmedPiped = pipedData.trim();
    const noSkills = opts.skills === false || Boolean(opts.noSkills);
    if (trimmedPiped) {
      await askCommand(trimmedPiped, {
        provider: opts.provider,
        model: opts.model,
        cwd: opts.cwd,
        attach: opts.attach,
        yolo: opts.yolo,
        json: opts.json,
        timeout: opts.timeout,
        connectTimeout: opts.connectTimeout,
        firstTokenTimeout: opts.firstTokenTimeout,
        timing: opts.timing,
        fast: opts.fast,
        skill: opts.skill,
        noSkills
      });
      return;
    }
  }

  const noSkills = opts.skills === false || Boolean(opts.noSkills);

  // Interactive mode
  await interactiveCommand({
    provider: opts.provider,
    model: opts.model,
    cwd: opts.cwd,
    session: opts.session,
    attach: opts.attach,
    yolo: opts.yolo,
    timeout: opts.timeout,
    connectTimeout: opts.connectTimeout,
    firstTokenTimeout: opts.firstTokenTimeout,
    timing: opts.timing,
    fast: opts.fast,
    skill: opts.skill,
    noSkills
  });
});

program.parseAsync(process.argv).catch(err => {
  console.error(`Error: ${err.message || err}`);
  process.exit(1);
});
