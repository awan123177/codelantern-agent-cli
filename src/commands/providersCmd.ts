import pc from 'picocolors';
import readline from 'node:readline';
import { ProviderRegistry } from '../provider/registry.js';
import { loadConfig, setConfigValue } from '../config/config.js';
import { setApiKey, getApiKey, maskApiKey, promptMaskedApiKey, getStoreName } from '../security/credentials.js';

function promptLine(query: string, hide = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function providersCommand(
  action?: string,
  target?: string,
  options?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  }
): Promise<void> {
  const registry = new ProviderRegistry();
  const subAction = (action || 'list').toLowerCase();

  if (subAction === 'list') {
    const providers = registry.listProviders();
    console.log('\n' + pc.bold(pc.yellow('🏮 Configured AI Providers')));
    console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
    console.log(
      pc.bold('Provider'.padEnd(16)) +
      pc.bold('Status'.padEnd(16)) +
      pc.bold('Default Model'.padEnd(30)) +
      pc.bold('Key Source')
    );
    console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));

    for (const p of providers) {
      const activeMarker = p.isActive ? pc.green(' (active)') : '';
      const nameCol = pc.bold(p.name) + activeMarker;
      const statusCol = p.isConfigured ? pc.green('✓ Ready') : pc.yellow('! Needs Key');
      const keyInfo = getApiKey(p.id);
      const sourceCol = keyInfo.sourceDescription ? pc.cyan(`[${keyInfo.sourceDescription}]`) : pc.dim('(missing)');

      console.log(
        nameCol.padEnd(p.isActive ? 25 : 16) +
        statusCol.padEnd(25) +
        p.defaultModel.padEnd(30) +
        sourceCol
      );
    }

    console.log(pc.dim('\nTo set default: lantern providers set-default <name>'));
    console.log(pc.dim('To test connection: lantern providers test [name]'));
    console.log(pc.dim('To add custom provider: lantern providers add <name>\n'));
    return;
  }

  if (subAction === 'set-default' || subAction === 'use') {
    if (!target) {
      console.error(pc.red('Error: Missing provider name. Usage: lantern providers set-default <name>'));
      process.exit(1);
    }

    const norm = target.toLowerCase();
    if (!registry.hasProvider(norm)) {
      console.error(pc.red(`Error: Provider '${target}' is not registered.`));
      process.exit(1);
    }

    setConfigValue('activeProvider', norm);
    const p = registry.getProvider(norm);
    setConfigValue('defaultModel', p.defaultModel);

    console.log(pc.green(`✓ Set active provider to '${p.displayName}' (default model: ${p.defaultModel})`));
    return;
  }

  if (subAction === 'test') {
    const targetProvider = target || loadConfig().activeProvider || 'openrouter';
    const p = registry.getProvider(targetProvider);

    console.log(`Testing connection to ${pc.cyan(p.displayName)}...`);
    const result = await p.testConnection();

    if (result.success) {
      console.log(pc.green(`✓ Connection verified! Latency: ${result.latencyMs}ms`));
      if (result.modelsCount !== undefined) {
        console.log(pc.dim(`  Available models discovered: ${result.modelsCount}`));
      }
    } else {
      console.log(pc.red(`✗ Connection failed: ${result.error}`));
      console.log(pc.yellow(`  Check your credentials with 'lantern keys list'`));
      process.exit(1);
    }
    return;
  }

  if (subAction === 'add') {
    const name = target || await promptLine('Provider ID / Name: ');
    if (!name) {
      console.error(pc.red('Error: Provider name is required.'));
      process.exit(1);
    }

    const baseUrl = options?.baseUrl || await promptLine('Base URL (e.g. http://localhost:11434/v1): ');
    const defaultModel = options?.model || await promptLine('Default Model ID (e.g. llama3, qwen2.5): ');
    const apiKey = options?.apiKey || await promptMaskedApiKey('API Key (optional, press Enter to skip)');

    registry.registerCustomProvider({
      id: name.toLowerCase(),
      name,
      type: 'custom',
      baseUrl,
      defaultModel: defaultModel || 'default'
    });

    if (apiKey) {
      setApiKey(name.toLowerCase(), apiKey);
    }

    console.log(pc.green(`✓ Registered custom OpenAI-compatible provider '${name}'`));
    return;
  }

  if (subAction === 'remove' || subAction === 'rm') {
    if (!target) {
      console.error(pc.red('Error: Missing provider name. Usage: lantern providers remove <name>'));
      process.exit(1);
    }

    const removed = registry.removeCustomProvider(target);
    if (removed) {
      console.log(pc.green(`✓ Removed provider '${target}'`));
    } else {
      console.log(pc.red(`Cannot remove built-in provider '${target}'. Only custom providers can be removed.`));
      process.exit(1);
    }
    return;
  }

  console.error(pc.red(`Unknown action '${action}'. Available: list, set-default, test, add, remove`));
  process.exit(1);
}
