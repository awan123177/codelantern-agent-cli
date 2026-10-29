import readline from 'node:readline';
import pc from 'picocolors';
import { listConfiguredKeys, setApiKey, removeApiKey, maskApiKey } from '../security/credentials.js';

function promptPassword(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function keysCommand(
  action?: string,
  provider?: string,
  key?: string
): Promise<void> {
  const subAction = (action || 'list').toLowerCase();

  if (subAction === 'list') {
    const keys = listConfiguredKeys();
    console.log('\n' + pc.bold(pc.yellow('🏮 Configured Provider API Keys')));
    console.log(pc.dim('─────────────────────────────────────────────────────────────'));
    console.log(
      pc.bold('Provider'.padEnd(16)) +
      pc.bold('Source'.padEnd(14)) +
      pc.bold('Masked Key')
    );
    console.log(pc.dim('─────────────────────────────────────────────────────────────'));

    for (const [p, info] of Object.entries(keys)) {
      const srcText = info.source ? pc.cyan(`[${info.source}]`) : pc.dim('none');
      console.log(
        pc.bold(p.padEnd(16)) +
        srcText.padEnd(22) +
        (info.configured ? pc.green(info.maskedKey) : pc.dim('(not configured)'))
      );
    }

    console.log(pc.dim('\nTo set key: lantern keys set <provider> [key]'));
    console.log(pc.dim('To remove key: lantern keys remove <provider>\n'));
    return;
  }

  if (subAction === 'set') {
    if (!provider) {
      console.error(pc.red('Error: Missing provider name. Usage: lantern keys set <provider> [key]'));
      process.exit(1);
    }

    let apiKey = key;
    if (!apiKey) {
      apiKey = await promptPassword(`Enter API key for '${provider}': `);
    }

    if (!apiKey) {
      console.error(pc.red('Error: API key cannot be empty.'));
      process.exit(1);
    }

    setApiKey(provider, apiKey);
    console.log(pc.green(`✓ Successfully saved encrypted API key for '${provider}' (${maskApiKey(apiKey)})`));
    return;
  }

  if (subAction === 'remove' || subAction === 'rm') {
    if (!provider) {
      console.error(pc.red('Error: Missing provider name. Usage: lantern keys remove <provider>'));
      process.exit(1);
    }

    const removed = removeApiKey(provider);
    if (removed) {
      console.log(pc.green(`✓ Removed stored key for '${provider}'`));
    } else {
      console.log(pc.yellow(`No stored key found for '${provider}'. (If set in environment variables, unset the env var).`));
    }
    return;
  }

  console.error(pc.red(`Unknown action '${action}'. Available: list, set, remove`));
  process.exit(1);
}
