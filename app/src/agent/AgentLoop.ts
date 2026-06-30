import { ProviderMessage } from '../types/provider';
import { ToolDefinition } from '../types/tool';
import { ProviderGateway } from '../providers/ProviderGateway';
import { ToolRegistry } from '../tools/ToolRegistry';
import { SearchReplaceParser } from '../tools/SearchReplaceParser';
import { ProviderChunk } from '../types/provider';
import { ToolExecutionRequest } from '../types/tool';

interface AgentCallbacks {
  onChunk?: (chunk: string) => void;
  onToolCall?: (call: ToolExecutionRequest) => void;
  onToolResult?: (result: unknown) => void;
  onDone?: () => void;
  onError?: (err: string) => void;
  onStateChange?: (state: string) => void;
}

export class AgentLoop {
  private providerGateway: ProviderGateway;
  private toolRegistry: ToolRegistry;
  private callbacks: AgentCallbacks = {};
  private abortController: AbortController | null = null;
  private messageIdCounter = 0;

  constructor(providerGateway: ProviderGateway, toolRegistry: ToolRegistry) {
    this.providerGateway = providerGateway;
    this.toolRegistry = toolRegistry;
  }

  setCallbacks(cbs: AgentCallbacks): void { this.callbacks = cbs; }

  async processMessage(messages: ProviderMessage[], providerRow: { endpoint: string; model: string; apiKey: string; maxTokens: number; temperature: number; supportsFC: boolean | 'auto' }): Promise<void> {
    this.abortController = new AbortController();
    this.callbacks.onStateChange?.('thinking');

    const provider = this.providerGateway.create({
      id: '', name: '', order: 0, isActive: true,
      ...providerRow
    });
    const tools = this.toolRegistry.getDefinitions();
    const messageId = `msg_${++this.messageIdCounter}`;

    try {
      const chunks: ProviderChunk[] = [];
      for await (const chunk of provider.sendMessage(messages, tools, this.abortController.signal)) {
        chunks.push(chunk);
        if (chunk.type === 'text') this.callbacks.onChunk?.(chunk.content || '');
        if (chunk.type === 'error') { this.callbacks.onError?.(chunk.error || 'Unknown error'); return; }
        if (chunk.type === 'done') break;
      }

      // Check for SEARCH/REPLACE blocks in the response
      const fullText = chunks.filter(c => c.type === 'text').map(c => c.content).join('');
      const blocks = SearchReplaceParser.parse(fullText);
      if (blocks.length > 0) {
        this.callbacks.onStateChange?.('executing');
        for (const block of blocks) {
          const filePath = block.filePath;
          const execReq: ToolExecutionRequest = {
            id: crypto.randomUUID(), name: 'edit_file',
            arguments: { filePath, searchText: block.searchText, replaceText: block.replaceText },
            argumentsRaw: JSON.stringify({ filePath, searchText: block.searchText, replaceText: block.replaceText }),
            source: 'search_replace'
          };
          this.callbacks.onToolCall?.(execReq);
          const result = await this.toolRegistry.execute(execReq, this.abortController.signal);
          this.callbacks.onToolResult?.(result);
        }
        this.callbacks.onStateChange?.('idle');
      }

      this.callbacks.onDone?.();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') this.callbacks.onError?.((err as Error).message);
    }
    this.callbacks.onStateChange?.('idle');
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}
