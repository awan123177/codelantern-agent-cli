import pc from 'picocolors';
import { loadMcpConfig, addMcpServer, removeMcpServer, toggleMcpServer } from '../mcp/mcpConfig.js';
import { McpManager } from '../mcp/mcpManager.js';

export async function mcpCommand(
  action?: string,
  serverName?: string,
  command?: string,
  args: string[] = []
): Promise<void> {
  const servers = loadMcpConfig();

  if (!action || action === 'list') {
    console.log('\n' + pc.bold(pc.yellow('🏮 Code Lantern MCP Servers')));
    console.log(pc.dim('─────────────────────────────────────────────────────────────'));

    const entries = Object.entries(servers);
    if (entries.length === 0) {
      console.log(pc.dim('No MCP servers configured.'));
      console.log(pc.dim('\nTo add a server: lantern mcp add <name> <command> [args...]'));
      console.log(pc.dim('Example: lantern mcp add sqlite npx -y @modelcontextprotocol/server-sqlite /path/to/db.sqlite\n'));
      return;
    }

    for (const [name, s] of entries) {
      const statusBadge = s.disabled ? pc.red('[disabled]') : pc.green('[enabled]');
      console.log(`${pc.bold(name)} ${statusBadge}`);
      console.log(`  Command: ${pc.cyan(s.command)} ${(s.args || []).join(' ')}`);
      if (s.env && Object.keys(s.env).length > 0) {
        console.log(`  Env:     ${JSON.stringify(s.env)}`);
      }
      console.log('');
    }
    return;
  }

  if (action === 'add') {
    if (!serverName || !command) {
      console.error(pc.red('Error: Missing arguments. Usage: orbit mcp add <name> <command> [args...]'));
      process.exit(1);
    }

    addMcpServer(serverName, {
      command,
      args: args.length > 0 ? args : undefined
    });

    console.log(pc.green(`✓ Added MCP server '${serverName}': ${command} ${args.join(' ')}`));
    return;
  }

  if (action === 'remove' || action === 'rm') {
    if (!serverName) {
      console.error(pc.red('Error: Missing server name. Usage: orbit mcp remove <name>'));
      process.exit(1);
    }

    const removed = removeMcpServer(serverName);
    if (removed) {
      console.log(pc.green(`✓ Removed MCP server '${serverName}'`));
    } else {
      console.error(pc.red(`✗ MCP server '${serverName}' not found`));
      process.exit(1);
    }
    return;
  }

  if (action === 'disable') {
    if (!serverName) {
      console.error(pc.red('Error: Missing server name. Usage: orbit mcp disable <name>'));
      process.exit(1);
    }
    toggleMcpServer(serverName, true);
    console.log(pc.yellow(`✓ Disabled MCP server '${serverName}'`));
    return;
  }

  if (action === 'enable') {
    if (!serverName) {
      console.error(pc.red('Error: Missing server name. Usage: orbit mcp enable <name>'));
      process.exit(1);
    }
    toggleMcpServer(serverName, false);
    console.log(pc.green(`✓ Enabled MCP server '${serverName}'`));
    return;
  }

  if (action === 'test') {
    if (!serverName) {
      console.error(pc.red('Error: Missing server name. Usage: orbit mcp test <name>'));
      process.exit(1);
    }

    const server = servers[serverName];
    if (!server) {
      console.error(pc.red(`✗ MCP server '${serverName}' not found in configuration`));
      process.exit(1);
    }

    console.log(`Connecting to MCP server '${serverName}'...`);
    const mgr = new McpManager();
    try {
      const tools = await mgr.connectServer(serverName, server);
      console.log(pc.green(`✓ Connected successfully! Exposing ${tools.length} tool(s):`));
      for (const t of tools) {
        console.log(`  - ${pc.cyan(t.definition.name)}: ${t.definition.description}`);
      }
    } catch (err: any) {
      console.error(pc.red(`✗ Failed to connect to '${serverName}': ${err.message}`));
      process.exit(1);
    } finally {
      await mgr.closeAll();
    }
    return;
  }

  console.error(pc.red(`Error: Unknown action '${action}'. Available: list, add, remove, enable, disable, test`));
  process.exit(1);
}
