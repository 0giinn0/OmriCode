export interface ProviderRow {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  apiKey: string;
  isActive: boolean;
  supportsFC: boolean | 'auto';
  maxTokens: number;
  temperature: number;
  order: number;
}

export interface ProviderConfig {
  endpoint: string;
  model: string;
  apiKey: string;
  maxTokens: number;
  temperature: number;
  supportsFC: boolean | 'auto';
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ProviderToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ProviderChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error';
  content?: string;
  tool_call?: ProviderToolCall;
  tool_result?: string;
  error?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number;
  modelFound: boolean;
  supportsFC: boolean;
  error?: string;
}
