/**
 * CustomProvider.ts
 * OmriCode — Custom Provider (Generic OpenAI-Compatible)
 *
 * Fallback provider for any OpenAI-compatible API endpoint.
 * Used when the provider name/endpoint doesn't match any
 * known provider (OpenAI, Anthropic, Local).
 *
 * Supports both native FC (if the model supports it) and
 * falls back to SEARCH/REPLACE parsing automatically.
 */

import { ProviderRow, ProviderMessage, ProviderChunk, ConnectionTestResult } from '../types/provider';
import { ToolDefinition } from '../types/tool';
import { BaseProvider } from './BaseProvider';

export class CustomProvider extends BaseProvider {
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
        error: `Cannot reach custom provider at ${this.config.endpoint}: ${
          err instanceof Error ? err.message : 'Connection failed'
        }`
      };
      return;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      yield {
        type: 'error',
        error: `Custom API error (${response.status}): ${errorText}`
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
    // Custom providers are unknown — probe on first use
    if (this.row.supportsFC === 'auto') return false; // be conservative
    return this.row.supportsFC;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.config.endpoint}/models`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(5000)
      });
      const latencyMs = Date.now() - start;
      if (!response.ok) {
        return {
          success: false,
          latencyMs,
          modelFound: false,
          supportsFC: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }
      const data = await response.json() as unknown as Record<string, unknown>;
      const models: { id: string }[] = (data.data as { id: string }[]) || [];
      const modelFound = models.some(m => m.id === this.config.model);

      // Probe FC support by checking if model name hints at function calling
      const fcHints = ['function', 'tool', 'instruct', 'hermes', 'mistral', 'gpt', 'claude'];
      const supportsFC = fcHints.some(hint => this.config.model.toLowerCase().includes(hint));

      return { success: true, latencyMs, modelFound, supportsFC };
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        modelFound: false,
        supportsFC: false,
        error: err instanceof Error ? err.message : 'Connection failed'
      };
    }
  }
}
