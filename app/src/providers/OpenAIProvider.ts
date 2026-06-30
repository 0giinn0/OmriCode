import { ProviderRow, ProviderMessage, ProviderChunk, ConnectionTestResult } from '../types/provider';
import { ToolDefinition } from '../types/tool';
import { BaseProvider } from './BaseProvider';

export class OpenAIProvider extends BaseProvider {
  async *sendMessage(messages: ProviderMessage[], tools: ToolDefinition[], abortSignal?: AbortSignal): AsyncIterable<ProviderChunk> {
    const response = await fetch(`${this.config.endpoint}/chat/completions`, {
      method: 'POST', headers: this.buildHeaders(),
      body: JSON.stringify(this.buildRequestBody(messages, tools)),
      signal: abortSignal
    });
    if (!response.ok) { yield { type: 'error', error: `OpenAI error (${response.status})` }; return; }
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
        for (const line of lines) { const c = this.parseSSEChunk(line); if (c) yield c; }
      }
    } catch (err) { if ((err as Error).name !== 'AbortError') yield { type: 'error', error: (err as Error).message }; }
  }

  supportsFunctionCalling(): boolean { return this.row.supportsFC === 'auto' ? true : this.row.supportsFC; }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const resp = await fetch(`${this.config.endpoint}/models`, { headers: this.buildHeaders() });
      const latency = Date.now() - start;
      return resp.ok ? { success: true, latencyMs: latency, modelFound: true, supportsFC: true } : { success: false, latencyMs: latency, modelFound: false, supportsFC: true, error: `HTTP ${resp.status}` };
    } catch (err) { return { success: false, latencyMs: Date.now() - start, modelFound: false, supportsFC: true, error: (err as Error).message }; }
  }
}
