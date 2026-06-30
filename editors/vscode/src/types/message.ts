/**
 * message.ts
 * OmriCode — Chat Message Types
 *
 * Defines the data models for chat history, tool calls,
 * and UI-facing message display. Messages are stored in
 * .omricode/history.db and loaded on panel open.
 */

/**
 * The role of a message sender in the chat history.
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Status indicator for an assistant message bubble.
 * Shows real-time progress as the agent works.
 */
export type MessageStatus =
  | 'pending'       // Queued, not yet sent to provider
  | 'thinking'      // Provider is generating a response
  | 'waiting_tool'  // Agent decided to call a tool, awaiting result
  | 'executing_tool'// Tool is running
  | 'complete'      // Response fully delivered
  | 'error'         // Something went wrong
  | 'cancelled';    // User cancelled or iteration limit hit

/**
 * Full chat message stored in history and rendered in the UI.
 */
export interface ChatMessage {
  /** UUID v4 */
  id: string;
  /** Message ordering (monotonically increasing) */
  sequence: number;
  /** Who sent this message */
  role: MessageRole;
  /** Markdown-renderable content */
  content: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Current status (for assistant messages) */
  status: MessageStatus;
  /** Token count for this message (populated after generation) */
  tokenCount?: number;
  /** Duration in ms (from request to complete) */
  durationMs?: number;
  /** Provider/model used to generate this */
  providerName?: string;
  /** Model name used */
  modelName?: string;
  /** Tool calls made during this turn */
  toolCalls?: ToolCallRecord[];
  /** Tool results received */
  toolResults?: ToolResultRecord[];
  /** Error message if status === 'error' */
  errorMessage?: string;
  /** Slash command used (e.g. /help, /clear) */
  command?: string;
  /** Tool call ID (for tool result messages) */
  tool_call_id?: string;
  /** Tool name (for tool result messages) */
  name?: string;
}

/**
 * Record of a single tool call during an agent turn.
 * Shown as a collapsible card in the UI.
 */
export interface ToolCallRecord {
  /** Tool execution ID */
  id: string;
  /** Tool name (e.g. "read_file", "edit_file") */
  toolName: string;
  /** Arguments passed to the tool (JSON string) */
  arguments: string;
  /** Human-readable summary of what this tool did */
  summary: string;
  /** Start timestamp */
  startedAt: string;
  /** Duration in ms */
  durationMs: number;
  /** Current status */
  status: 'running' | 'success' | 'error';
  /** Result preview (truncated for UI) */
  resultPreview?: string;
  /** Error if status === 'error' */
  error?: string;
}

/**
 * Record of a tool result tied to a tool call.
 */
export interface ToolResultRecord {
  toolCallId: string;
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Payload sent from the WebView to the extension host.
 */
export interface WebViewMessage {
  type: string;
  payload?: unknown;
}

/**
 * Slash command parsed from user input.
 */
export interface SlashCommand {
  command: string;
  args: string;
}
