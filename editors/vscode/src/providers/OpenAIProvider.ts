/**
 * OpenAIProvider.ts
 * OmriCode — OpenAI Provider
 *
 * Connects to the OpenAI API (or any OpenAI-compatible endpoint).
 * Supports native function calling and streaming.
 * Used when the provider name contains "openai" or endpoint contains "openai.com".
 */

import { ProviderRow, ProviderMessage, ProviderChunk, ConnectionTestResult } from '../types/provider';
import { ToolDefinition } from '../types/tool';
import { BaseProvider } from './BaseProvider';

export class OpenAIProvider extends BaseProvider {
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

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      yield {
        type: 'error',
        error: `OpenAI API error (${response.status}): ${errorText}`
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
    if (this.row.supportsFC === 'auto') return true; // OpenAI always supports FC
    return this.row.supportsFC;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.config.endpoint}/models`, {
        headers: this.buildHeaders()
      });
      const latencyMs = Date.now() - start;
      if (!response.ok) {
        return {
          success: false,
          latencyMs,
          modelFound: false,
          supportsFC: true,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }
      const data = await response.json() as Record<string, unknown>;
      const models: { id: string }[] = (data.data as { id: string }[]) || [];
      const modelFound = models.some(m => m.id === this.config.model);
      return { success: true, latencyMs, modelFound, supportsFC: true };
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        modelFound: false,
        supportsFC: true,
        error: err instanceof Error ? err.message : 'Connection failed'
      };
    }
  }
}
