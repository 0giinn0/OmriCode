/**
 * SessionStore.ts
 * OmriCode — Session Persistence Manager
 *
 * Persists chat history, panel state, and agent context to .omricode/
 * in the workspace root. Uses JSON files for simplicity and debuggability.
 *
 * Files:
 *   .omricode/history.json     — Chat messages array
 *   .omricode/session.json     — Current panel state (snap, provider, etc.)
 *   .omricode/context.json     — Persistent agent context
 *   .omricode/undo_stack.json  — Undo/redo records
 *
 * All files are gitignored by default (.omricode/ in .gitignore).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChatMessage } from '../types/message';

const OMRI_DIR = '.omricode';

export class SessionStore {
  private workspacePath: string;
  private omriDir: string;
  private cache: Map<string, any> = new Map();

  constructor() {
    this.workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    this.omriDir = path.join(this.workspacePath, OMRI_DIR);
    this.ensureDir();
  }

  /**
   * Ensure .omricode directory exists and has a .gitkeep.
   */
  private ensureDir(): void {
    try {
      if (!fs.existsSync(this.omriDir)) {
        fs.mkdirSync(this.omriDir, { recursive: true });
      }
      const gitkeep = path.join(this.omriDir, '.gitkeep');
      if (!fs.existsSync(gitkeep)) {
        fs.writeFileSync(gitkeep, '');
      }
    } catch {
      // Silently fail — workspace may not be available
    }
  }

  /**
   * Read a JSON file from .omricode/.
   */
  private readFile<T>(filename: string, defaultValue: T): T {
    const filePath = path.join(this.omriDir, filename);
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(data);
        this.cache.set(filename, parsed);
        return parsed;
      }
    } catch {
      // Corrupted file — reset
    }
    this.cache.set(filename, defaultValue);
    return defaultValue;
  }

  /**
   * Write a JSON file to .omricode/.
   */
  private writeFile<T>(filename: string, data: T): void {
    const filePath = path.join(this.omriDir, filename);
    try {
      this.ensureDir();
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      this.cache.set(filename, data);
    } catch {
      // Silently fail
    }
  }

  // ──────────────────────────────────────────────
  //  Chat History
  // ──────────────────────────────────────────────

  /**
   * Load chat history from disk.
   */
  loadHistory(): ChatMessage[] {
    return this.readFile<ChatMessage[]>('history.json', []);
  }

  /**
   * Save chat history to disk.
   */
  saveHistory(messages: ChatMessage[]): void {
    this.writeFile('history.json', messages);
  }

  /**
   * Append a single message to history.
   */
  appendToHistory(message: ChatMessage): ChatMessage[] {
    const history = this.loadHistory();
    history.push(message);
    this.saveHistory(history);
    return history;
  }

  /**
   * Clear chat history.
   */
  clearHistory(): void {
    this.writeFile('history.json', []);
  }

  // ──────────────────────────────────────────────
  //  Panel State
  // ──────────────────────────────────────────────

  /**
   * Save panel state (snap zone, visibility, size).
   */
  savePanelState(state: Record<string, unknown>): void {
    this.writeFile('session.json', state);
  }

  /**
   * Load panel state.
   */
  loadPanelState(): Record<string, unknown> {
    return this.readFile<Record<string, unknown>>('session.json', {});
  }

  // ──────────────────────────────────────────────
  //  Agent Context
  // ──────────────────────────────────────────────

  /**
   * Save persistent agent context.
   */
  saveContext(context: string): void {
    this.writeFile('context.json', { context, updatedAt: new Date().toISOString() });
  }

  /**
   * Load persistent agent context.
   */
  loadContext(): string {
    const data = this.readFile<{ context: string }>('context.json', { context: '' });
    return data.context || '';
  }

  // ──────────────────────────────────────────────
  //  Undo Stack
  // ──────────────────────────────────────────────

  /**
   * Save undo stack.
   */
  saveUndoStack(stack: any[]): void {
    this.writeFile('undo_stack.json', stack);
  }

  /**
   * Load undo stack.
   */
  loadUndoStack(): any[] {
    return this.readFile<any[]>('undo_stack.json', []);
  }

  // ──────────────────────────────────────────────
  //  Provider Table
  // ──────────────────────────────────────────────

  /**
   * Save provider table (also stored in settings, this is backup).
   */
  saveProviderTable(providers: any[]): void {
    this.writeFile('providers.json', providers);
  }

  /**
   * Load provider table from backup.
   */
  loadProviderTable(): any[] {
    return this.readFile<any[]>('providers.json', []);
  }

  // ──────────────────────────────────────────────
  //  Error Log
  // ──────────────────────────────────────────────

  /**
   * Append to error log.
   */
  logError(error: string, context?: Record<string, unknown>): void {
    try {
      const logPath = path.join(this.omriDir, 'error.log');
      const entry = `[${new Date().toISOString()}] ${error} ${context ? JSON.stringify(context) : ''}\n`;
      this.ensureDir();
      fs.appendFileSync(logPath, entry, 'utf-8');
    } catch {
      // Last resort — fail silently
    }
  }

  /**
   * Get all file paths in .omricode/.
   */
  listFiles(): string[] {
    try {
      if (fs.existsSync(this.omriDir)) {
        return fs.readdirSync(this.omriDir)
          .filter(f => f !== '.gitkeep')
          .map(f => path.join(this.omriDir, f));
      }
    } catch {
      // Silently fail
    }
    return [];
  }

  /**
   * Clear all stored data (resets OmriCode in this workspace).
   */
  clearAll(): void {
    try {
      if (fs.existsSync(this.omriDir)) {
        const files = fs.readdirSync(this.omriDir);
        for (const file of files) {
          if (file !== '.gitkeep') {
            fs.unlinkSync(path.join(this.omriDir, file));
          }
        }
      }
      this.cache.clear();
    } catch {
      // Silently fail
    }
  }

  /**
   * Dispose resources.
   */
  dispose(): void {
    this.cache.clear();
  }
}
