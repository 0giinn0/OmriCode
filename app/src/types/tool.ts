export interface ToolParameterProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  default?: unknown;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
  permission: 'always' | 'workspace' | 'confirm';
}

export interface ToolExecutionRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  argumentsRaw: string;
  source: 'function_call' | 'search_replace';
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  affectedFiles?: string[];
}

export interface SearchReplaceBlock {
  filePath: string;
  searchText: string;
  replaceText: string;
  matched: boolean;
}

export interface UndoRecord {
  timestamp: string;
  filePath: string;
  originalContent: string;
  newContent: string;
  toolExecutionId: string;
  description: string;
}
