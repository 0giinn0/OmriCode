import { ProviderRow, ProviderMessage, ProviderChunk, ConnectionTestResult } from '../types/provider';
import { ToolDefinition } from '../types/tool';
import { BaseProvider } from './BaseProvider';

export class AnthropicProvider extends BaseProvider {
  async *sendMessage(messages: ProviderMessage[], tools: ToolDefinition[], abortSignal?: AbortSignal): AsyncIterable<ProviderChunk> {
    const systemMessages = messages.filter(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      messages: chatMessages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      })),
      stream: true
    };
    if (systemMessages.length > 0) body.system = systemMessages.map(m => ({ type: 'text', text: m.content }));
    if (tools.length > 0) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));

    const response = await fetch(`${this.config.endpoint}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: abortSignal
    });
    if (!response.ok) { yield { type: 'error', error: `Anthropic error (${response.status})` }; return; }
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
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') { yield { type: 'done' }; continue; }
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) yield { type: 'text', content: parsed.delta.text };
            if (parsed.type === 'message_stop') yield { type: 'done' };
          } catch { /* skip */ }
        }
      }
    } catch (err) { if ((err as Error).name !== 'AbortError') yield { type: 'error', error: (err as Error).message }; }
  }

  supportsFunctionCalling(): boolean { return true; }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const resp = await fetch(`${this.config.endpoint}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.config.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: this.config.model, max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
        signal: AbortSignal.timeout(10000)
      });
      return { success: resp.ok, latencyMs: Date.now() - start, modelFound: resp.ok, supportsFC: true, error: resp.ok ? undefined : `HTTP ${resp.status}` };
    } catch (err) { return { success: false, latencyMs: Date.now() - start, modelFound: false, supportsFC: true, error: (err as Error).message }; }
  }
}
