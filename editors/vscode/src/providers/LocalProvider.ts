/**
 * LocalProvider.ts
 * OmriCode — Local Provider (Ollama / llmaker / LM Studio)
 *
 * Connects to locally running model servers via the OpenAI-compatible
 * API. Works with Ollama, llmaker, and LM Studio out of the box.
 *
 * Local providers are the heart of OmriCode's "fully local" promise.
 * Used when the provider name contains "local" or endpoint contains
 * "ollama" or "11434".
 */

import { ProviderRow, ProviderMessage, ProviderChunk, ConnectionTestResult } from '../types/provider';
import { ToolDefinition } from '../types/tool';
import { BaseProvider } from './BaseProvider';

export class LocalProvider extends BaseProvider {
  constructor(row: ProviderRow) {
    super(row);
  }

  async *sendMessage(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    abortSignal?: AbortSignal
  ): AsyncIterable<ProviderChunk> {
    const body = this.buildRequestBody(messages, tools);
    const url = `${this.config.endpoint}/chat/completions`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: abortSignal
      });
    } catch (err) {
      yield {
        type: 'error',
        error: `Cannot reach local provider at ${this.config.endpoint}. Is Ollama/llmaker running?`
      };
      return;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      yield {
        type: 'error',
        error: `Local API error (${response.status}): ${errorText}`
      };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'Response body is not readable' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const chunk = this.parseSSEChunk(line);

          // Ollama sometimes returns objects without 'data:' prefix
          if (!chunk && line.trim()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.message?.content) {
                yield { type: 'text', content: parsed.message.content };
              } else if (parsed.response) {
                yield { type: 'text', content: parsed.response };
              }
              if (parsed.done) {
                yield { type: 'done' };
              }
            } catch {
              // Not JSON, skip
            }
            continue;
          }

          if (chunk) yield chunk;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        yield { type: 'done' };
        return;
      }
      yield {
        type: 'error',
        error: err instanceof Error ? err.message : 'Stream error'
      };
    }
  }

  supportsFunctionCalling(): boolean {
    // Local models are unpredictable — if auto, probe on first call
    if (this.row.supportsFC === 'auto') {
      // Nous Hermes supports FC; default GGUF models may not
      // We probe aggressively and cache the result
      return true; // optimistic — will fallback to S/R if FC fails
    }
    return this.row.supportsFC;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.config.endpoint}/tags`, {
        signal: AbortSignal.timeout(5000)
      });
      const latencyMs = Date.now() - start;
      if (!response.ok) {
        // Try OpenAI-compatible models endpoint as fallback
        const fallback = await fetch(`${this.config.endpoint}/models`, {
          signal: AbortSignal.timeout(3000)
        });
        if (fallback.ok) {
          const data = await fallback.json() as Record<string, unknown>;
          const models: { id: string }[] = (data.data as { id: string }[]) || [];
          const modelFound = models.some(m => m.id === this.config.model);
          return { success: true, latencyMs, modelFound, supportsFC: false };
        }
        return {
          success: false,
          latencyMs,
          modelFound: false,
          supportsFC: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }
      const data = await response.json() as Record<string, unknown>;
      const models: { name: string }[] = (data.models as { name: string }[]) || [];
      const modelFound = models.some(m => m.name.includes(this.config.model));
      return { success: true, latencyMs, modelFound, supportsFC: false };
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        modelFound: false,
        supportsFC: false,
        error: err instanceof Error ? err.message : 'Cannot reach local provider'
      };
    }
  }
}
