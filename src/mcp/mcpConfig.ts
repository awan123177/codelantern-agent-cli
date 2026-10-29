import fs from 'node:fs';
import path from 'node:path';
import { getLanternHomeDir } from '../config/config.js';
import type { McpServerConfig } from '../types.js';

export function getMcpConfigPath(): string {
  return path.join(getLanternHomeDir(), 'mcp.json');
}

export function loadMcpConfig(): Record<string, McpServerConfig> {
  const filePath = getMcpConfigPath();
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return (parsed.mcpServers || parsed) as Record<string, McpServerConfig>;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveMcpConfig(servers: Record<string, McpServerConfig>): void {
  const filePath = getMcpConfigPath();
  const data = { mcpServers: servers };
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf8' });
  } catch (err: any) {
    console.error(`Warning: Failed to save MCP config: ${err.message}`);
  }
}

export function addMcpServer(name: string, config: McpServerConfig): void {
  const current = loadMcpConfig();
  current[name] = config;
  saveMcpConfig(current);
}

export function removeMcpServer(name: string): boolean {
  const current = loadMcpConfig();
  if (current[name]) {
    delete current[name];
    saveMcpConfig(current);
    return true;
  }
  return false;
}

export function toggleMcpServer(name: string, disabled: boolean): boolean {
  const current = loadMcpConfig();
  if (current[name]) {
    current[name].disabled = disabled;
    saveMcpConfig(current);
    return true;
  }
  return false;
}
