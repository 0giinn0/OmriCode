import { ProviderRow, ProviderMessage, ProviderChunk, ConnectionTestResult } from '../types/provider';
import { ToolDefinition } from '../types/tool';
import { BaseProvider } from './BaseProvider';

export class LocalProvider extends BaseProvider {
  async *sendMessage(messages: ProviderMessage[], tools: ToolDefinition[], abortSignal?: AbortSignal): AsyncIterable<ProviderChunk> {
    let response: Response;
    try { response = await fetch(`${this.config.endpoint}/chat/completions`, { method: 'POST', headers: this.buildHeaders(), body: JSON.stringify(this.buildRequestBody(messages, tools)), signal: abortSignal }); }
    catch { yield { type: 'error', error: 'Cannot reach local provider' }; return; }
    if (!response.ok) { yield { type: 'error', error: `Local error (${response.status})` }; return; }
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
          const c = this.parseSSEChunk(line);
          if (!c && line.trim()) {
            try { const p = JSON.parse(line); if (p.message?.content) yield { type: 'text', content: p.message.content }; else if (p.response) yield { type: 'text', content: p.response }; if (p.done) yield { type: 'done' }; } catch { /* skip */ }
            continue;
          }
          if (c) yield c;
        }
      }
    } catch (err) { if ((err as Error).name !== 'AbortError') yield { type: 'error', error: (err as Error).message }; }
  }

  supportsFunctionCalling(): boolean { return this.row.supportsFC === 'auto' ? true : this.row.supportsFC; }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const resp = await fetch(`${this.config.endpoint}/models`, { signal: AbortSignal.timeout(5000) });
      return { success: resp.ok, latencyMs: Date.now() - start, modelFound: resp.ok, supportsFC: false, error: resp.ok ? undefined : `HTTP ${resp.status}` };
    } catch (err) { return { success: false, latencyMs: Date.now() - start, modelFound: false, supportsFC: false, error: (err as Error).message }; }
  }
}
