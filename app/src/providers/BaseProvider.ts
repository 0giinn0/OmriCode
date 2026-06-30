import { ProviderRow, ProviderConfig, ProviderMessage, ProviderChunk, ConnectionTestResult } from '../types/provider';
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

  abstract sendMessage(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    abortSignal?: AbortSignal
  ): AsyncIterable<ProviderChunk>;

  abstract supportsFunctionCalling(): boolean | Promise<boolean>;
  abstract testConnection(): Promise<ConnectionTestResult>;

  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    return headers;
  }

  protected buildRequestBody(messages: ProviderMessage[], tools: ToolDefinition[]): Record<string, unknown> {
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
    if (this.row.supportsFC !== false && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }));
    }
    return body;
  }

  protected parseSSEChunk(line: string): ProviderChunk | null {
    if (!line.startsWith('data: ')) return null;
    const data = line.slice(6).trim();
    if (data === '[DONE]') return { type: 'done' };
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) return { type: 'text', content: delta.content };
      if (delta?.tool_calls) return { type: 'tool_call', tool_call: { id: delta.tool_calls[0]?.id || crypto.randomUUID(), type: 'function', function: { name: delta.tool_calls[0]?.function?.name || '', arguments: delta.tool_calls[0]?.function?.arguments || '' } } };
      if (parsed.choices?.[0]?.finish_reason) return { type: 'done' };
      return null;
    } catch { return null; }
  }
}
