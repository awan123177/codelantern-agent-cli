import pc from 'picocolors';
import {
  listConfiguredKeys,
  setApiKey,
  removeApiKey,
  maskApiKey,
  promptMaskedApiKey,
  getStoreName
} from '../security/credentials.js';

export async function keysCommand(
  action?: string,
  provider?: string,
  key?: string
): Promise<void> {
  const subAction = (action || 'list').toLowerCase();

  if (subAction === 'list') {
    const keys = listConfiguredKeys();
    console.log('\n' + pc.bold(pc.yellow('🏮 Configured Provider API Keys')));
    console.log(pc.dim(`Storage: ${getStoreName()}`));
    console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
    console.log(
      pc.bold('Provider'.padEnd(16)) +
      pc.bold('Source'.padEnd(28)) +
      pc.bold('Masked Key')
    );
    console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));

    for (const [p, info] of Object.entries(keys)) {
      const srcText = info.configured
        ? (info.source === 'env' ? pc.cyan(info.sourceDescription) : pc.blue(info.sourceDescription))
        : pc.dim('none');

      console.log(
        pc.bold(p.padEnd(16)) +
        srcText.padEnd(36) +
        (info.configured ? pc.green(info.maskedKey) : pc.dim('(not configured)'))
      );
    }

    console.log(pc.dim('\nTo set key:    lantern keys set <provider>'));
    console.log(pc.dim('To remove key: lantern keys remove <provider>'));
    console.log(pc.dim('Note: Keys are securely stored in your native OS credential store and reused automatically.\n'));
    return;
  }

  if (subAction === 'set') {
    if (!provider) {
      console.error(pc.red('Error: Missing provider name. Usage: lantern keys set <provider> [key]'));
      process.exit(1);
    }

    const norm = provider.toLowerCase().trim();
    let apiKey = key;

    if (!apiKey) {
      apiKey = await promptMaskedApiKey(`Enter API key for '${norm}'`);
    }

    if (!apiKey) {
      console.error(pc.red('Error: API key cannot be empty.'));
      process.exit(1);
    }

    try {
      setApiKey(norm, apiKey);
      console.log(pc.green(`✓ Successfully saved API key for '${norm}' to ${getStoreName()} (${maskApiKey(apiKey)})`));
      console.log(pc.dim('  Lantern will automatically reuse this key in future sessions and commands.'));
    } catch (err: any) {
      console.error(pc.red(`Error saving key: ${err.message}`));
      process.exit(1);
    }
    return;
  }

  if (subAction === 'remove' || subAction === 'rm') {
    if (!provider) {
      console.error(pc.red('Error: Missing provider name. Usage: lantern keys remove <provider>'));
      process.exit(1);
    }

    const norm = provider.toLowerCase().trim();
    const removed = removeApiKey(norm);
    if (removed) {
      console.log(pc.green(`✓ Removed stored key for '${norm}' from ${getStoreName()}`));
    } else {
      console.log(pc.yellow(`No stored key found for '${norm}' in ${getStoreName()}.`));
      console.log(pc.dim(`(If set via environment variable, unset ${norm.toUpperCase()}_API_KEY).`));
    }
    return;
  }

  console.error(pc.red(`Unknown action '${action}'. Available: list, set, remove`));
  process.exit(1);
}
