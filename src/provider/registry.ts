import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openaiProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';
import { OpenRouterProvider } from './openrouterProvider.js';
import { loadConfig, saveConfig } from '../config/config.js';
import type { IProviderAdapter, ProviderTestResult } from './types.js';
import type { ProviderConfig, ProviderModelInfo } from '../types.js';

export class ProviderRegistry {
  private providers: Map<string, IProviderAdapter> = new Map();

  constructor() {
    this.registerBuiltins();
    this.loadCustomProviders();
  }

  private registerBuiltins(): void {
    const gemini = new GeminiProvider();
    const openai = new OpenAIProvider();
    const anthropic = new AnthropicProvider();
    const openrouter = new OpenRouterProvider();

    this.providers.set(gemini.id, gemini);
    this.providers.set(openai.id, openai);
    this.providers.set(anthropic.id, anthropic);
    this.providers.set(openrouter.id, openrouter);
  }

  private loadCustomProviders(): void {
    const config = loadConfig();
    if (config.providers) {
      for (const [id, provConfig] of Object.entries(config.providers)) {
        if (!provConfig.disabled) {
          const adapter = new OpenAIProvider({
            id,
            name: provConfig.name || id,
            displayName: provConfig.name || id,
            baseUrl: provConfig.baseUrl,
            defaultModel: provConfig.defaultModel || 'default',
            headers: provConfig.headers
          });
          this.providers.set(id, adapter);
        }
      }
    }
  }

  public getProvider(id?: string): IProviderAdapter {
    const targetId = (id || loadConfig().activeProvider || 'gemini').toLowerCase();
    const provider = this.providers.get(targetId);

    if (provider) {
      return provider;
    }

    // Default to gemini if not found
    const gemini = this.providers.get('gemini');
    if (gemini) return gemini;

    // Return the first available provider
    const first = Array.from(this.providers.values())[0];
    if (first) return first;

    throw new Error(`No provider adapter registered for '${targetId}'.`);
  }

  public hasProvider(id: string): boolean {
    return this.providers.has(id.toLowerCase());
  }

  public listProviders(): Array<{
    id: string;
    name: string;
    displayName: string;
    isConfigured: boolean;
    maskedKey: string;
    defaultModel: string;
    isActive: boolean;
  }> {
    const activeId = (loadConfig().activeProvider || 'gemini').toLowerCase();
    return Array.from(this.providers.values()).map(p => ({
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      isConfigured: p.isConfigured(),
      maskedKey: p.getMaskedKey(),
      defaultModel: p.defaultModel,
      isActive: p.id === activeId
    }));
  }

  public registerCustomProvider(cfg: ProviderConfig): void {
    const id = cfg.id.toLowerCase();
    const adapter = new OpenAIProvider({
      id,
      name: cfg.name || id,
      displayName: cfg.name || id,
      baseUrl: cfg.baseUrl,
      defaultModel: cfg.defaultModel || 'default',
      headers: cfg.headers
    });

    this.providers.set(id, adapter);

    // Save to persistent config
    const currentConfig = loadConfig();
    if (!currentConfig.providers) currentConfig.providers = {};
    currentConfig.providers[id] = cfg;
    saveConfig(currentConfig);
  }

  public removeCustomProvider(id: string): boolean {
    const norm = id.toLowerCase();
    const builtins = ['gemini', 'openai', 'anthropic', 'openrouter'];
    if (builtins.includes(norm)) {
      return false; // Cannot remove native builtins
    }

    const deleted = this.providers.delete(norm);
    const currentConfig = loadConfig();
    if (currentConfig.providers && currentConfig.providers[norm]) {
      delete currentConfig.providers[norm];
      saveConfig(currentConfig);
    }
    return deleted;
  }

  public async testProvider(id?: string): Promise<ProviderTestResult> {
    const p = this.getProvider(id);
    return await p.testConnection();
  }

  public async listModels(providerId?: string, refresh = false): Promise<ProviderModelInfo[]> {
    const p = this.getProvider(providerId);
    return await p.listModels(refresh);
  }
}
