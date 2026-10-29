import path from 'node:path';

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

// Patterns for potential credentials in text
const SECRET_TEXT_PATTERNS = [
  // Google API keys
  /AIza[0-9A-Za-z-_]{35}/g,
  // Generic token / bearer strings
  /(?:api[_-]?key|secret|token|password|bearer)[ \t]*[:=][ \t]*['"]?([a-zA-Z0-9_\-.~+]{16,})['"]?/gi,
  // GitHub Personal Access Tokens
  /ghp_[0-9a-zA-Z]{36}/g,
  /github_pat_[0-9a-zA-Z_]{82}/g,
  // AWS Access Key ID
  /AKIA[0-9A-Z]{16}/g
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

  // Mask GitHub tokens
  sanitized = sanitized.replace(/ghp_[0-9a-zA-Z]{36}/g, 'ghp_************************************');
  sanitized = sanitized.replace(/github_pat_[0-9a-zA-Z_]{82}/g, 'github_pat_**********************************************************************************');

  // Mask GEMINI_API_KEY if present in environment
  const currentKey = process.env.GEMINI_API_KEY;
  if (currentKey && currentKey.length > 5) {
    sanitized = sanitized.split(currentKey).join('[REDACTED_GEMINI_API_KEY]');
  }

  return sanitized;
}
