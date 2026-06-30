/**
 * BaseProvider.ts
 * OmriCode — Abstract Base Provider
 *
 * All providers extend this class. It defines the contract
 * that every LLM provider must implement: sendMessage()
 * returning an async iterable of chunks, and a capability
 * check for native function calling.
 *
 * Translates between OmriCode's internal ProviderMessage format
 * and each provider's native API format internally.
 */

import {
  ProviderRow,
  ProviderConfig,
  ProviderMessage,
  ProviderChunk,
  ConnectionTestResult
} from '../types/provider';
import { ToolDefinition } from '../types/tool';

export abstract class BaseProvider {
  public readonly config: ProviderConfig;
  public readonly row: ProviderRow;

  constructor(row: ProviderRow) {
    this.row = row;
    this.config = {
      endpoint: row.endpoint.replace(/\/+$/, ''),
      model: row.model,
      apiKey: row.apiKey,
      maxTokens: row.maxTokens,
      temperature: row.temperature,
      supportsFC: row.supportsFC
    };
  }

  /**
   * Send messages to the provider and stream back chunks.
   * @param messages - Conversation history + new user message
   * @param tools - Tool definitions for the model
   * @param abortSignal - Signal to abort/cancel the request
   */
  abstract sendMessage(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    abortSignal?: AbortSignal
  ): AsyncIterable<ProviderChunk>;

  /**
   * Whether this provider/model supports native function calling.
   * If 'auto', the first call probes the endpoint.
   */
  abstract supportsFunctionCalling(): boolean | Promise<boolean>;

  /**
   * Test the connection to this provider's endpoint.
   * Returns latency, model availability, and FC support.
   */
  abstract testConnection(): Promise<ConnectionTestResult>;

  /**
   * Build the HTTP request headers common to most OpenAI-compatible APIs.
   */
  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  /**
   * Build the chat completion request body in OpenAI-compatible format.
   * Override in subclasses for non-standard APIs (e.g. Anthropic).
   */
  protected buildRequestBody(
    messages: ProviderMessage[],
    tools: ToolDefinition[]
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.name ? { name: m.name } : {})
      })),
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: true
    };

    // Only include tools if FC is supported/unknown
    const fcSupport = this.row.supportsFC;
    if (fcSupport !== false && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
    }

    return body;
  }

  /**
   * Parse a streaming SSE chunk from an OpenAI-compatible API.
   * Returns null for non-data lines or incomplete chunks.
   */
  protected parseSSEChunk(line: string): ProviderChunk | null {
    if (!line.startsWith('data: ')) return null;
    const data = line.slice(6).trim();

    // Stream end signal
    if (data === '[DONE]') {
      return { type: 'done' };
    }

    try {
      const parsed = JSON.parse(data);

      // Delta content
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) {
        return { type: 'text', content: delta.content };
      }

      // Tool calls
      if (delta?.tool_calls) {
        return {
          type: 'tool_call',
          tool_call: {
            id: delta.tool_calls[0]?.id || crypto.randomUUID(),
            type: 'function',
            function: {
              name: delta.tool_calls[0]?.function?.name || '',
              arguments: delta.tool_calls[0]?.function?.arguments || ''
            }
          }
        };
      }

      // Finish reason
      if (parsed.choices?.[0]?.finish_reason) {
        return { type: 'done' };
      }

      return null;
    } catch {
      return null;
    }
  }
}
