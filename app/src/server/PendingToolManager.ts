import { ToolResult } from '../types/tool';

interface PendingTool {
  toolCallId: string;
  clientId: string;
  resolve: (result: ToolResult) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
  createdAt: number;
}

export class PendingToolManager {
  private pending = new Map<string, PendingTool>();
  private timeoutMs: number;

  constructor(timeoutMs = 60000) {
    this.timeoutMs = timeoutMs;
  }

  create(toolCallId: string, clientId: string): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(toolCallId);
        reject(new Error(`Tool call ${toolCallId} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(toolCallId, { toolCallId, clientId, resolve, reject, timeout, createdAt: Date.now() });
    });
  }

  resolve(toolCallId: string, result: ToolResult): boolean {
    const pending = this.pending.get(toolCallId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    this.pending.delete(toolCallId);
    pending.resolve(result);
    return true;
  }

  rejectAll(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  getPendingCount(): number {
    return this.pending.size;
  }
}
