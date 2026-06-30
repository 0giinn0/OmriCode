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
  onClear?: () => void;
  onReset?: () => void;
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
    // Check for slash commands on the last user message
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'user' && lastMsg.content.startsWith('/')) {
      this.handleSlashCommand(lastMsg.content);
      return;
    }

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

  private handleSlashCommand(message: string): void {
    this.callbacks.onStateChange?.('idle');
    const parts = message.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (command) {
      case '/help':
        this.callbacks.onChunk?.('Available commands:\n');
        this.callbacks.onChunk?.(`  /help           List all commands\n`);
        this.callbacks.onChunk?.(`  /clear          Clear chat history\n`);
        this.callbacks.onChunk?.(`  /undo           Undo the last edit\n`);
        this.callbacks.onChunk?.(`  /redo           Redo the last undo\n`);
        this.callbacks.onChunk?.(`  /reset          Reset agent state and context\n`);
        this.callbacks.onChunk?.(`  /diff           Show changes made in current session\n`);
        this.callbacks.onChunk?.(`  /model <name>   Switch to a different model\n`);
        this.callbacks.onChunk?.(`  /export         Export chat as markdown\n`);
        break;

      case '/clear':
        this.callbacks.onClear?.();
        this.callbacks.onChunk?.('Chat cleared.');
        break;

      case '/undo':
        if (this.toolRegistry.undoLastEdit()) {
          this.callbacks.onChunk?.('Undone last edit.');
        } else {
          this.callbacks.onChunk?.('Nothing to undo.');
        }
        break;

      case '/redo':
        if (this.toolRegistry.redoLastEdit()) {
          this.callbacks.onChunk?.('Redone last undo.');
        } else {
          this.callbacks.onChunk?.('Nothing to redo.');
        }
        break;

      case '/reset': {
        this.toolRegistry.clearUndoRedo();
        this.callbacks.onReset?.();
        this.callbacks.onChunk?.('Agent state and context reset.');
        break;
      }

      case '/diff': {
        const undoStack = this.toolRegistry.getUndoStack();
        const redoStack = this.toolRegistry.getRedoStack();
        if (undoStack.length === 0 && redoStack.length === 0) {
          this.callbacks.onChunk?.('No changes in current session.');
        } else {
          this.callbacks.onChunk?.(`Undo stack (${undoStack.length}):\n`);
          for (const r of undoStack) {
            this.callbacks.onChunk?.(`  [${r.timestamp}] ${r.description} — ${r.filePath}\n`);
          }
          this.callbacks.onChunk?.(`\nRedo stack (${redoStack.length}):\n`);
          for (const r of redoStack) {
            this.callbacks.onChunk?.(`  [${r.timestamp}] ${r.description} — ${r.filePath}\n`);
          }
        }
        break;
      }

      case '/model':
        if (args) {
          this.callbacks.onChunk?.(`Switching to model: ${args}`);
        } else {
          this.callbacks.onChunk?.('Usage: /model <model_name>');
        }
        break;

      case '/export':
        this.callbacks.onChunk?.('Chat export is not yet implemented in standalone mode.');
        break;

      default:
        this.callbacks.onChunk?.(`Unknown command: ${command}. Type /help for available commands.`);
        break;
    }

    this.callbacks.onDone?.('');
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}
