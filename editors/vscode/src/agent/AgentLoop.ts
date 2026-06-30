/**
 * AgentLoop.ts
 * OmriCode — ReAct Agent Loop
 *
 * The core reasoning loop that drives the AI agent.
 * Implements the Think → Act → Observe cycle with dual-path
 * tool calling: native function calling (when available) and
 * SEARCH/REPLACE fallback parsing (for any model).
 *
 * Flow per turn:
 *   1. Compose context (system prompt + history + tools)
 *   2. Send to provider → stream response
 *   3. Parse response:
 *      a. If tool_calls[] → execute tools → feed results back → loop
 *      b. If text + SEARCH/REPLACE blocks → parse → execute → loop
 *      c. If plain text → show to user → done
 *   4. Repeat until: max iterations, final answer, or error
 */

import { ConfigManager } from '../config/ConfigManager';
import { ProviderGateway } from '../providers/ProviderGateway';
import { ToolExecutionRequest, ToolResult, SearchReplaceBlock } from '../types/tool';
import { ToolRegistry } from '../tools/ToolRegistry';
import { SearchReplaceParser } from '../tools/SearchReplaceParser';
import { MessageHistory } from './MessageHistory';
import { AgentState } from './AgentState';
import { ContextAssembler } from '../context/ContextAssembler';

/**
 * Callbacks for the UI layer to react to agent events.
 */
export interface AgentCallbacks {
  onMessageStart?: (messageId: string) => void;
  onChunk?: (messageId: string, chunk: string) => void;
  onToolCallStart?: (messageId: string, toolCall: ToolExecutionRequest) => void;
  onToolCallComplete?: (messageId: string, toolCall: ToolExecutionRequest, result: ToolResult) => void;
  onMessageComplete?: (messageId: string) => void;
  onError?: (messageId: string, error: string) => void;
  onStateChange?: (state: string) => void;
  onPermissionRequest?: (toolName: string, args: Record<string, unknown>, description: string) => Promise<boolean>;
}

export class AgentLoop {
  private configManager: ConfigManager;
  private toolRegistry: ToolRegistry;
  private providerGateway: ProviderGateway;
  private messageHistory: MessageHistory;
  private state: AgentState;
  private contextAssembler: ContextAssembler;
  private callbacks: AgentCallbacks = {};
  private abortController: AbortController | null = null;

  constructor(configManager: ConfigManager, toolRegistry: ToolRegistry) {
    this.configManager = configManager;
    this.toolRegistry = toolRegistry;
    this.providerGateway = new ProviderGateway(configManager);
    this.messageHistory = new MessageHistory(configManager.getContextBudget().totalSoftLimit);
    this.state = new AgentState(configManager.getMaxIterations());
    this.contextAssembler = new ContextAssembler(configManager);
  }

