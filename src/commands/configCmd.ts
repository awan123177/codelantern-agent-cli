import pc from 'picocolors';
import { loadConfig, setConfigValue, getConfigFilePath } from '../config/config.js';
import { ALLOWED_CONFIG_KEYS } from '../config/schema.js';

export async function configCommand(
  action?: string,
  key?: string,
  value?: string
): Promise<void> {
  const configPath = getConfigFilePath();

  if (!action || action === 'list') {
    const config = loadConfig();
    console.log('\n' + pc.bold(pc.yellow('🏮 Code Lantern Configuration')));
    console.log(pc.dim(`File: ${configPath}`));
    console.log(pc.dim('─────────────────────────────────────────────────────────────'));
    for (const [k, v] of Object.entries(config)) {
      if (k === 'mcpServers') {
        const count = Object.keys(v as object).length;
        console.log(`  ${pc.cyan(k.padEnd(24))} = ${pc.dim(`{ ${count} server(s) configured }`)}`);
      } else {
        console.log(`  ${pc.cyan(k.padEnd(24))} = ${pc.green(JSON.stringify(v))}`);
      }
    }
    console.log(pc.dim('\nUpdate setting: lantern config set <key> <value>'));
    console.log(pc.dim(`Supported keys: ${ALLOWED_CONFIG_KEYS.join(', ')}\n`));
    return;
  }

  if (action === 'path') {
    console.log(configPath);
    return;
  }

  if (action === 'get') {
    if (!key) {
      console.error(pc.red('Error: Missing config key. Usage: orbit config get <key>'));
      process.exit(1);
    }
    const config = loadConfig() as unknown as Record<string, unknown>;
    if (!(key in config)) {
      console.error(pc.red(`Error: Unknown configuration key '${key}'`));
      process.exit(1);
    }
    console.log(JSON.stringify(config[key]));
    return;
  }

  if (action === 'set') {
    if (!key || value === undefined) {
      console.error(pc.red('Error: Missing key or value. Usage: orbit config set <key> <value>'));
      process.exit(1);
    }

    const res = setConfigValue(key, value);
    if (!res.success) {
      console.error(pc.red(`Error: ${res.error}`));
      process.exit(1);
    }

    console.log(pc.green(`✓ Set ${key} = ${value}`));
    return;
  }

  console.error(pc.red(`Error: Unknown config action '${action}'. Available: list, get, set, path`));
  process.exit(1);
}
