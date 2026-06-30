/**
 * AnthropicProvider.ts
 * OmriCode — Anthropic Provider
 *
 * Connects to the Anthropic Messages API.
 * Anthropic uses a different request/response format than OpenAI,
 * so we override buildRequestBody() and parse the SSE stream
 * in the Anthropic-specific format.
 *
 * Used when the provider name contains "anthropic" or endpoint contains "anthropic.com".
 */

import { ProviderRow, ProviderMessage, ProviderChunk, ConnectionTestResult } from '../types/provider';
import { ToolDefinition } from '../types/tool';
import { BaseProvider } from './BaseProvider';

export class AnthropicProvider extends BaseProvider {
  constructor(row: ProviderRow) {
    super(row);
  }

  async *sendMessage(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    abortSignal?: AbortSignal
  ): AsyncIterable<ProviderChunk> {
    const body = this.buildAnthropicBody(messages, tools);
    const url = `${this.config.endpoint}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.buildHeaders(),
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      yield {
        type: 'error',
        error: `Anthropic API error (${response.status}): ${errorText}`
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
          const chunk = this.parseAnthropicChunk(line);
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

  /**
   * Anthropic uses a different message format.
   * System prompt is separate from the messages array.
   * Tool use is done via "tool_use" content blocks.
   */
  private buildAnthropicBody(
    messages: ProviderMessage[],
    tools: ToolDefinition[]
  ): Record<string, unknown> {
    const systemMessages = messages.filter(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: true,
      messages: chatMessages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content || ''
      }))
    };

    // System prompt (Anthropic top-level field)
    if (systemMessages.length > 0) {
      body.system = systemMessages.map(m => m.content).join('\n');
    }

    // Tool definitions (Anthropic format)
    if (tools.length > 0) {
      body.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
    }

    return body;
  }

  /**
   * Parse Anthropic SSE event format.
   * Anthropic uses event: ... / data: ... pairs rather than just data:.
   */
  private parseAnthropicChunk(line: string): ProviderChunk | null {
    if (line.startsWith('event: ')) return null;
    if (!line.startsWith('data: ')) return null;

    const data = line.slice(6).trim();
    if (!data) return null;

    try {
      const parsed = JSON.parse(data);
      const type = parsed.type;

      // Content block delta (text streaming)
      if (type === 'content_block_delta' && parsed.delta?.text) {
        return { type: 'text', content: parsed.delta.text };
      }

      // Tool use start
      if (type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
        return {
          type: 'tool_call',
          tool_call: {
            id: parsed.content_block.id || crypto.randomUUID(),
            type: 'function',
            function: {
              name: parsed.content_block.name || '',
              arguments: ''
            }
          }
        };
      }

      // Tool use delta (streaming arguments)
      if (type === 'content_block_delta' && parsed.delta?.partial_json) {
        return {
          type: 'tool_call',
          tool_call: {
            id: '',
            type: 'function',
            function: {
              name: '',
              arguments: parsed.delta.partial_json
            }
          }
        };
      }

      // Message stop
      if (type === 'message_stop') {
        return { type: 'done' };
      }

      return null;
    } catch {
      return null;
    }
  }

  supportsFunctionCalling(): boolean {
    if (this.row.supportsFC === 'auto') return true; // Anthropic supports FC
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
