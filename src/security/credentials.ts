import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { getLanternHomeDir } from '../config/config.js';
import { NativeCredentialStore } from './nativeStore.js';

export const SERVICE_NAME = 'codelantern';

const PROVIDER_ENV_VARS: Record<string, string[]> = {
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  custom: ['CUSTOM_API_KEY', 'OPENAI_API_KEY']
};

export function getLegacyCredentialsFilePath(): string {
  return path.join(getLanternHomeDir(), 'credentials.json');
}

/**
 * Returns user-friendly name of the active OS credential store
 */
export function getStoreName(): string {
  return NativeCredentialStore.getInstance().getStoreName();
}

/**
 * Derives a machine-unique 256-bit encryption key (used for legacy decryption/migration)
 */
function getLegacyMachineKey(): Buffer {
  const salt = `codelantern_${os.hostname()}_${os.userInfo().username}`;
  const secret = `${os.homedir()}_${process.platform}_${os.arch()}`;
  return crypto.scryptSync(secret, salt, 32);
}

export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const key = getLegacyMachineKey();
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
    const key = getLegacyMachineKey();

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

export interface KeyResult {
  key: string | null;
  source?: 'env' | 'store';
  sourceDescription?: string;
}

export interface MigrationReport {
  attempted: boolean;
  migratedProviders: string[];
  failedProviders: string[];
}

let migrationPerformed = false;

/**
 * Automatically migrates existing credentials from legacy ~/.codelantern/credentials.json
 * into the native OS credential store (Keychain on macOS, Windows Credential Manager on Windows).
 * Verifies each key's retrieval before removing from the legacy vault to ensure crash safety.
 */
export function migrateLegacyCredentials(force = false): MigrationReport {
  if (migrationPerformed && !force) {
    return { attempted: false, migratedProviders: [], failedProviders: [] };
  }
  migrationPerformed = true;

  const legacyPath = getLegacyCredentialsFilePath();
  if (!fs.existsSync(legacyPath)) {
    return { attempted: false, migratedProviders: [], failedProviders: [] };
  }

  const store = NativeCredentialStore.getInstance();
  if (!store.isAvailable()) {
    return { attempted: false, migratedProviders: [], failedProviders: [] };
  }

  let legacyData: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(legacyPath, 'utf8');
    legacyData = JSON.parse(raw);
  } catch {
    return { attempted: true, migratedProviders: [], failedProviders: [] };
  }

  const providers = Object.keys(legacyData);
  if (providers.length === 0) {
    try { fs.rmSync(legacyPath, { force: true }); } catch {}
    return { attempted: true, migratedProviders: [], failedProviders: [] };
  }

  const migratedProviders: string[] = [];
  const failedProviders: string[] = [];

  for (const provider of providers) {
    const encrypted = legacyData[provider];
    if (!encrypted) continue;

    const decryptedKey = decryptSecret(encrypted);
    if (!decryptedKey || decryptedKey.trim().length === 0) {
      failedProviders.push(provider);
      continue;
    }

    // 1. Save into OS credential store
    const saved = store.set(SERVICE_NAME, provider.toLowerCase(), decryptedKey.trim());
    if (!saved) {
      failedProviders.push(provider);
      continue;
    }

    // 2. Verify retrieval from OS credential store before removing legacy copy
    const verified = store.get(SERVICE_NAME, provider.toLowerCase());
    if (verified !== decryptedKey.trim()) {
      failedProviders.push(provider);
      continue;
    }

    // 3. Successfully verified in OS store: remove from legacy vault
    migratedProviders.push(provider);
    delete legacyData[provider];

    // Persist removal immediately so partial migration is crash-safe
    try {
      fs.writeFileSync(legacyPath, JSON.stringify(legacyData, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      });
    } catch {
      // ignore write error
    }
  }

  // If all keys have been successfully migrated, safely clean up legacy file
  if (Object.keys(legacyData).length === 0) {
    try {
      fs.rmSync(legacyPath, { force: true });
    } catch {
      // ignore
    }
  }

  return {
    attempted: true,
    migratedProviders,
    failedProviders
  };
}

/**
 * Retrieves the API key for a given provider with explicit precedence:
 * 1. Environment variables (GEMINI_API_KEY, etc.)
 * 2. Native OS credential store (macOS Keychain, Windows Credential Manager)
 */
export function getApiKey(provider: string): KeyResult {
  const norm = provider.toLowerCase();

  // 1. Check environment variables first (explicit override)
  const envVarNames = PROVIDER_ENV_VARS[norm] || [`${norm.toUpperCase()}_API_KEY`];
  for (const envVar of envVarNames) {
    const val = process.env[envVar];
    if (val && val.trim().length > 0) {
      return {
        key: val.trim(),
        source: 'env',
        sourceDescription: `env: ${envVar}`
      };
    }
  }

  // 2. Run legacy migration if needed
  migrateLegacyCredentials();

  // 3. Query native OS credential store
  const store = NativeCredentialStore.getInstance();
  const storedKey = store.get(SERVICE_NAME, norm);
  if (storedKey && storedKey.trim().length > 0) {
    return {
      key: storedKey.trim(),
      source: 'store',
      sourceDescription: store.getStoreName()
    };
  }

  // 4. Fallback checks across potential alternative service and account names
  const fallbackTargets = [
    { service: 'lantern', account: norm },
    { service: 'orbit', account: norm },
    { service: norm, account: norm },
    { service: norm, account: 'default' },
    { service: norm, account: 'api_key' },
    { service: norm, account: 'antigravity' }
  ];

  if (norm === 'gemini') {
    fallbackTargets.push(
      { service: 'Google Gemini', account: 'gemini' },
      { service: 'Google Gemini', account: 'default' },
      { service: 'Google Gemini', account: 'api_key' },
      { service: 'Google Gemini', account: 'antigravity' },
      { service: 'gemini', account: 'antigravity' }
    );
  }

  for (const target of fallbackTargets) {
    try {
      const fbKey = store.get(target.service, target.account);
      if (fbKey && fbKey.trim().length > 0) {
        // Automatically mirror to primary SERVICE_NAME:norm
        try {
          store.set(SERVICE_NAME, norm, fbKey.trim());
        } catch {}
        return {
          key: fbKey.trim(),
          source: 'store',
          sourceDescription: `${store.getStoreName()} (${target.service})`
        };
      }
    } catch {
      // ignore
    }
  }

  return { key: null };
}

