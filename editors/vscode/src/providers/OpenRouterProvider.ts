import { ProviderRow, ProviderMessage, ProviderChunk, ConnectionTestResult } from '../types/provider';
import { ToolDefinition } from '../types/tool';
import { BaseProvider } from './BaseProvider';

export class OpenRouterProvider extends BaseProvider {
  constructor(row: ProviderRow) {
    super(row);
  }

  protected buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      'HTTP-Referer': 'https://github.com/0giinn0/OmriCode',
      'X-Title': 'OmriCode'
    };
  }

  async *sendMessage(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    abortSignal?: AbortSignal
  ): AsyncIterable<ProviderChunk> {
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

    if (tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
    }

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
        error: `Cannot reach OpenRouter at ${this.config.endpoint}`
      };
      return;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      yield { type: 'error', error: `OpenRouter error (${response.status}): ${errorText}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'Response body not readable' };
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
      yield { type: 'error', error: err instanceof Error ? err.message : 'Stream error' };
    }
  }

  supportsFunctionCalling(): boolean {
    if (this.row.supportsFC === 'auto') return true;
    return this.row.supportsFC;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.config.endpoint}/models`, {
        headers: this.buildHeaders()
      });
      const latencyMs = Date.now() - start;

      if (response.status === 401) {
        return {
          success: false, latencyMs, modelFound: false,
          supportsFC: true,
          error: 'Invalid OpenRouter API key'
        };
      }
      if (!response.ok) {
        return {
          success: false, latencyMs, modelFound: false,
          supportsFC: true,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

      const data = await response.json() as { data?: { id: string }[] };
      const models = data.data || [];
      const modelFound = models.some(m => m.id === this.config.model);
      return { success: true, latencyMs, modelFound, supportsFC: true };
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        modelFound: false,
        supportsFC: true,
        error: err instanceof Error ? err.message : 'Cannot reach OpenRouter'
      };
    }
  }
}
