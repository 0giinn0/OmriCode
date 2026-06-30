/**
 * provider.ts
 * OmriCode — Provider Types & Interfaces
 *
 * Defines the data model for the adjustable provider table.
 * Each provider is a row. One is active at a time.
 * All config is serialized to VS Code settings.json as an array.
 */

/**
 * Represents a single row in the adjustable provider table.
 * Users can add, remove, reorder, and toggle rows via the UI.
 */
export interface ProviderRow {
  /** UUID v4 unique identifier for this row */
  id: string;
  /** Human-readable label (e.g. "Local", "OpenAI", "My Custom") */
  name: string;
  /** Base URL for the OpenAI-compatible API endpoint */
  endpoint: string;
  /** Model identifier (e.g. "nous-hermes-gguf", "gpt-4o") */
  model: string;
  /** API key — encrypted at rest, masked in UI as ⚫⚫⚫ */
  apiKey: string;
  /** Whether this provider is the active one (only one true at a time) */
  isActive: boolean;
  /**
   * Whether the model supports native function calling.
   * 'auto' means probe on first call and cache the result.
   */
  supportsFC: boolean | 'auto';
  /** Maximum tokens for responses from this provider */
  maxTokens: number;
  /** Sampling temperature (0.0 to 2.0, default 0.7) */
  temperature: number;
  /** Display order in the table (lower = first) */
  order: number;
  /** Optional label for the API key field (e.g. "sk-...") */
  apiKeyHint?: string;
}

/**
 * Connection test result returned when probing a provider endpoint.
 */
export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number;
  modelFound: boolean;
  supportsFC: boolean;
  error?: string;
}

/**
 * Permission level for each provider's tool execution.
 */
export type PermissionMode = 'trusted' | 'normal' | 'paranoid';

/**
 * Provider-agnostic message format for the agent loop.
 * Both user and assistant messages conform to this shape,
 * which is translated to each provider's native format internally.
 */
export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ProviderToolCall[];
  tool_call_id?: string;
  name?: string;
}

/**
 * Normalized tool call object used internally.
 * Each provider translates its native format to this.
 */
export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * Normalized streaming chunk from any provider.
 */
export interface ProviderChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error';
  content?: string;
  tool_call?: ProviderToolCall;
  tool_result?: string;
  error?: string;
}

/**
 * Configuration snapshot passed to providers at creation.
 */
export interface ProviderConfig {
  endpoint: string;
  model: string;
  apiKey: string;
  maxTokens: number;
  temperature: number;
  supportsFC: boolean | 'auto';
}
