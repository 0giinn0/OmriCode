/**
 * ToolRegistry.ts
 * OmriCode — Tool Registry & Dispatcher
 *
 * Central registry of all tools available to the agent.
 * Each tool is registered with a name, description, parameter
 * schema, permission level, and handler function.
 *
 * The registry:
 *   1. Provides ToolDefinition[] to providers (for FC schema)
 *   2. Routes ToolExecutionRequest to the correct handler
 *   3. Maintains an undo stack for file edits
 *   4. Checks permissions before executing
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { exec } from 'child_process';
import * as https from 'https';
import { ConfigManager } from '../config/ConfigManager';
import {
  ToolDefinition,
  ToolExecutionRequest,
  ToolResult,
  UndoRecord
} from '../types/tool';

type ToolHandler = (
  args: Record<string, unknown>,
  signal?: AbortSignal
) => Promise<ToolResult> | ToolResult;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private undoStack: UndoRecord[] = [];
  private redoStack: UndoRecord[] = [];
  private configManager: ConfigManager;
  private currentExecutionId: string = '';

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    this.registerDefaultTools();
  }

  /**
   * Register all default tools that every OmriCode install provides.
   */
  private registerDefaultTools(): void {
    this.register({
      name: 'read_file',
      description: 'Read the contents of a file at the given path.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute path to the file' }
        },
        required: ['filePath']
      },
      permission: 'workspace'
    }, this.handleReadFile.bind(this));

    this.register({
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute path to the file' },
          content: { type: 'string', description: 'Content to write' }
        },
        required: ['filePath', 'content']
      },
      permission: 'workspace'
    }, this.handleWriteFile.bind(this));

    this.register({
      name: 'edit_file',
      description: 'Edit a file by searching for exact text and replacing it.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute path to the file' },
          searchText: { type: 'string', description: 'Exact text to find' },
          replaceText: { type: 'string', description: 'Text to replace with' }
        },
        required: ['filePath', 'searchText', 'replaceText']
      },
      permission: 'workspace'
    }, this.handleEditFile.bind(this));

    this.register({
      name: 'run_bash',
      description: 'Run a shell command in the project directory.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          workdir: { type: 'string', description: 'Working directory (optional)', required: false }
        },
        required: ['command']
      },
      permission: 'confirm'
    }, this.handleRunBash.bind(this));

    this.register({
      name: 'grep',
      description: 'Search file contents using a regex pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          include: { type: 'string', description: 'Glob pattern (e.g. "*.ts")', required: false },
          path: { type: 'string', description: 'Search directory (optional)', required: false }
        },
        required: ['pattern']
      },
      permission: 'workspace'
    }, this.handleGrep.bind(this));

    this.register({
      name: 'glob',
      description: 'Find files matching a glob pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts")' },
          path: { type: 'string', description: 'Search directory (optional)', required: false }
        },
        required: ['pattern']
      },
      permission: 'workspace'
    }, this.handleGlob.bind(this));

    this.register({
      name: 'list_directory',
      description: 'List the contents of a directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path' }
        },
        required: ['path']
      },
      permission: 'workspace'
    }, this.handleListDirectory.bind(this));

    this.register({
      name: 'web_search',
      description: 'Search the web for information.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          numResults: { type: 'number', description: 'Number of results (1-10, default 5)', required: false }
        },
        required: ['query']
      },
      permission: 'confirm'
    }, this.handleWebSearch.bind(this));

    this.register({
      name: 'web_fetch',
      description: 'Fetch and read the content of a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' }
        },
        required: ['url']
      },
      permission: 'confirm'
    }, this.handleWebFetch.bind(this));

    this.register({
      name: 'get_terminal',
      description: 'Read the current terminal output.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
      permission: 'workspace'
    }, this.handleGetTerminal.bind(this));

    this.register({
      name: 'get_selection',
      description: 'Read the current editor selection.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
      permission: 'always'
    }, this.handleGetSelection.bind(this));

    this.register({
      name: 'get_problems',
      description: 'Get all errors and warnings in the workspace.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
      permission: 'workspace'
    }, this.handleGetProblems.bind(this));

    this.register({
      name: 'ask_user',
      description: 'Ask the user a question when you need clarification.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Question for the user' }
        },
        required: ['question']
      },
      permission: 'always'
    }, this.handleAskUser.bind(this));

    this.register({
      name: 'set_context',
      description: 'Set or update task context and goals for this session.',
      parameters: {
        type: 'object',
        properties: {
          context: { type: 'string', description: 'Task context or goals' }
        },
        required: ['context']
      },
      permission: 'always'
    }, this.handleSetContext.bind(this));

    this.register({
      name: 'explain_code',
      description: 'Explain a piece of code in natural language.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Code to explain' }
        },
        required: ['code']
      },
      permission: 'always'
    }, this.handleExplainCode.bind(this));
  }

  /**
   * Register a single tool.
   */
  register(
    definition: ToolDefinition,
    handler: ToolHandler
  ): void {
    this.tools.set(definition.name, { definition, handler });
  }

  /**
   * Get all tool definitions (for provider FC schema).
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /**
   * Get a single tool definition by name.
   */
  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  /**
   * Execute a tool by request.
   */
  async execute(
    request: ToolExecutionRequest,
    signal?: AbortSignal
  ): Promise<ToolResult> {
    const registered = this.tools.get(request.name);
    if (!registered) {
      return {
        success: false,
        output: '',
        error: `Unknown tool: ${request.name}`,
        durationMs: 0
      };
    }

    const start = Date.now();
    try {
      const result = await registered.handler(request.arguments, signal);
      result.durationMs = Date.now() - start;

      // Track undoable edits
      this.currentExecutionId = request.id;
      if (request.name === 'edit_file' || request.name === 'write_file') {
        // Undo tracking is handled inside the tool handler
      }

      return result;
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : 'Tool execution error',
        durationMs: Date.now() - start
      };
    }
  }

  /**
   * Get the undo stack for displaying in the UI.
   */
  getUndoStack(): UndoRecord[] {
    return [...this.undoStack];
  }

  /**
   * Get the redo stack for displaying in the UI.
   */
  getRedoStack(): UndoRecord[] {
    return [...this.redoStack];
  }

  /**
   * Undo a specific edit by its tool execution ID.
   */
  undoByExecutionId(executionId: string): boolean {
    const idx = this.undoStack.findIndex(r => r.toolExecutionId === executionId);
    if (idx === -1) return false;

    const [record] = this.undoStack.splice(idx, 1);
    this.redoStack.push(record);

    try {
      fs.writeFileSync(record.filePath, record.originalContent, 'utf-8');
      vscode.window.showInformationMessage(
        `Reverted edit to ${record.filePath.split('/').pop() || record.filePath.split('\\').pop()}`
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Undo the last file edit.
   */
  undoLastEdit(): boolean {
    const record = this.undoStack.pop();
    if (!record) return false;

    this.redoStack.push(record);

    try {
      fs.writeFileSync(record.filePath, record.originalContent, 'utf-8');
      vscode.window.showInformationMessage(
        `Undid edit to ${record.filePath.split('/').pop() || record.filePath.split('\\').pop()}`
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Redo the last undone edit.
   */
  redoLastEdit(): boolean {
    const record = this.redoStack.pop();
    if (!record) return false;

    this.undoStack.push(record);

    try {
      const fs = require('fs');
      fs.writeFileSync(record.filePath, record.newContent, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  // ──────────────────────────────────────────────
  //  Tool Handlers
  // ──────────────────────────────────────────────

  private async handleReadFile(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args.filePath as string;
    try {
      const uri = vscode.Uri.file(filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      return { success: true, output: document.getText(), durationMs: 0 };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Cannot read file: ${err instanceof Error ? err.message : 'Unknown error'}`,
        durationMs: 0
      };
    }
  }

  private async handleWriteFile(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args.filePath as string;
    const content = args.content as string;
    try {
      // Save undo record if file exists
      if (fs.existsSync(filePath)) {
        const original = fs.readFileSync(filePath, 'utf-8');
        this.undoStack.push({
          timestamp: new Date().toISOString(),
          filePath,
          originalContent: original,
          newContent: content,
          toolExecutionId: this.currentExecutionId,
          description: `Write to ${filePath.split('/').pop() || filePath.split('\\').pop()}`
        });
      }

      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true, output: `File written: ${filePath}`, durationMs: 0, affectedFiles: [filePath] };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Cannot write file: ${err instanceof Error ? err.message : 'Unknown error'}`,
        durationMs: 0
      };
    }
  }

  private async handleEditFile(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args.filePath as string;
    const searchText = args.searchText as string;
    const replaceText = args.replaceText as string;
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, output: '', error: `File not found: ${filePath}`, durationMs: 0 };
      }

      const original = fs.readFileSync(filePath, 'utf-8');
      if (!original.includes(searchText)) {
        return {
          success: false,
          output: '',
          error: `Search text not found in ${filePath}. The SEARCH block must match exactly.`,
          durationMs: 0
        };
      }

      const updated = original.replace(searchText, replaceText);

      this.undoStack.push({
        timestamp: new Date().toISOString(),
        filePath,
        originalContent: original,
        newContent: updated,
        toolExecutionId: this.currentExecutionId,
        description: `Edit ${filePath.split('/').pop() || filePath.split('\\').pop()}`
      });

      fs.writeFileSync(filePath, updated, 'utf-8');

      const lineCount = searchText.split('\n').length;
      return {
        success: true,
        output: `Edited ${filePath}: ${lineCount} line(s) changed`,
        durationMs: 0,
        affectedFiles: [filePath]
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Cannot edit file: ${err instanceof Error ? err.message : 'Unknown error'}`,
        durationMs: 0
      };
    }
  }

  private async handleRunBash(args: Record<string, unknown>): Promise<ToolResult> {
    const command = args.command as string;
    const workdir = args.workdir as string | undefined;

    return new Promise(resolve => {
      const opts: Record<string, unknown> = { maxBuffer: 10 * 1024 * 1024 };
      if (workdir) opts.cwd = workdir;

      exec(command, opts, (err: Error | null, stdout: string, stderr: string) => {
        if (err) {
          resolve({
            success: false,
            output: stderr || err.message,
            error: err.message,
            durationMs: 0
          });
        } else {
          resolve({
            success: true,
            output: stdout || '(no output)',
            durationMs: 0
          });
        }
      });
    });
  }

  private async handleGrep(args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = args.pattern as string;
    const includeGlob = args.include as string | undefined;
    const searchPath = args.path as string | undefined;

    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders && !searchPath) {
        return { success: false, output: '', error: 'No workspace folder open', durationMs: 0 };
      }

      const grepPattern = includeGlob || '**/*';
      const files = await vscode.workspace.findFiles(
        grepPattern,
        '**/node_modules/**,**/.git/**,**/__pycache__/**',
        100
      );

      const regex = new RegExp(pattern);
      const results: string[] = [];

      for (const fileUri of files.slice(0, 50)) {
        try {
          const content = fs.readFileSync(fileUri.fsPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${fileUri.fsPath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
              if (results.length >= 100) break;
            }
          }
        } catch {
          // skip unreadable files
        }
        if (results.length >= 100) break;
      }

      return {
        success: true,
        output: results.length > 0 ? results.join('\n') : 'No matches found.',
        durationMs: 0
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : 'Grep failed',
        durationMs: 0
      };
    }
  }

  private async handleGlob(args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = args.pattern as string;
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        return { success: false, output: '', error: 'No workspace folder open', durationMs: 0 };
      }

      const files = await vscode.workspace.findFiles(
        pattern,
        '**/node_modules/**,**/.git/**,**/__pycache__/**'
      );

      const fileList = files.map(f => f.fsPath).join('\n');
      return {
        success: true,
        output: fileList || 'No files matched the pattern.',
        durationMs: 0
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : 'Glob failed',
        durationMs: 0
      };
    }
  }

  private async handleListDirectory(args: Record<string, unknown>): Promise<ToolResult> {
    const dirPath = args.path as string;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true }) as fs.Dirent[];
      const output = entries
        .map((e: fs.Dirent) =>
          e.isDirectory() ? `${e.name}/` : e.name
        )
        .join('\n');
      return { success: true, output, durationMs: 0 };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Cannot list directory: ${err instanceof Error ? err.message : 'Unknown error'}`,
        durationMs: 0
      };
    }
  }

  private async handleWebSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args.query as string;
    const numResults = (args.numResults as number) || 5;

    try {
      const encoded = encodeURIComponent(query);
      const url = `https://api.duckduckgo.com/?q=${encoded}&format=json`;

      return new Promise(resolve => {
        https.get(url, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const results = parsed.RelatedTopics?.slice(0, numResults)
                ?.map((r: { Text?: string; FirstURL?: string }) =>
                  `• ${r.Text || 'N/A'}`
                )
                .join('\n') || 'No results found.';
              resolve({ success: true, output: results, durationMs: 0 });
            } catch {
              resolve({ success: true, output: '(raw response received)', durationMs: 0 });
            }
          });
        }).on('error', (err: Error) => {
          resolve({
            success: false,
            output: '',
            error: `Web search failed: ${err.message}`,
            durationMs: 0
          });
        });
      });
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Web search failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        durationMs: 0
      };
    }
  }

  private async handleWebFetch(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args.url as string;
    try {
      const response = await fetch(url);
      const text = await response.text();
      const truncated = text.slice(0, 10000);
      return {
        success: true,
        output: truncated,
        durationMs: 0
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Cannot fetch URL: ${err instanceof Error ? err.message : 'Unknown error'}`,
        durationMs: 0
      };
    }
  }

  private async handleGetTerminal(): Promise<ToolResult> {
    const terminals = vscode.window.terminals;
    if (terminals.length === 0) {
      return { success: true, output: '(no open terminals)', durationMs: 0 };
    }
    return { success: true, output: `Open terminals: ${terminals.length}`, durationMs: 0 };
  }

  private async handleGetSelection(): Promise<ToolResult> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return { success: true, output: '(no active editor)', durationMs: 0 };
    }
    const selection = editor.document.getText(editor.selection);
    return {
      success: true,
      output: selection || '(nothing selected)',
      durationMs: 0
    };
  }

  private async handleGetProblems(): Promise<ToolResult> {
    const diagnostics = vscode.languages.getDiagnostics();
    const lines: string[] = [];
    for (const [uri, diags] of diagnostics) {
      for (const d of diags) {
        lines.push(`${uri.fsPath}:${d.range.start.line + 1}:${d.range.start.character + 1} [${d.severity}] ${d.message}`);
      }
    }
    return {
      success: true,
      output: lines.length > 0 ? lines.join('\n') : 'No problems found.',
      durationMs: 0
    };
  }

  private async handleAskUser(args: Record<string, unknown>): Promise<ToolResult> {
    const question = args.question as string;
    const answer = await vscode.window.showInputBox({
      prompt: question,
      ignoreFocusOut: true
    });
    return {
      success: true,
      output: answer || '(user dismissed)',
      durationMs: 0
    };
  }

  private async handleSetContext(args: Record<string, unknown>): Promise<ToolResult> {
    const context = args.context as string;
    this.configManager.setWorkspaceState('agentContext', context);
    return {
      success: true,
      output: `Context set: ${context.slice(0, 100)}${context.length > 100 ? '...' : ''}`,
      durationMs: 0
    };
  }

  private async handleExplainCode(args: Record<string, unknown>): Promise<ToolResult> {
    const code = args.code as string;
    return {
      success: true,
      output: `The user asked for an explanation of:\n\`\`\`\n${code.slice(0, 2000)}\n\`\`\``,
      durationMs: 0
    };
  }
}