/**
 * Securely saves an API key to the native OS credential store.
 * Verifies that the saved key can be retrieved before returning.
 */
export function setApiKey(provider: string, apiKey: string): void {
  const norm = provider.toLowerCase();
  const cleanKey = apiKey.trim();

  if (!cleanKey) {
    throw new Error('API key cannot be empty.');
  }

  const store = NativeCredentialStore.getInstance();
  if (!store.isAvailable()) {
    throw new Error(
      `Secure OS credential store (${store.getStoreName()}) is unavailable on this system.\n` +
      `Please set your key using an environment variable:\n` +
      `  export ${norm.toUpperCase()}_API_KEY="your-api-key"`
    );
  }

  const ok = store.set(SERVICE_NAME, norm, cleanKey);
  if (!ok) {
    throw new Error(`Failed to write API key for '${provider}' to ${store.getStoreName()}.`);
  }

  // Verify retrieval immediately
  const check = store.get(SERVICE_NAME, norm);
  if (check !== cleanKey) {
    throw new Error(`Verification error: Stored key for '${provider}' could not be read back from ${store.getStoreName()}.`);
  }
}

/**
 * Removes an API key from the native OS credential store.
 */
export function removeApiKey(provider: string): boolean {
  const norm = provider.toLowerCase();
  const store = NativeCredentialStore.getInstance();
  const deletedFromStore = store.delete(SERVICE_NAME, norm);

  // Also ensure removal from legacy file if it still exists
  const legacyPath = getLegacyCredentialsFilePath();
  if (fs.existsSync(legacyPath)) {
    try {
      const raw = fs.readFileSync(legacyPath, 'utf8');
      const data = JSON.parse(raw);
      if (data[norm]) {
        delete data[norm];
        fs.writeFileSync(legacyPath, JSON.stringify(data, null, 2), {
          encoding: 'utf8',
          mode: 0o600
        });
      }
    } catch {
      // ignore
    }
  }

  return deletedFromStore;
}

export interface ConfiguredKeyInfo {
  configured: boolean;
  source?: 'env' | 'store';
  sourceDescription: string;
  maskedKey: string;
}

/**
 * Lists all configured provider keys, indicating source and masked representation.
 * Never exposes plaintext keys.
 */
export function listConfiguredKeys(): Record<string, ConfiguredKeyInfo> {
  migrateLegacyCredentials();
  const providers = ['gemini', 'openai', 'anthropic', 'openrouter', 'custom'];
  const result: Record<string, ConfiguredKeyInfo> = {};

  for (const p of providers) {
    const { key, source, sourceDescription } = getApiKey(p);
    result[p] = {
      configured: Boolean(key),
      source,
      sourceDescription: sourceDescription ? `[${sourceDescription}]` : 'none',
      maskedKey: key ? maskApiKey(key) : '(not configured)'
    };
  }

  return result;
}

/**
 * Prompts the user interactively with a masked prompt ('*').
 * Keystrokes are not echoed in plaintext to the terminal.
 */
export async function promptMaskedApiKey(query: string): Promise<string> {
  const promptText = query.endsWith(': ') ? query : `${query}: `;

  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      let resolved = false;
      const done = (val: string) => {
        if (!resolved) {
          resolved = true;
          rl.close();
          try {
            process.stdin.pause();
            process.stdin.unref();
          } catch {}
          resolve(val.trim());
        }
      };
      rl.question(promptText, (ans) => {
        done(ans);
      });
      rl.once('close', () => {
        done('');
      });
    });
  }

  return new Promise((resolve) => {
    process.stdout.write(promptText);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let key = '';
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      try {
        process.stdin.removeListener('data', onData);
        process.stdin.removeListener('error', onError);
        process.stdin.removeListener('end', onEnd);
        process.stdin.setRawMode(wasRaw ?? false);
        process.stdin.pause();
        process.stdin.unref();
      } catch {
        // ignore
      }
    };

    const onError = () => {
      cleanup();
      resolve('');
    };

    const onEnd = () => {
      cleanup();
      process.stdout.write('\n');
      resolve(key.trim());
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') { // Ctrl+C
          cleanup();
          process.stdout.write('\n');
          process.exit(130);
        } else if (char === '\u0004') { // Ctrl+D (EOF)
          cleanup();
          process.stdout.write('\n');
          resolve(key.trim());
          return;
        } else if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(key.trim());
          return;
        } else if (char === '\u0008' || char === '\u007f') { // Backspace
          if (key.length > 0) {
            key = key.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (char >= ' ') {
          key += char;
          process.stdout.write('*');
        }
      }
    };

    process.stdin.on('data', onData);
    process.stdin.once('error', onError);
    process.stdin.once('end', onEnd);
  });
}
