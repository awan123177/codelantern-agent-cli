import pc from 'picocolors';
import { ProviderRegistry } from '../provider/registry.js';
import { loadConfig, setConfigValue } from '../config/config.js';

export async function modelsCommand(
  action?: string,
  modelId?: string,
  options?: {
    provider?: string;
    refresh?: boolean;
    json?: boolean;
  }
): Promise<void> {
  const registry = new ProviderRegistry();
  const config = loadConfig();
  const subAction = (action || 'list').toLowerCase();
  const providerId = options?.provider || config.activeProvider || 'gemini';
  const provider = registry.getProvider(providerId);

  if (subAction === 'list') {
    if (!options?.json) {
      console.log(`\nFetching models for ${pc.cyan(provider.displayName)}...`);
    }
    const models = await provider.listModels(Boolean(options?.refresh));

    if (options?.json) {
      console.log(JSON.stringify(models, null, 2));
      return;
    }

    console.log('\n' + pc.bold(pc.yellow(`🏮 Available Models for ${provider.displayName}`)));
    console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
    console.log(
      pc.bold('Model ID'.padEnd(36)) +
      pc.bold('Tools'.padEnd(8)) +
      pc.bold('Vision'.padEnd(8)) +
      pc.bold('Reasoning'.padEnd(12)) +
      pc.bold('Context Window')
    );
    console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));

    const currentModel = config.defaultModel;

    for (const m of models) {
      const isCurrent = m.id === currentModel;
      const marker = isCurrent ? pc.green(' (active)') : '';
      const idCol = (m.id + marker).slice(0, 34);
      const toolsCol = m.capabilities.tools ? pc.green('✓') : pc.dim('✗');
      const visionCol = m.capabilities.images ? pc.green('✓') : pc.dim('✗');
      const reasoningCol = m.capabilities.reasoning ? pc.magenta('✓') : pc.dim('✗');
      const ctxCol = m.contextWindow ? `${(m.contextWindow / 1000).toFixed(0)}k` : pc.dim('standard');

      console.log(
        idCol.padEnd(isCurrent ? 45 : 36) +
        toolsCol.padEnd(16) +
        visionCol.padEnd(16) +
        reasoningCol.padEnd(20) +
        ctxCol
      );
    }

    console.log(pc.dim('\nTo set active model: lantern model set <model-id>'));
    console.log(pc.dim(`Example: lantern model set ${models[0]?.id || 'gemini-3.8-flash'}\n`));
    return;
  }

  if (subAction === 'set') {
    if (!modelId) {
      console.error(pc.red('Error: Missing model ID. Usage: lantern model set <model-id> [--provider <provider>]'));
      process.exit(1);
    }

    if (options?.provider) {
      setConfigValue('activeProvider', options.provider.toLowerCase());
    }

    setConfigValue('defaultModel', modelId.trim());
    console.log(pc.green(`✓ Set active model to '${modelId.trim()}' (provider: ${provider.displayName})`));
    return;
  }

  console.error(pc.red(`Unknown action '${action}'. Available: list, set`));
  process.exit(1);
}
