/**
 * MessageHistory.ts
 * OmriCode — Chat Message History Manager
 *
 * Manages the conversation history for the agent loop.
 * Handles token-budgeted truncation, role alternation,
 * and serialization between internal and provider formats.
 *
 * Persisted to .omricode/history.db via the config manager.
 * On startup, previous session history is loaded.
 */

import { ChatMessage, MessageRole } from '../types/message';
import { ProviderMessage } from '../types/provider';

export class MessageHistory {
  private messages: ChatMessage[] = [];
  private maxTokens: number;
  private currentTokens: number = 0;
  private sequenceCounter: number = 0;

  /**
   * Estimated tokens per character (conservative for multi-byte).
   */
  private static readonly TOKENS_PER_CHAR = 0.35;

  constructor(maxTokens: number = 25000) {
    this.maxTokens = maxTokens;
  }

  /**
   * Estimate token count for a string.
   */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length * this.TOKENS_PER_CHAR);
  }

  /**
   * Add a message to the history.
   */
  add(
    role: MessageRole,
    content: string,
    metadata?: Partial<ChatMessage>
  ): ChatMessage {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      sequence: this.sequenceCounter++,
      role,
      content,
      timestamp: new Date().toISOString(),
      status: role === 'assistant' ? 'pending' : 'complete',
      tokenCount: MessageHistory.estimateTokens(content),
      ...metadata
    };

    this.messages.push(msg);
    this.currentTokens += msg.tokenCount || 0;
    this.truncateIfNeeded();

    return msg;
  }

  /**
   * Update an existing message (e.g. append streaming content).
   */
  update(messageId: string, updates: Partial<ChatMessage>): void {
    const idx = this.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return;

    const old = this.messages[idx];
    if (updates.content && updates.content !== old.content) {
      const oldTokens = old.tokenCount || 0;
      const newTokens = MessageHistory.estimateTokens(updates.content);
      this.currentTokens += newTokens - oldTokens;
    }

    this.messages[idx] = { ...old, ...updates };
  }

  /**
   * Get all messages (for serialization / persistence).
   */
  getAll(): ChatMessage[] {
    return [...this.messages];
  }

  /**
   * Get messages in provider-compatible format.
   * Includes system prompt as the first message.
   */
  getProviderMessages(systemPrompt?: string): ProviderMessage[] {
    const result: ProviderMessage[] = [];

    // System prompt first
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    // Convert chat messages to provider format
    for (const msg of this.messages) {
      const providerMsg: ProviderMessage = {
        role: msg.role as ProviderMessage['role'],
        content: msg.content
      };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        providerMsg.tool_calls = msg.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.toolName,
            arguments: tc.arguments
          }
        }));
      }
      result.push(providerMsg);
    }

    return result;
  }

  /**
   * Clear all messages.
   */
  clear(): void {
    this.messages = [];
    this.currentTokens = 0;
    this.sequenceCounter = 0;
  }

  /**
   * Get the last N messages.
   */
  last(n: number): ChatMessage[] {
    return this.messages.slice(-n);
  }

  /**
   * Get total estimated tokens.
   */
  getTokenCount(): number {
    return this.currentTokens;
  }

  /**
   * Get message count.
   */
  get length(): number {
    return this.messages.length;
  }

  /**
   * Truncate oldest messages when token budget is exceeded.
   * Always keeps the most recent system prompt and last 2 turns.
   */
  private truncateIfNeeded(): void {
    while (this.currentTokens > this.maxTokens && this.messages.length > 4) {
      const removed = this.messages.shift();
      if (removed) {
        this.currentTokens -= removed.tokenCount || 0;
      }
    }
  }

  /**
   * Restore messages from a saved array (e.g., from DB).
   */
  restore(savedMessages: ChatMessage[]): void {
    this.messages = savedMessages;
    this.sequenceCounter = savedMessages.length;
    this.currentTokens = savedMessages.reduce(
      (sum, m) => sum + (m.tokenCount || MessageHistory.estimateTokens(m.content)),
      0
    );
  }
}