  /**
   * Register callbacks for UI updates.
   */
  setCallbacks(callbacks: AgentCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Get the message history (for persistence/restore).
   */
  getMessageHistory(): MessageHistory {
    return this.messageHistory;
  }

  /**
   * Get the agent state machine.
   */
  getState(): AgentState {
    return this.state;
  }

  /**
   * Get the tool registry.
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Main entry point: process a user message.
   * Returns the assistant message ID for tracking.
   */
  async processUserMessage(userContent: string): Promise<string> {
    // Handle slash commands immediately
    const command = this.parseSlashCommand(userContent);
    if (command) {
      return this.handleSlashCommand(command);
    }

    // Add user message to history
    this.messageHistory.add('user', userContent);
    this.state.reset();
    this.state.transition('thinking');
    this.callbacks.onStateChange?.('thinking');

    // Create assistant message placeholder
    const assistantMsg = this.messageHistory.add('assistant', '', {
      status: 'thinking',
      providerName: this.configManager.getActiveProvider()?.name,
      modelName: this.configManager.getActiveProvider()?.model
    });
    this.callbacks.onMessageStart?.(assistantMsg.id);

    this.abortController = new AbortController();

    try {
      await this.runLoop(assistantMsg.id);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Agent loop error';
      this.messageHistory.update(assistantMsg.id, {
        status: 'error',
        content: errorMsg,
        errorMessage: errorMsg
      });
      this.callbacks.onError?.(assistantMsg.id, errorMsg);
      this.state.forceState('error');
    }

    return assistantMsg.id;
  }

  /**
   * The core ReAct loop.
   */
  private async runLoop(assistantMsgId: string): Promise<void> {
    const tools = this.toolRegistry.getDefinitions();

    while (!this.state.isIterationLimitReached()) {
      // Compose context
      const systemPrompt = this.contextAssembler.buildSystemPrompt(tools);
      const providerMessages = this.messageHistory.getProviderMessages(systemPrompt);

      // Stream response from provider
      let fullContent = '';
      let accumulatedToolCalls: Map<string, string> = new Map();
      this.state.transition('thinking');

      const provider = this.providerGateway.getActiveProvider();
      const supportsFC = provider ? await provider.supportsFunctionCalling() : false;

      for await (const chunk of this.providerGateway.send(
        providerMessages,
        tools,
        this.abortController?.signal
      )) {
        switch (chunk.type) {
          case 'text':
            fullContent += chunk.content || '';
            this.messageHistory.update(assistantMsgId, { content: fullContent });
            this.callbacks.onChunk?.(assistantMsgId, chunk.content || '');
            break;

          case 'tool_call':
            if (chunk.tool_call) {
              const existing = accumulatedToolCalls.get(chunk.tool_call.function.name) || '';
              accumulatedToolCalls.set(
                chunk.tool_call.function.name,
                existing + chunk.tool_call.function.arguments
              );
            }
            break;

          case 'error':
            this.messageHistory.update(assistantMsgId, {
              status: 'error',
              errorMessage: chunk.error
            });
            this.callbacks.onError?.(assistantMsgId, chunk.error || '');
            this.state.forceState('error');
            return;

          case 'done':
            break;
        }
      }

      this.state.transition('deciding');

      // Check for native function calls
      if (accumulatedToolCalls.size > 0 && supportsFC) {
        await this.executeToolCalls(assistantMsgId, accumulatedToolCalls);
        this.state.transition('observing');
        continue; // Loop back for another thinking turn
      }

      // Check for SEARCH/REPLACE blocks (fallback)
      const blocks = SearchReplaceParser.parse(fullContent);
      if (blocks.length > 0) {
        await this.executeSearchReplace(assistantMsgId, blocks);
        this.state.transition('observing');
        continue; // Loop back
      }

      // Plain text response — done
      this.messageHistory.update(assistantMsgId, {
        status: 'complete',
        durationMs: this.state.elapsedMs,
        tokenCount: MessageHistory.estimateTokens(fullContent)
      });
      this.callbacks.onMessageComplete?.(assistantMsgId);
      this.state.transition('respond');
      this.state.transition('idle');
      this.callbacks.onStateChange?.('idle');
      return;
    }

    // Iteration limit reached
    this.messageHistory.update(assistantMsgId, {
      status: 'complete',
      content: (this.messageHistory.getAll().find(m => m.id === assistantMsgId)?.content || '') +
        '\n\n*(Iteration limit reached. Response may be incomplete.)*'
    });
    this.callbacks.onMessageComplete?.(assistantMsgId);
    this.state.transition('respond');
    this.state.transition('idle');
    this.callbacks.onStateChange?.('idle');
  }

  /**
   * Execute native function calls from the model.
   */
  private async executeToolCalls(
    assistantMsgId: string,
    toolCalls: Map<string, string>
  ): Promise<void> {
    for (const [name, argsJson] of toolCalls) {
      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = JSON.parse(argsJson);
      } catch {
        parsedArgs = { raw: argsJson };
      }

      const request: ToolExecutionRequest = {
        id: crypto.randomUUID(),
        name,
        arguments: parsedArgs,
        argumentsRaw: argsJson,
        source: 'function_call'
      };

      this.state.transition('executing');
      this.callbacks.onToolCallStart?.(assistantMsgId, request);

      // Check permission
      const def = this.toolRegistry.getDefinition(name);
      const needsConfirm = def?.permission === 'confirm';
      let approved = true;

      if (needsConfirm && this.callbacks.onPermissionRequest) {
        approved = await this.callbacks.onPermissionRequest(
          name,
          parsedArgs,
          def?.description || `Execute ${name}?`
        );
      }

      let result: ToolResult;
      if (!approved) {
        result = {
          success: false,
          output: `Tool '${name}' was cancelled by user.`,
          durationMs: 0
        };
      } else {
        result = await this.toolRegistry.execute(request, this.abortController?.signal);
      }

      // Add tool result to history
      this.messageHistory.add('tool', result.output, {
        tool_call_id: request.id,
        name: name
      });

      this.callbacks.onToolCallComplete?.(assistantMsgId, request, result);
    }
  }

