import { ProviderRow, ProviderMessage, ProviderChunk, ConnectionTestResult } from '../types/provider';
import { ToolDefinition } from '../types/tool';
import { BaseProvider } from './BaseProvider';

export class OpenRouterProvider extends BaseProvider {
  protected buildHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.config.apiKey}`, 'HTTP-Referer': 'https://github.com/0giinn0/OmriCode', 'X-Title': 'OmriCode' };
  }

  async *sendMessage(messages: ProviderMessage[], tools: ToolDefinition[], abortSignal?: AbortSignal): AsyncIterable<ProviderChunk> {
    const response = await fetch(`${this.config.endpoint}/chat/completions`, {
      method: 'POST', headers: this.buildHeaders(),
      body: JSON.stringify(this.buildRequestBody(messages, tools)),
      signal: abortSignal
    });
    if (!response.ok) { yield { type: 'error', error: `OpenRouter error (${response.status})` }; return; }
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

  supportsFunctionCalling(): boolean { return true; }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const resp = await fetch(`${this.config.endpoint}/models`, { headers: this.buildHeaders() });
      return { success: resp.ok, latencyMs: Date.now() - start, modelFound: true, supportsFC: true, error: resp.ok ? undefined : `HTTP ${resp.status}` };
    } catch (err) { return { success: false, latencyMs: Date.now() - start, modelFound: false, supportsFC: true, error: (err as Error).message }; }
  }
}
