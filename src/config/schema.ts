import type { OrbitConfig } from '../types.js';

export const DEFAULT_CONFIG: OrbitConfig = {
  activeProvider: 'gemini',
  defaultModel: 'gemini-3.8-flash',
  maxSteps: 25,
  temperature: 0.2,
  maxOutputTokens: 8192,
  yolo: false,
  theme: 'default',
  autoCompactThreshold: 30, // turns before auto-compacting
  timeoutMs: 60000,
  firstTokenTimeoutMs: 30000,
  showTiming: false,
  lowLatency: false,
  activeSkills: [],
  mcpServers: {},
  providers: {}
};

export const ALLOWED_CONFIG_KEYS = [
  'activeProvider',
  'defaultModel',
  'maxSteps',
  'temperature',
  'maxOutputTokens',
  'yolo',
  'theme',
  'autoCompactThreshold',
  'timeoutMs',
  'firstTokenTimeoutMs',
  'showTiming',
  'lowLatency',
  'activeSkills'
] as const;

export type ConfigKey = (typeof ALLOWED_CONFIG_KEYS)[number];

export function validateConfigValue(key: string, value: unknown): { valid: boolean; error?: string; parsedValue?: unknown } {
  switch (key) {
    case 'activeProvider':
      if (typeof value !== 'string' || value.trim().length === 0) {
        return { valid: false, error: 'activeProvider must be a non-empty string' };
      }
      return { valid: true, parsedValue: value.trim().toLowerCase() };

    case 'defaultModel':
      if (typeof value !== 'string' || value.trim().length === 0) {
        return { valid: false, error: 'defaultModel must be a non-empty string' };
      }
      return { valid: true, parsedValue: value.trim() };

    case 'maxSteps': {
      const num = Number(value);
      if (isNaN(num) || num < 1 || num > 100) {
        return { valid: false, error: 'maxSteps must be a number between 1 and 100' };
      }
      return { valid: true, parsedValue: Math.round(num) };
    }

    case 'temperature': {
      const num = Number(value);
      if (isNaN(num) || num < 0 || num > 2) {
        return { valid: false, error: 'temperature must be a number between 0.0 and 2.0' };
      }
      return { valid: true, parsedValue: num };
    }

    case 'maxOutputTokens': {
      const num = Number(value);
      if (isNaN(num) || num < 256 || num > 65536) {
        return { valid: false, error: 'maxOutputTokens must be between 256 and 65536' };
      }
      return { valid: true, parsedValue: Math.round(num) };
    }

    case 'yolo': {
      if (typeof value === 'boolean') return { valid: true, parsedValue: value };
      if (value === 'true' || value === '1') return { valid: true, parsedValue: true };
      if (value === 'false' || value === '0') return { valid: true, parsedValue: false };
      return { valid: false, error: 'yolo must be a boolean (true/false)' };
    }

    case 'theme': {
      if (value === 'default' || value === 'ocean' || value === 'minimal') {
        return { valid: true, parsedValue: value };
      }
      return { valid: false, error: "theme must be 'default', 'ocean', or 'minimal'" };
    }

    case 'autoCompactThreshold': {
      const num = Number(value);
      if (isNaN(num) || num < 5 || num > 200) {
        return { valid: false, error: 'autoCompactThreshold must be a number between 5 and 200' };
      }
      return { valid: true, parsedValue: Math.round(num) };
    }

    case 'timeoutMs': {
      const num = Number(value);
      if (isNaN(num) || num < 5000) {
        return { valid: false, error: 'timeoutMs must be at least 5000 (ms)' };
      }
      return { valid: true, parsedValue: Math.round(num) };
    }

    case 'firstTokenTimeoutMs': {
      const num = Number(value);
      if (isNaN(num) || num < 3000) {
        return { valid: false, error: 'firstTokenTimeoutMs must be at least 3000 (ms)' };
      }
      return { valid: true, parsedValue: Math.round(num) };
    }

    case 'showTiming': {
      if (typeof value === 'boolean') return { valid: true, parsedValue: value };
      if (value === 'true' || value === '1') return { valid: true, parsedValue: true };
      if (value === 'false' || value === '0') return { valid: true, parsedValue: false };
      return { valid: false, error: 'showTiming must be a boolean (true/false)' };
    }

    case 'lowLatency': {
      if (typeof value === 'boolean') return { valid: true, parsedValue: value };
      if (value === 'true' || value === '1') return { valid: true, parsedValue: true };
      if (value === 'false' || value === '0') return { valid: true, parsedValue: false };
      return { valid: false, error: 'lowLatency must be a boolean (true/false)' };
    }

    case 'activeSkills': {
      if (Array.isArray(value)) {
        return { valid: true, parsedValue: value.map(String) };
      }
      if (typeof value === 'string') {
        return { valid: true, parsedValue: value.split(',').map(s => s.trim()).filter(Boolean) };
      }
      return { valid: false, error: 'activeSkills must be an array of strings or comma-separated string' };
    }

    default:
      return { valid: false, error: `Unknown configuration key: ${key}` };
  }
}
