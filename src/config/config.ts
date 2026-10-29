import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_CONFIG, validateConfigValue, type ConfigKey } from './schema.js';
import type { OrbitConfig } from '../types.js';

export function getLanternHomeDir(): string {
  const customHome = process.env.CODELANTERN_HOME || process.env.LANTERN_HOME;
  if (customHome) {
    if (!fs.existsSync(customHome)) {
      try {
        fs.mkdirSync(customHome, { recursive: true });
      } catch {
        // ignore
      }
    }
    return customHome;
  }

  const defaultDir = path.join(os.homedir(), '.codelantern');
  if (!fs.existsSync(defaultDir)) {
    try {
      fs.mkdirSync(defaultDir, { recursive: true });
    } catch {
      // ignore
    }
  }
  return defaultDir;
}

export function getConfigFilePath(): string {
  return path.join(getLanternHomeDir(), 'config.json');
}

export function loadConfig(): OrbitConfig {
  const configPath = getConfigFilePath();
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);

    const merged: OrbitConfig = {
      ...DEFAULT_CONFIG,
      ...parsed
    };

    if (!merged.mcpServers || typeof merged.mcpServers !== 'object') {
      merged.mcpServers = {};
    }

    return merged;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: OrbitConfig): void {
  const configPath = getConfigFilePath();

  const safeConfig: OrbitConfig = {
    activeProvider: config.activeProvider || DEFAULT_CONFIG.activeProvider,
    defaultModel: config.defaultModel || DEFAULT_CONFIG.defaultModel,
    maxSteps: config.maxSteps || DEFAULT_CONFIG.maxSteps,
    temperature: config.temperature ?? DEFAULT_CONFIG.temperature,
    maxOutputTokens: config.maxOutputTokens || DEFAULT_CONFIG.maxOutputTokens,
    yolo: Boolean(config.yolo),
    theme: config.theme || DEFAULT_CONFIG.theme,
    autoCompactThreshold: config.autoCompactThreshold || DEFAULT_CONFIG.autoCompactThreshold,
    timeoutMs: config.timeoutMs || DEFAULT_CONFIG.timeoutMs,
    firstTokenTimeoutMs: config.firstTokenTimeoutMs || DEFAULT_CONFIG.firstTokenTimeoutMs,
    showTiming: Boolean(config.showTiming),
    lowLatency: Boolean(config.lowLatency),
    activeSkills: Array.isArray(config.activeSkills) ? config.activeSkills : [],
    mcpServers: config.mcpServers || {},
    providers: config.providers || {}
  };

  try {
    fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2), {
      encoding: 'utf8'
    });
  } catch (err: any) {
    console.error(`Warning: Failed to save config to ${configPath}: ${err.message}`);
  }
}

export function setConfigValue(key: string, value: unknown): { success: boolean; error?: string; updatedConfig?: OrbitConfig } {
  const validation = validateConfigValue(key, value);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const current = loadConfig();
  (current as unknown as Record<string, unknown>)[key] = validation.parsedValue;
  saveConfig(current);

  return { success: true, updatedConfig: current };
}

export function getConfigValue<K extends keyof OrbitConfig>(key: K): OrbitConfig[K] {
  const current = loadConfig();
  return current[key];
}
