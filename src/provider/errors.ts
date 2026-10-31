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

export class ConnectionTimeoutError extends TimeoutError {
  public provider: string;
  public model: string;

  constructor(timeoutMs: number, providerOrOp = 'Provider', model = '') {
    const isOp = providerOrOp.includes(' ') || !model;
    const desc = isOp ? providerOrOp : `Connection to ${providerOrOp} (${model})`;
    super(timeoutMs, desc);
    const target = model ? `Connection to ${providerOrOp} (${model})` : providerOrOp;
    this.message = `${target} timed out after ${(timeoutMs / 1000).toFixed(1)}s waiting for response headers.`;
    this.name = 'ConnectionTimeoutError';
    this.provider = providerOrOp;
    this.model = model;
  }
}

export class TotalTimeoutError extends TimeoutError {
  public provider: string;
  public model: string;

  constructor(timeoutMs: number, providerOrOp = 'Request', model = '') {
    const isOp = providerOrOp.includes(' ') || !model;
    const desc = isOp ? providerOrOp : `Request to ${providerOrOp} (${model})`;
    super(timeoutMs, desc);
    const target = model ? `Request to ${providerOrOp} (${model})` : providerOrOp;
    this.message = `${target} timed out after ${(timeoutMs / 1000).toFixed(1)}s total elapsed time.`;
    this.name = 'TotalTimeoutError';
    this.provider = providerOrOp;
    this.model = model;
  }
}

export class FirstTokenTimeoutError extends Error {
  public timeoutMs: number;
  public provider: string;
  public model: string;
  constructor(timeoutMs: number, provider: string, model: string) {
    super(`Connection to ${provider} (${model}) timed out after ${(timeoutMs / 1000).toFixed(1)}s waiting for the first token.`);
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
  public model: string;
  public provider: string;
  public suggestions?: string[];

  constructor(model: string, provider: string, suggestions?: string[]) {
    const list = suggestions && suggestions.length > 0 ? `\nAvailable models: ${suggestions.join(', ')}` : '';
    super(`Model '${model}' not found or not available for provider '${provider}'.${list}`);
    this.name = 'ModelNotFoundError';
    this.model = model;
    this.provider = provider;
    this.suggestions = suggestions;
  }
}

export class EmptyResponseError extends Error {
  public provider: string;
  public model: string;

  constructor(provider = 'Provider', model = '') {
    super(`Provider '${provider}' returned an empty response for model '${model}'.`);
    this.name = 'EmptyResponseError';
    this.provider = provider;
    this.model = model;
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
  if (err instanceof EmptyResponseError) {
    return (
      pc.red(`\n❌ ${sanitizeSecrets(err.message)}\n`) +
      pc.yellow(
        `  Tip: The model returned no text or tool calls.\n` +
        `       - This often occurs if the prompt or loaded skills exceeded the model's context or rate limit.\n` +
        `       - Retry with '--no-skills' to reduce prompt size: lantern ask --no-skills "..."\n` +
        `       - Or switch to another model using '/model' or '--model <model-id>'.`
      )
    );
  }
  if (err instanceof CancelledError) {
    return pc.yellow(`\n[Cancelled] ${sanitizeSecrets(err.message)}`);
  }
  if (err instanceof ConnectionTimeoutError) {
    return (
      pc.red(`\n⏱️ ${sanitizeSecrets(err.message)}\n`) +
      pc.yellow(`  Tip: The provider server did not acknowledge the connection in time.\n` +
                `       Adjust connection timeout with '--connect-timeout <ms>' or check network reachability.\n` +
                `       Test connection with: 'lantern providers test ${err.provider.toLowerCase()}'`)
    );
  }
  if (err instanceof FirstTokenTimeoutError) {
    return (
      pc.red(`\n⏱️ ${sanitizeSecrets(err.message)}\n`) +
      pc.yellow(`  Tip: Connection was established, but the model took too long to begin streaming tokens.\n` +
                `       Adjust first-token timeout with '--first-token-timeout <ms>' or switch to a faster model with '/model'.`)
    );
  }
  if (err instanceof TotalTimeoutError || err instanceof TimeoutError) {
    return (
      pc.red(`\n⏱️ ${sanitizeSecrets(err.message)}\n`) +
      pc.yellow(`  Tip: Generation exceeded the total request time limit.\n` +
                `       Increase limit with '--timeout <ms>' or 'lantern config set timeoutMs <ms>'.`)
    );
  }
  if (err instanceof MissingApiKeyError) {
    return pc.red(`\n${sanitizeSecrets(err.message)}`);
  }
  if (err instanceof RateLimitError) {
    return pc.yellow(`\n⚠️ ${sanitizeSecrets(err.message)}`);
  }
  if (err instanceof AuthenticationError) {
    return pc.red(`\n🔒 ${sanitizeSecrets(err.message)}`);
  }
  if (err instanceof ModelNotFoundError) {
    return (
      pc.red(`\n🔍 ${sanitizeSecrets(err.message)}\n`) +
      pc.yellow(`  Tip: Run '/model' inside Lantern or 'lantern models list' to view and select available models for your account.`)
    );
  }
  if (err instanceof Error) {
    const msg = sanitizeSecrets(err.message || '');
    if (msg.includes('API_KEY_INVALID') || msg.includes('401') || msg.includes('Incorrect API key') || msg.includes('API key not valid')) {
      return pc.red(`Authentication failed: Invalid API key. Update it with 'lantern keys set <provider>'.`);
    }
    if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
      return pc.yellow('Rate limit or quota reached. Please wait a few seconds before retrying.');
    }
    if (msg.includes('AbortError') || msg.includes('aborted') || msg.includes('canceled')) {
      return pc.yellow('[Request aborted]');
    }
    return pc.red(`Error: ${msg}`);
  }
  return pc.red(`An unexpected error occurred: ${sanitizeSecrets(String(err))}`);
}
