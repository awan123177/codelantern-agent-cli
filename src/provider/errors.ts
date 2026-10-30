import pc from 'picocolors';
import { sanitizeSecrets } from '../security/secrets.js';

export class TimeoutError extends Error {
  public timeoutMs: number;
  constructor(timeoutMs: number, operation = 'Request') {
    super(`${operation} timed out after ${(timeoutMs / 1000).toFixed(1)}s.`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class FirstTokenTimeoutError extends Error {
  public timeoutMs: number;
  public provider: string;
  public model: string;
  constructor(timeoutMs: number, provider: string, model: string) {
    super(`No response tokens received from ${provider} (${model}) after ${(timeoutMs / 1000).toFixed(1)}s.`);
    this.name = 'FirstTokenTimeoutError';
    this.timeoutMs = timeoutMs;
    this.provider = provider;
    this.model = model;
  }
}

export class CancelledError extends Error {
  constructor(message = 'Operation cancelled by user (Ctrl+C).') {
    super(message);
    this.name = 'CancelledError';
  }
}

export class MissingApiKeyError extends Error {
  public provider: string;
  constructor(provider = 'gemini', envVar = 'GEMINI_API_KEY') {
    super(
      `API key for provider '${provider}' is not configured.\n\n` +
      `To resolve this:\n` +
      `  1. Set the environment variable:\n` +
      `     export ${envVar}="your-api-key-here"\n` +
      `  2. Or store it securely using Lantern:\n` +
      `     lantern keys set ${provider}\n`
    );
    this.name = 'MissingApiKeyError';
    this.provider = provider;
  }
}

export class RateLimitError extends Error {
  constructor(message = 'API rate limit exceeded.') {
    super(`${message}\nPlease wait a moment before trying again or check your account quota.`);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends Error {
  constructor(message = 'Authentication failed.') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class ModelNotFoundError extends Error {
  constructor(model: string, provider: string) {
    super(`Model '${model}' not found or not available for provider '${provider}'.`);
    this.name = 'ModelNotFoundError';
  }
}

export class LanternProviderError extends Error {
  public statusCode?: number;
  public provider?: string;

  constructor(message: string, statusCode?: number, provider?: string) {
    super(message);
    this.name = 'LanternProviderError';
    this.statusCode = statusCode;
    this.provider = provider;
  }
}

export function formatErrorMessage(err: unknown): string {
  if (err instanceof CancelledError) {
    return pc.yellow(`\n[Cancelled] ${err.message}`);
  }
  if (err instanceof FirstTokenTimeoutError) {
    return pc.red(`\n⏱️ ${err.message}\n` + pc.yellow(`  Tip: Check your network connection or try lowering temperature or setting a faster model with 'lantern model set <id>'.`));
  }
  if (err instanceof TimeoutError) {
    return pc.red(`\n⏱️ ${err.message}\n` + pc.yellow(`  Tip: You can increase the timeout limit using 'lantern config set timeoutMs 120000'.`));
  }
  if (err instanceof MissingApiKeyError) {
    return pc.red(`\n${err.message}`);
  }
  if (err instanceof RateLimitError) {
    return pc.yellow(`\n⚠️ ${err.message}`);
  }
  if (err instanceof AuthenticationError) {
    return pc.red(`\n🔒 ${err.message}`);
  }
  if (err instanceof ModelNotFoundError) {
    return pc.red(`\n🔍 ${err.message}\n` + pc.dim(`Run 'lantern models list' to view available models for your account.`));
  }
  if (err instanceof Error) {
    const msg = err.message || '';
    if (msg.includes('API_KEY_INVALID') || msg.includes('401') || msg.includes('Incorrect API key')) {
      return pc.red(`Authentication failed: Invalid API key. Update it with 'lantern keys set <provider>'.`);
    }
    if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
      return pc.yellow('Rate limit or quota reached. Please wait a few seconds before retrying.');
    }
    if (msg.includes('AbortError') || msg.includes('aborted') || msg.includes('canceled')) {
      return pc.yellow('[Request aborted]');
    }
    return pc.red(`Error: ${sanitizeSecrets(msg)}`);
  }
  return pc.red(`An unexpected error occurred: ${sanitizeSecrets(String(err))}`);
}
