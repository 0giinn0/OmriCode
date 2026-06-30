/**
 * tool.ts
 * OmriCode — Tool System Types
 *
 * Defines the structure for tool definitions, tool execution
 * requests, results, and the SEARCH/REPLACE block format.
 */

/**
 * Schema for a single parameter in a tool definition.
 * Mirrors the OpenAI function calling parameter schema.
 */
export interface ToolParameterProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  default?: unknown;
  required?: boolean;
}

/**
 * Full parameter schema for a tool (JSON Schema subset).
 */
export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required: string[];
}

/**
 * A tool definition sent to the provider alongside the system prompt.
 * Models with native FC use this schema; models without FC
 * have these converted to SEARCH/REPLACE text instructions.
 */
export interface ToolDefinition {
  /** Tool name — must match the handler key in ToolRegistry */
  name: string;
  /** Description for the model to decide when to use this tool */
  description: string;
  /** JSON Schema for tool arguments */
  parameters: ToolParameters;
  /** Permission level required to execute this tool */
  permission: 'always' | 'workspace' | 'confirm';
}

/**
 * A pending tool execution request, either from native FC
 * or parsed from SEARCH/REPLACE blocks.
 */
export interface ToolExecutionRequest {
  /** Unique execution ID */
  id: string;
  /** Tool function name */
  name: string;
  /** Parsed arguments object */
  arguments: Record<string, unknown>;
  /** Raw arguments JSON string (for logging) */
  argumentsRaw: string;
  /** Source of this request */
  source: 'function_call' | 'search_replace';
}

/**
 * Result returned from executing a tool.
 */
export interface ToolResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Output text (file content, command output, etc.) */
  output: string;
  /** Error message if success === false */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** File paths affected (for undo tracking) */
  affectedFiles?: string[];
}

/**
 * A parsed SEARCH/REPLACE block from model output.
 * Converts to an edit_file tool call internally.
 */
export interface SearchReplaceBlock {
  /** File path extracted or inferred from context */
  filePath: string;
  /** The exact text to find (SEARCH section) */
  searchText: string;
  /** The replacement text (REPLACE section) */
  replaceText: string;
  /** Whether the block was matched in the file */
  matched: boolean;
}

/**
 * Permission approval request sent to the user.
 */
export interface PermissionRequest {
  toolName: string;
  args: Record<string, unknown>;
  description: string;
  resolve: (approved: boolean) => void;
}

/**
 * Undo record stored for each file edit.
 */
export interface UndoRecord {
  /** ISO timestamp */
  timestamp: string;
  /** File path that was edited */
  filePath: string;
  /** Original content before the edit */
  originalContent: string;
  /** New content after the edit */
  newContent: string;
  /** Tool execution ID that caused this edit */
  toolExecutionId: string;
  /** Human-readable description */
  description: string;
}
