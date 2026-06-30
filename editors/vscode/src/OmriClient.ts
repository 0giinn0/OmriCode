export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

export type ToolHandler = (toolCallId: string, name: string, args: Record<string, unknown>) => Promise<ToolResult>;

export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown>; target: 'editor' | 'local' }
  | { type: 'tool_result'; [key: string]: unknown }
  | { type: 'state'; state: string }
  | { type: 'done' }
  | { type: 'error'; error: string };

export class OmriClient {
  private baseUrl: string;
  private clientId: string = '';
  private connected = false;
  private abortController: AbortController | null = null;
  private toolHandler: ToolHandler | null = null;

  constructor(port = 18427) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  get isConnected(): boolean { return this.connected; }
  get id(): string { return this.clientId; }

  onToolCall(handler: ToolHandler): void { this.toolHandler = handler; }

  async connect(name = 'VS Code'): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (!resp.ok) return false;

      const regResp = await fetch(`${this.baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: this.clientId || undefined,
          name, type: 'vscode',
          capabilities: ['editor:file', 'editor:diagnostic', 'editor:code_action'],
          version: '0.1.0'
        })
      });
      if (!regResp.ok) return false;
      const reg = await regResp.json() as { clientId: string };
      this.clientId = reg.clientId;
      this.connected = true;
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  async sendMessage(
    message: string,
    context: Record<string, unknown> | undefined,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    if (!this.connected) throw new Error('Not connected to OmriCode app');
    this.abortController = new AbortController();

    // Push editor context
    if (context) {
      await fetch(`${this.baseUrl}/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: this.clientId, context })
      }).catch(() => {});
    }

    const resp = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, clientId: this.clientId }),
      signal: this.abortController.signal
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })) as { error?: string };
      onEvent({ type: 'error', error: err.error || 'Chat request failed' });
      return;
    }

    const reader = resp.body?.getReader();
    if (!reader) { onEvent({ type: 'error', error: 'No response body' }); return; }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as AgentEvent;
            onEvent(event);

            // If editor tool call, execute and send result back
            if (event.type === 'tool_call' && event.target === 'editor' && this.toolHandler) {
              const result = await this.toolHandler(event.id, event.name, event.arguments);
              await this.sendToolResult(event.id, result);
            }

            if (event.type === 'done' || event.type === 'error') return;
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        onEvent({ type: 'error', error: (err as Error).message });
      }
    }
  }

  private async sendToolResult(toolCallId: string, result: ToolResult): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/tools/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: this.clientId, toolCallId, result })
      });
    } catch { /* ignore */ }
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  disconnect(): void {
    this.connected = false;
    this.cancel();
  }
}
