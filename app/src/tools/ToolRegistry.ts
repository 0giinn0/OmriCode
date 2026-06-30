import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { ToolDefinition, ToolExecutionRequest, ToolResult, UndoRecord } from '../types/tool';

type ToolHandler = (args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult> | ToolResult;

interface RegisteredTool { definition: ToolDefinition; handler: ToolHandler; }

const TOOL_DEFINITIONS: ToolDefinition[] = [
  { name: 'read_file', description: 'Read file contents', parameters: { type: 'object', properties: { filePath: { type: 'string', description: 'Absolute path' } }, required: ['filePath'] }, permission: 'workspace' },
  { name: 'write_file', description: 'Write content to a file', parameters: { type: 'object', properties: { filePath: { type: 'string', description: 'Absolute path' }, content: { type: 'string', description: 'Content to write' } }, required: ['filePath', 'content'] }, permission: 'workspace' },
  { name: 'edit_file', description: 'Edit a file (SEARCH/REPLACE)', parameters: { type: 'object', properties: { filePath: { type: 'string', description: 'Absolute path' }, searchText: { type: 'string', description: 'Exact text to find' }, replaceText: { type: 'string', description: 'Replacement text' } }, required: ['filePath', 'searchText', 'replaceText'] }, permission: 'workspace' },
  { name: 'run_bash', description: 'Run a shell command', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Command to run' }, workdir: { type: 'string', description: 'Working directory' } }, required: ['command'] }, permission: 'confirm' },
  { name: 'grep', description: 'Search file contents with regex', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Regex pattern' }, include: { type: 'string', description: 'File glob filter' } }, required: ['pattern'] }, permission: 'workspace' },
  { name: 'glob', description: 'Find files by glob pattern', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Glob pattern' } }, required: ['pattern'] }, permission: 'workspace' },
  { name: 'list_directory', description: 'List directory contents', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] }, permission: 'workspace' },
  { name: 'web_fetch', description: 'Fetch a URL', parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL to fetch' } }, required: ['url'] }, permission: 'confirm' },
];

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private undoStack: UndoRecord[] = [];
  private redoStack: UndoRecord[] = [];

  constructor() { this.registerDefaults(); }

  getDefinitions(): ToolDefinition[] { return TOOL_DEFINITIONS; }
  getUndoStack(): UndoRecord[] { return [...this.undoStack]; }
  getRedoStack(): UndoRecord[] { return [...this.redoStack]; }

  private register(def: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(def.name, { definition: def, handler });
  }

  private registerDefaults(): void {
    this.register(TOOL_DEFINITIONS[0], this.handleReadFile.bind(this));
    this.register(TOOL_DEFINITIONS[1], this.handleWriteFile.bind(this));
    this.register(TOOL_DEFINITIONS[2], this.handleEditFile.bind(this));
    this.register(TOOL_DEFINITIONS[3], this.handleRunBash.bind(this));
    this.register(TOOL_DEFINITIONS[4], this.handleGrep.bind(this));
    this.register(TOOL_DEFINITIONS[5], this.handleGlob.bind(this));
    this.register(TOOL_DEFINITIONS[6], this.handleListDir.bind(this));
    this.register(TOOL_DEFINITIONS[7], this.handleWebFetch.bind(this));
  }

  async execute(request: ToolExecutionRequest, signal?: AbortSignal): Promise<ToolResult> {
    const registered = this.tools.get(request.name);
    if (!registered) return { success: false, output: '', error: `Unknown tool: ${request.name}`, durationMs: 0 };
    const start = Date.now();
    try {
      const result = await registered.handler(request.arguments, signal);
      result.durationMs = Date.now() - start;
      return result;
    } catch (err) {
      return { success: false, output: '', error: (err as Error).message, durationMs: Date.now() - start };
    }
  }

  undoLastEdit(): boolean {
    const record = this.undoStack.pop();
    if (!record) return false;
    this.redoStack.push(record);
    try { fs.writeFileSync(record.filePath, record.originalContent, 'utf-8'); return true; } catch { return false; }
  }

  redoLastEdit(): boolean {
    const record = this.redoStack.pop();
    if (!record) return false;
    this.undoStack.push(record);
    try { fs.writeFileSync(record.filePath, record.newContent, 'utf-8'); return true; } catch { return false; }
  }

  private async handleReadFile(args: Record<string, unknown>): Promise<ToolResult> {
    try { return { success: true, output: fs.readFileSync(args.filePath as string, 'utf-8'), durationMs: 0 }; }
    catch (err) { return { success: false, output: '', error: (err as Error).message, durationMs: 0 }; }
  }

  private async handleWriteFile(args: Record<string, unknown>): Promise<ToolResult> {
    const fp = args.filePath as string;
    const content = args.content as string;
    try {
      if (fs.existsSync(fp)) this.undoStack.push({ timestamp: new Date().toISOString(), filePath: fp, originalContent: fs.readFileSync(fp, 'utf-8'), newContent: content, toolExecutionId: crypto.randomUUID(), description: `Write ${path.basename(fp)}` });
      fs.writeFileSync(fp, content, 'utf-8');
      return { success: true, output: `Written: ${fp}`, durationMs: 0, affectedFiles: [fp] };
    } catch (err) { return { success: false, output: '', error: (err as Error).message, durationMs: 0 }; }
  }

  private async handleEditFile(args: Record<string, unknown>): Promise<ToolResult> {
    const fp = args.filePath as string;
    const search = args.searchText as string;
    const replace = args.replaceText as string;
    try {
      const original = fs.readFileSync(fp, 'utf-8');
      if (!original.includes(search)) return { success: false, output: '', error: `Search text not found in ${fp}`, durationMs: 0 };
      const updated = original.replace(search, replace);
      this.undoStack.push({ timestamp: new Date().toISOString(), filePath: fp, originalContent: original, newContent: updated, toolExecutionId: crypto.randomUUID(), description: `Edit ${path.basename(fp)}` });
      fs.writeFileSync(fp, updated, 'utf-8');
      return { success: true, output: `Edited ${fp}`, durationMs: 0, affectedFiles: [fp] };
    } catch (err) { return { success: false, output: '', error: (err as Error).message, durationMs: 0 }; }
  }

  private handleRunBash(args: Record<string, unknown>): Promise<ToolResult> {
    return new Promise(resolve => {
      exec(args.command as string, { cwd: args.workdir as string || process.cwd(), maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) resolve({ success: false, output: stderr || err.message, error: err.message, durationMs: 0 });
        else resolve({ success: true, output: stdout || '(no output)', durationMs: 0 });
      });
    });
  }

  private async handleGrep(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const regex = new RegExp(args.pattern as string);
      const results: string[] = [];
      const walkDir = (d: string): void => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          const f = path.join(d, e.name);
          if (e.isDirectory()) walkDir(f);
          else {
            const lines = fs.readFileSync(f, 'utf-8').split('\n');
            for (let i = 0; i < lines.length; i++) { if (regex.test(lines[i])) results.push(`${f}:${i + 1}: ${lines[i].trim().slice(0, 200)}`); }
          }
        }
      };
      walkDir(process.cwd());
      return { success: true, output: results.length > 0 ? results.join('\n') : 'No matches.', durationMs: 0 };
    } catch (err) { return { success: false, output: '', error: (err as Error).message, durationMs: 0 }; }
  }

  private async handleGlob(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const glob = require('glob');
      const files = await glob.Glob(args.pattern as string, { cwd: process.cwd(), nodir: true });
      return { success: true, output: files.join('\n') || 'No matches.', durationMs: 0 };
    } catch (err) { return { success: false, output: '', error: (err as Error).message, durationMs: 0 }; }
  }

  private handleListDir(args: Record<string, unknown>): ToolResult {
    try {
      const entries = fs.readdirSync(args.path as string, { withFileTypes: true });
      return { success: true, output: entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n'), durationMs: 0 };
    } catch (err) { return { success: false, output: '', error: (err as Error).message, durationMs: 0 }; }
  }

  private async handleWebFetch(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const resp = await fetch(args.url as string);
      return { success: true, output: (await resp.text()).slice(0, 10000), durationMs: 0 };
    } catch (err) { return { success: false, output: '', error: (err as Error).message, durationMs: 0 }; }
  }
}
