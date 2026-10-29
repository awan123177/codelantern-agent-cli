import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import pc from 'picocolors';
import { getLanternHomeDir, getConfigFilePath, loadConfig } from '../config/config.js';
import { getSessionsDir } from '../session/sessionManager.js';
import { loadMcpConfig } from '../mcp/mcpConfig.js';
import { loadProjectInstructions } from '../config/projectInstructions.js';
import { ProviderRegistry } from '../provider/registry.js';
import { listConfiguredKeys } from '../security/credentials.js';
import { SkillManager } from '../skills/skillManager.js';

export async function doctorCommand(): Promise<void> {
  console.log('\n' + pc.bold(pc.yellow('🏮 Code Lantern Doctor — Diagnostics')));
  console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));

  let issuesFound = 0;
  const config = loadConfig();
  const registry = new ProviderRegistry();
  const skillManager = new SkillManager();

  // 1. Operating System & Architecture
  const platformName = process.platform === 'darwin'
    ? `macOS (${process.arch === 'arm64' ? 'Apple Silicon' : 'Intel'})`
    : process.platform === 'win32'
    ? `Windows (${process.arch})`
    : `${process.platform} (${process.arch})`;
  console.log(`${pc.green('✓')} Platform / OS:          ${platformName}`);

  // 2. Node.js environment
  const nodeVer = process.version;
  const major = parseInt(nodeVer.replace('v', '').split('.')[0], 10);
  if (major >= 18) {
    console.log(`${pc.green('✓')} Node.js Runtime:        ${nodeVer} (compatible)`);
  } else {
    issuesFound++;
    console.log(`${pc.red('✗')} Node.js Runtime:        ${nodeVer} (Node 18+ required)`);
  }

  // 3. Provider & Key Diagnostics
  const activeProviderId = config.activeProvider || 'gemini';
  const activeProvider = registry.getProvider(activeProviderId);
  const keys = listConfiguredKeys();

  console.log(`${pc.green('✓')} Active Provider:        ${pc.bold(activeProvider.displayName)} (${activeProviderId})`);
  console.log(`${pc.green('✓')} Active Model:           ${config.defaultModel}`);

  const activeKeyInfo = keys[activeProviderId];
  if (!activeKeyInfo || !activeKeyInfo.configured) {
    issuesFound++;
    console.log(`${pc.red('✗')} API Key (${activeProviderId}):   Missing!`);
    console.log(pc.yellow(`  → To fix: set environment variable or run 'lantern keys set ${activeProviderId}'`));
  } else {
    const src = activeKeyInfo.source ? `[${activeKeyInfo.source}]` : '';
    console.log(`${pc.green('✓')} API Key (${activeProviderId}):   Found (${activeKeyInfo.maskedKey}) ${src}`);

    // Verify connection to active provider
    try {
      const pingRes = await activeProvider.testConnection();
      if (pingRes.success) {
        console.log(`${pc.green('✓')} Provider Auth & Ping:   Verified (${pingRes.latencyMs}ms latency)`);
      } else {
        issuesFound++;
        console.log(`${pc.red('✗')} Provider Auth & Ping:   Failed: ${pingRes.error}`);
      }
    } catch (err: any) {
      issuesFound++;
      console.log(`${pc.red('✗')} Provider Auth & Ping:   Error: ${err.message}`);
    }
  }

  // 4. Other Configured Providers
  const otherConfigured = Object.entries(keys).filter(([p, k]) => p !== activeProviderId && k.configured);
  if (otherConfigured.length > 0) {
    const others = otherConfigured.map(([p]) => p).join(', ');
    console.log(`${pc.cyan('ℹ')} Additional Providers:   Configured (${others})`);
  }

  // 5. Git integration
  try {
    const gitVer = execSync('git --version', { stdio: 'pipe' }).toString().trim();
    console.log(`${pc.green('✓')} Git CLI:                Available (${gitVer})`);
  } catch {
    console.log(`${pc.yellow('!')} Git CLI:                Not found in PATH (some git tools will be unavailable)`);
  }

  // 6. Configuration & Timeouts
  try {
    const configFile = getConfigFilePath();
    console.log(`${pc.green('✓')} Config File:            ${configFile} (Timeout: ${config.timeoutMs}ms, TTFT: ${config.firstTokenTimeoutMs}ms)`);
  } catch (err: any) {
    issuesFound++;
    console.log(`${pc.red('✗')} Config File:            Invalid: ${err.message}`);
  }

  // 7. Session storage
  try {
    const sessionsDir = getSessionsDir();
    const count = fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json')).length : 0;
    console.log(`${pc.green('✓')} Session Storage:        ${sessionsDir} (${count} stored session(s))`);
  } catch (err: any) {
    issuesFound++;
    console.log(`${pc.red('✗')} Session Storage:        Failed: ${err.message}`);
  }

  // 8. Skills
  const installedSkills = skillManager.listSkills();
  if (installedSkills.length > 0) {
    const activeCount = installedSkills.filter(s => s.enabled).length;
    console.log(`${pc.green('✓')} Skills:                 ${installedSkills.length} installed (${activeCount} active default)`);
  } else {
    console.log(`${pc.cyan('ℹ')} Skills:                 None installed (add with: lantern skills add <path>)`);
  }

  // 9. MCP Servers
  const mcpServers = loadMcpConfig();
  const serverCount = Object.keys(mcpServers).length;
  if (serverCount === 0) {
    console.log(`${pc.cyan('ℹ')} MCP Servers:            No external MCP servers configured (optional)`);
  } else {
    console.log(`${pc.green('✓')} MCP Servers:            ${serverCount} server(s) configured`);
  }

  // 10. Workspace Instructions
  const cwd = process.cwd();
  const instructions = loadProjectInstructions(cwd);
  if (instructions.found) {
    console.log(`${pc.green('✓')} Project Instructions:   Found (${path.basename(instructions.filePath || '')}) in ${cwd}`);
  } else {
    console.log(`${pc.dim('ℹ')} Project Instructions:   None found in workspace (e.g. LANTERN.md, GEMINI.md)`);
  }

  console.log(pc.dim('──────────────────────────────────────────────────────────────────────────────'));
  if (issuesFound === 0) {
    console.log(pc.bold(pc.green('✨ All systems healthy! Code Lantern CLI is ready to assist.')));
  } else {
    console.log(pc.bold(pc.yellow(`⚠️  Doctor found ${issuesFound} issue(s) to address before optimal use.`)));
  }
  console.log('');
}
