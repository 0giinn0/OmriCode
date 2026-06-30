import { ProviderRow, ProviderMessage, ProviderChunk, ConnectionTestResult } from '../types/provider';
import { ToolDefinition } from '../types/tool';
import { BaseProvider } from './BaseProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { OllamaProvider } from './OllamaProvider';
import { OpenRouterProvider } from './OpenRouterProvider';
import { LocalProvider } from './LocalProvider';

type ProviderConstructor = new (row: ProviderRow) => BaseProvider;

const PROVIDER_MAP: Record<string, ProviderConstructor> = {
  'openai': OpenAIProvider, 'anthropic': AnthropicProvider, 'local': LocalProvider,
  'ollama': OllamaProvider, 'openrouter': OpenRouterProvider
};

export class ProviderGateway {
  private cache = new Map<string, BaseProvider>();

  create(row: ProviderRow): BaseProvider {
    const name = row.name.toLowerCase();
    for (const [key, ctor] of Object.entries(PROVIDER_MAP)) { if (name.includes(key)) return new ctor(row); }
    const ep = row.endpoint.toLowerCase();
    if (ep.includes('openai.com')) return new OpenAIProvider(row);
    if (ep.includes('anthropic.com')) return new AnthropicProvider(row);
    if (ep.includes('ollama')) return new OllamaProvider(row);
    if (ep.includes('openrouter.ai')) return new OpenRouterProvider(row);
    return new LocalProvider(row);
  }

  getOrCreate(row: ProviderRow): BaseProvider {
    const cached = this.cache.get(row.id);
    if (cached) return cached;
    const provider = this.create(row);
    this.cache.set(row.id, provider);
    return provider;
  }

  clearCache(): void { this.cache.clear(); }
}
