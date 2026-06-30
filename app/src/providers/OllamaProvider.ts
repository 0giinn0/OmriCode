import { ProviderRow, ProviderMessage, ProviderChunk, ConnectionTestResult } from '../types/provider';
import { ToolDefinition } from '../types/tool';
import { BaseProvider } from './BaseProvider';

export class OllamaProvider extends BaseProvider {
  async *sendMessage(messages: ProviderMessage[], tools: ToolDefinition[], abortSignal?: AbortSignal): AsyncIterable<ProviderChunk> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
      options: { temperature: this.config.temperature, num_predict: this.config.maxTokens }
    };
    if (tools.length > 0) body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));

    let response: Response;
    try { response = await fetch(`${this.config.endpoint}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: abortSignal }); }
    catch { yield { type: 'error', error: 'Cannot reach Ollama' }; return; }

    if (!response.ok) { yield { type: 'error', error: `Ollama error (${response.status})` }; return; }
    const reader = response.body?.getReader();
    if (!reader) { yield { type: 'error', error: 'No response body' }; return; }
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
            if (parsed.message?.content) yield { type: 'text', content: parsed.message.content };
            if (parsed.done) yield { type: 'done' };
          } catch { /* skip */ }
        }
      }
    } catch (err) { if ((err as Error).name !== 'AbortError') yield { type: 'error', error: (err as Error).message }; }
  }

  supportsFunctionCalling(): boolean { return this.row.supportsFC === 'auto' ? true : this.row.supportsFC; }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const resp = await fetch(`${this.config.endpoint}/api/tags`, { signal: AbortSignal.timeout(5000) });
      return { success: resp.ok, latencyMs: Date.now() - start, modelFound: resp.ok, supportsFC: true, error: resp.ok ? undefined : `HTTP ${resp.status}` };
    } catch (err) { return { success: false, latencyMs: Date.now() - start, modelFound: false, supportsFC: false, error: (err as Error).message }; }
  }
}
