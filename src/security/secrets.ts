import path from 'node:path';
import { getApiKey } from './credentials.js';

// Known secret file patterns to block from automatic reads or prompts
const SECRET_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /^id_rsa/i,
  /^id_dsa/i,
  /^id_ecdsa/i,
  /^id_ed25519/i,
  /service[_-]?account.*\.json$/i,
  /credentials.*\.json$/i,
  /\.keystore$/i,
  /\.token$/i,
  /\.secret/i
];

export function isSecretFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return SECRET_FILE_PATTERNS.some(pattern => pattern.test(base));
}

export function sanitizeSecrets(text: string): string {
  if (!text) return text;
  let sanitized = text;

  // Mask Google API keys (AIza followed by 30 to 40 alphanumeric/dash/underscore chars)
  sanitized = sanitized.replace(/AIza[0-9A-Za-z\-_]{30,40}/g, 'AIza***********************************');

  // Mask OpenAI keys
  sanitized = sanitized.replace(/sk-(?:proj-)?[A-Za-z0-9_\-]{32,}/g, 'sk-************************************');

  // Mask Anthropic keys
  sanitized = sanitized.replace(/sk-ant-[A-Za-z0-9_\-]{32,}/g, 'sk-ant-********************************');

  // Mask OpenRouter keys
  sanitized = sanitized.replace(/sk-or-v1-[A-Za-z0-9_\-]{32,}/g, 'sk-or-v1-******************************');

  // Mask GitHub tokens
  sanitized = sanitized.replace(/ghp_[0-9a-zA-Z]{36}/g, 'ghp_************************************');
  sanitized = sanitized.replace(/github_pat_[0-9a-zA-Z_]{82}/g, 'github_pat_**********************************************************************************');

  // Dynamically redact any active provider keys present in environment
  const envKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.OPENROUTER_API_KEY,
    process.env.CUSTOM_API_KEY
  ];

  for (const envKey of envKeys) {
    if (envKey && envKey.trim().length > 6) {
      sanitized = sanitized.split(envKey.trim()).join('[REDACTED_API_KEY]');
    }
  }

  return sanitized;
}
