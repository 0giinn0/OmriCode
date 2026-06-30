import { ProviderRow, ProviderMessage, ProviderChunk, ConnectionTestResult } from '../types/provider';
import { ToolDefinition } from '../types/tool';
import { BaseProvider } from './BaseProvider';

export class OllamaProvider extends BaseProvider {
  constructor(row: ProviderRow) {
    super(row);
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
      stream: true,
      options: {
        temperature: this.config.temperature,
        num_predict: this.config.maxTokens
      }
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

    const url = `${this.config.endpoint}/api/chat`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortSignal
      });
    } catch (err) {
      yield {
        type: 'error',
        error: `Cannot reach Ollama at ${this.config.endpoint}`
      };
      return;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      yield { type: 'error', error: `Ollama error (${response.status}): ${errorText}` };
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
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.content) {
              yield { type: 'text', content: parsed.message.content };
            }
            if (parsed.message?.tool_calls) {
              for (const tc of parsed.message.tool_calls) {
                yield {
                  type: 'tool_call',
                  tool_call: {
                    id: tc.id || crypto.randomUUID(),
                    type: 'function',
                    function: {
                      name: tc.function?.name || '',
                      arguments: tc.function?.arguments || ''
                    }
                  }
                };
              }
            }
            if (parsed.done) {
              yield { type: 'done' };
            }
          } catch {
            // skip malformed lines
          }
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
      const response = await fetch(`${this.config.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(5000)
      });
      const latencyMs = Date.now() - start;
      if (!response.ok) {
        return {
          success: false, latencyMs, modelFound: false,
          supportsFC: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }
      const data = await response.json() as { models?: { name: string }[] };
      const models = data.models || [];
      const modelFound = models.some(m => m.name.startsWith(this.config.model));
      return { success: true, latencyMs, modelFound, supportsFC: true };
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        modelFound: false,
        supportsFC: false,
        error: err instanceof Error ? err.message : 'Cannot reach Ollama'
      };
    }
  }
}
