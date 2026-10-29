import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { getLanternHomeDir } from '../config/config.js';

const PROVIDER_ENV_VARS: Record<string, string[]> = {
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  custom: ['CUSTOM_API_KEY', 'OPENAI_API_KEY']
};

function getCredentialsFilePath(): string {
  return path.join(getLanternHomeDir(), 'credentials.json');
}

/**
 * Derives a machine-unique 256-bit encryption key
 */
function getMachineDerivedKey(): Buffer {
  const salt = `codelantern_${os.hostname()}_${os.userInfo().username}`;
  const secret = `${os.homedir()}_${process.platform}_${os.arch()}`;
  return crypto.scryptSync(secret, salt, 32);
}

export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const key = getMachineDerivedKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptSecret(encryptedPayload: string): string | null {
  try {
    const parts = encryptedPayload.split(':');
    if (parts.length !== 3) return null;

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = getMachineDerivedKey();

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

export function maskApiKey(key: string): string {
  if (!key) return '(not configured)';
  const clean = key.trim();
  if (clean.length <= 8) return '********';
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}

export function getApiKey(provider: string): { key: string | null; source?: 'env' | 'store' } {
  const norm = provider.toLowerCase();

  // 1. Check environment variables first
  const envVarNames = PROVIDER_ENV_VARS[norm] || [`${norm.toUpperCase()}_API_KEY`];
  for (const envVar of envVarNames) {
    const val = process.env[envVar];
    if (val && val.trim().length > 0) {
      return { key: val.trim(), source: 'env' };
    }
  }

  // 2. Check encrypted store
  const filePath = getCredentialsFilePath();
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (data[norm]) {
        const decrypted = decryptSecret(data[norm]);
        if (decrypted) {
          return { key: decrypted, source: 'store' };
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return { key: null };
}

export function setApiKey(provider: string, apiKey: string): void {
  const norm = provider.toLowerCase();
  const filePath = getCredentialsFilePath();
  let data: Record<string, string> = {};

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      data = JSON.parse(raw);
    } catch {
      data = {};
    }
  }

  data[norm] = encryptSecret(apiKey.trim());

  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
  } catch (err: any) {
    console.error(`Warning: Failed to save credentials: ${err.message}`);
  }
}

export function removeApiKey(provider: string): boolean {
  const norm = provider.toLowerCase();
  const filePath = getCredentialsFilePath();
  if (!fs.existsSync(filePath)) return false;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data[norm]) {
      delete data[norm];
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      });
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

export function listConfiguredKeys(): Record<string, { configured: boolean; source?: 'env' | 'store'; maskedKey: string }> {
  const providers = ['gemini', 'openai', 'anthropic', 'openrouter', 'custom'];
  const result: Record<string, { configured: boolean; source?: 'env' | 'store'; maskedKey: string }> = {};

  for (const p of providers) {
    const { key, source } = getApiKey(p);
    result[p] = {
      configured: Boolean(key),
      source,
      maskedKey: key ? maskApiKey(key) : '(not configured)'
    };
  }

  return result;
}
