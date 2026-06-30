/**
 * ProviderGateway.ts
 * OmriCode — Provider Gateway (Router)
 *
 * Routes agent requests to the correct provider based on
 * the active row in the ProviderTable. Normalizes all
 * provider responses into OmriCode's internal format.
 *
 * Flow:
 *   AgentLoop → ProviderGateway.send() → active Provider.sendMessage()
 *   Provider returns AsyncIterable<ProviderChunk> → AgentLoop
 */

import { ProviderRow, ProviderMessage, ProviderChunk, ConnectionTestResult } from '../types/provider';
import { ToolDefinition } from '../types/tool';
import { BaseProvider } from './BaseProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { LocalProvider } from './LocalProvider';
import { CustomProvider } from './CustomProvider';
import { ConfigManager } from '../config/ConfigManager';

type ProviderConstructor = new (row: ProviderRow) => BaseProvider;

/**
 * Maps provider name prefixes to their constructor.
 * When adding a new provider type, register it here.
 */
const PROVIDER_MAP: Record<string, ProviderConstructor> = {
  'openai': OpenAIProvider,
  'anthropic': AnthropicProvider,
  'local': LocalProvider,
  'custom': CustomProvider
};

export class ProviderGateway {
  private configManager: ConfigManager;
  /** Cache of instantiated providers keyed by row ID */
  private providerCache: Map<string, BaseProvider> = new Map();

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
  }

  /**
   * Detects the provider class based on the row name/endpoint.
   */
  private detectProviderClass(row: ProviderRow): ProviderConstructor {
    const name = row.name.toLowerCase();
    for (const [key, ctor] of Object.entries(PROVIDER_MAP)) {
      if (name.includes(key)) return ctor;
    }
    // Check endpoint patterns
    const ep = row.endpoint.toLowerCase();
    if (ep.includes('openai.com')) return OpenAIProvider;
    if (ep.includes('anthropic.com')) return AnthropicProvider;
    if (ep.includes('ollama') || ep.includes('11434')) return LocalProvider;
    return CustomProvider;
  }

  /**
   * Returns the instantiated provider for the active row.
   * Caches by row ID so re-instantiation is avoided.
   */
  getActiveProvider(): BaseProvider | undefined {
    const active = this.configManager.getActiveProvider();
    if (!active) return undefined;

    // Return cached if still the same row
    const cached = this.providerCache.get(active.id);
    if (cached) return cached;

    // Instantiate and cache
    const Ctor = this.detectProviderClass(active);
    const provider = new Ctor(active);
    this.providerCache.set(active.id, provider);
    return provider;
  }

  /**
   * Send messages to the active provider and stream response chunks.
   */
  async *send(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    abortSignal?: AbortSignal
  ): AsyncIterable<ProviderChunk> {
    const provider = this.getActiveProvider();
    if (!provider) {
      yield {
        type: 'error',
        error: 'No active provider configured. Open OmriCode settings to add one.'
      };
      return;
    }

    yield* provider.sendMessage(messages, tools, abortSignal);
  }

  /**
   * Test connection to the active provider.
   */
  async testActiveProvider(): Promise<ConnectionTestResult> {
    const provider = this.getActiveProvider();
    if (!provider) {
      return {
        success: false,
        latencyMs: 0,
        modelFound: false,
        supportsFC: false,
        error: 'No active provider configured.'
      };
    }
    return provider.testConnection();
  }

  /**
   * Test connection to a specific provider by row.
   */
  async testProviderRow(row: ProviderRow): Promise<ConnectionTestResult> {
    const Ctor = this.detectProviderClass(row);
    const provider = new Ctor(row);
    return provider.testConnection();
  }

  /**
   * Check if the active provider supports function calling.
   */
  supportsFunctionCalling(): boolean | Promise<boolean> {
    const provider = this.getActiveProvider();
    if (!provider) return false;
    return provider.supportsFunctionCalling();
  }

  /**
   * Clear the provider cache (e.g. when settings change).
   */
  clearCache(): void {
    this.providerCache.clear();
  }
}
