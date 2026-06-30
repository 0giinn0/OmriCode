import { ProviderMessage, ProviderChunk, ProviderToolCall } from '../types/provider';
import { ToolDefinition, ToolExecutionRequest, ToolResult } from '../types/tool';
import { ProviderGateway } from '../providers/ProviderGateway';
import { ToolRegistry } from '../tools/ToolRegistry';
import { SearchReplaceParser } from '../tools/SearchReplaceParser';

export type ExternalExecutor = (call: ToolExecutionRequest) => Promise<ToolResult | null>;

interface AgentCallbacks {
  onChunk?: (chunk: string) => void;
  onToolCall?: (call: ToolExecutionRequest) => void;
  onToolResult?: (result: unknown) => void;
  onDone?: (content?: string) => void;
  onError?: (err: string) => void;
  onStateChange?: (state: string) => void;
}

export class AgentLoop {
  private providerGateway: ProviderGateway;
  private toolRegistry: ToolRegistry;
  private callbacks: AgentCallbacks = {};
  private externalExecutor: ExternalExecutor | null = null;
  private abortController: AbortController | null = null;
  private messageIdCounter = 0;

  constructor(providerGateway: ProviderGateway, toolRegistry: ToolRegistry) {
    this.providerGateway = providerGateway;
    this.toolRegistry = toolRegistry;
  }

  setCallbacks(cbs: AgentCallbacks): void { this.callbacks = cbs; }
  setExternalExecutor(executor: ExternalExecutor | null): void { this.externalExecutor = executor; }

  async processMessage(messages: ProviderMessage[], providerRow: {
    endpoint: string; model: string; apiKey: string;
    maxTokens: number; temperature: number; supportsFC: boolean | 'auto'
  }): Promise<void> {
    this.abortController = new AbortController();
    this.callbacks.onStateChange?.('thinking');

    const provider = this.providerGateway.create({
      id: '', name: '', order: 0, isActive: true,
      ...providerRow
    });
    const tools = this.toolRegistry.getDefinitions();

    try {
      const toolCallAccumulators = new Map<string, ProviderToolCall>();

      let fullResponseText = '';

      for await (const chunk of provider.sendMessage(messages, tools, this.abortController.signal)) {
        if (chunk.type === 'text') {
          fullResponseText += chunk.content || '';
          this.callbacks.onChunk?.(chunk.content || '');
        } else if (chunk.type === 'tool_call' && chunk.tool_call) {
          const tc = chunk.tool_call;
          const existing = toolCallAccumulators.get(tc.id) || { id: tc.id, type: 'function' as const, function: { name: '', arguments: '' } };
          existing.function.name += tc.function.name;
          existing.function.arguments += tc.function.arguments;
          toolCallAccumulators.set(tc.id, existing);
        } else if (chunk.type === 'error') {
          this.callbacks.onError?.(chunk.error || 'Unknown error');
          return;
        } else if (chunk.type === 'done') {
          break;
        }
      }

      // Execute accumulated tool calls
      if (toolCallAccumulators.size > 0) {
        this.callbacks.onStateChange?.('executing');
        const toolCalls = Array.from(toolCallAccumulators.values());

        for (const tc of toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }

          const execReq: ToolExecutionRequest = {
            id: tc.id, name: tc.function.name,
            arguments: args,
            argumentsRaw: tc.function.arguments,
            source: 'function_call'
          };

          this.callbacks.onToolCall?.(execReq);

          let result: ToolResult | null = null;

          // Try external executor first (editor-specific tools)
          if (this.externalExecutor) {
            result = await this.externalExecutor(execReq);
          }

          // If not handled externally, execute locally
          if (!result) {
            result = await this.toolRegistry.execute(execReq, this.abortController.signal);
          }

          this.callbacks.onToolResult?.(result);

          // Feed result back for multi-turn tool use
          messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: tc.id,
            name: tc.function.name
          });
        }

        // Continue the conversation with tool results
        if (toolCallAccumulators.size > 0) {
          this.callbacks.onStateChange?.('thinking');
          for await (const chunk of provider.sendMessage(messages, tools, this.abortController.signal)) {
            if (chunk.type === 'text') this.callbacks.onChunk?.(chunk.content || '');
            else if (chunk.type === 'done') break;
            else if (chunk.type === 'error') { this.callbacks.onError?.(chunk.error || 'Unknown error'); return; }
          }
        }
        this.callbacks.onStateChange?.('idle');
      }

      // Check for SEARCH/REPLACE blocks in the full response
      const blocks = SearchReplaceParser.parse(fullResponseText);
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

          let result: ToolResult | null = null;

          if (this.externalExecutor) {
            result = await this.externalExecutor(execReq);
          }

          if (!result) {
            result = await this.toolRegistry.execute(execReq, this.abortController.signal);
          }

          this.callbacks.onToolResult?.(result);
        }
        this.callbacks.onStateChange?.('idle');
      }

      this.callbacks.onDone?.(fullResponseText);
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