  /**
   * Execute SEARCH/REPLACE blocks from model text response.
   */
  private async executeSearchReplace(
    assistantMsgId: string,
    blocks: SearchReplaceBlock[]
  ): Promise<void> {
    for (const block of blocks) {
      const request: ToolExecutionRequest = {
        id: crypto.randomUUID(),
        name: 'edit_file',
        arguments: {
          filePath: block.filePath,
          searchText: block.searchText,
          replaceText: block.replaceText
        },
        argumentsRaw: JSON.stringify(block),
        source: 'search_replace'
      };

      this.state.transition('executing');
      this.callbacks.onToolCallStart?.(assistantMsgId, request);

      const result = await this.toolRegistry.execute(request, this.abortController?.signal);

      this.messageHistory.add('tool', result.output, {
        tool_call_id: request.id,
        name: 'edit_file'
      });

      this.callbacks.onToolCallComplete?.(assistantMsgId, request, result);
    }
  }

  /**
   * Cancel the current agent execution.
   */
  cancel(): void {
    this.abortController?.abort();
    this.state.forceState('idle');
    this.callbacks.onStateChange?.('idle');
  }

  /**
   * Parse a slash command from user input.
   */
  private parseSlashCommand(input: string): { command: string; args: string } | null {
    if (!input.startsWith('/')) return null;
    const parts = input.slice(1).split(' ');
    return {
      command: parts[0].toLowerCase(),
      args: parts.slice(1).join(' ')
    };
  }

  /**
   * Handle a slash command synchronously.
   * Returns a fake message ID since no agent call is needed.
   */
  private async handleSlashCommand(cmd: { command: string; args: string }): Promise<string> {
    this.messageHistory.add('user', `/${cmd.command} ${cmd.args}`, { command: cmd.command });
    const response = this.messageHistory.add('assistant', '', { status: 'complete' });

    switch (cmd.command) {
      case 'help':
        this.messageHistory.update(response.id, {
          content: [
            '**OmriCode Commands:**\n',
            '- `/help` — Show this help',
            '- `/clear` — Clear chat history',
            '- `/undo` — Undo last AI edit',
            '- `/redo` — Redo undone edit',
            '- `/reset` — Reset agent state',
            '- `/diff` — Show pending changes',
            '- `/accept` — Accept all pending changes',
            '- `/reject` — Reject all pending changes',
            '- `/provider` — Switch provider',
            '- `/model` — Change model on current provider',
            '- `/export` — Export chat as markdown'
          ].join('\n')
        });
        break;

      case 'clear':
        this.messageHistory.clear();
        this.messageHistory.update(response.id, { content: 'Chat history cleared.' });
        break;

      case 'undo':
        const undone = this.toolRegistry.undoLastEdit();
        this.messageHistory.update(response.id, {
          content: undone ? 'Last edit undone.' : 'Nothing to undo.'
        });
        break;

      case 'reset':
        this.state.reset();
        this.messageHistory.update(response.id, { content: 'Agent state reset.' });
        break;

      default:
        this.messageHistory.update(response.id, {
          content: `Unknown command: \`/${cmd.command}\`. Type \`/help\` for available commands.`
        });
    }

    return response.id;
  }
}
