import * as fs from 'fs';
import * as path from 'path';
import { ChatMessage } from '../types/message';

export class SessionStore {
  private sessionDir: string;
  private cache: Map<string, any> = new Map();

  constructor(workspacePath?: string) {
    this.sessionDir = path.join(workspacePath || process.cwd(), '.omricode');
    this.ensureDir();
  }

  private ensureDir(): void {
    try {
      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }
    } catch {
      // Silently fail
    }
  }

  save(key: string, data: unknown): void {
    try {
      this.ensureDir();
      fs.writeFileSync(path.join(this.sessionDir, `${key}.json`), JSON.stringify(data, null, 2));
      this.cache.set(key, data);
    } catch {
      // noop
    }
  }

  load<T>(key: string): T | null {
    try {
      if (this.cache.has(key)) return this.cache.get(key) as T;
      const filePath = path.join(this.sessionDir, `${key}.json`);
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
        this.cache.set(key, data);
        return data;
      }
    } catch {
      // noop
    }
    return null;
  }

  append(key: string, entry: unknown, maxEntries = 100): void {
    const existing = this.load<unknown[]>(key) || [];
    existing.push(entry);
    if (existing.length > maxEntries) existing.splice(0, existing.length - maxEntries);
    this.save(key, existing);
  }

  clear(key: string): void {
    try {
      const filePath = path.join(this.sessionDir, `${key}.json`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      this.cache.delete(key);
    } catch {
      // noop
    }
  }

  loadHistory(): ChatMessage[] {
    return this.load<ChatMessage[]>('chat_history') || [];
  }

  saveHistory(messages: ChatMessage[]): void {
    this.save('chat_history', messages);
  }

  appendToHistory(message: ChatMessage): ChatMessage[] {
    const history = this.loadHistory();
    history.push(message);
    this.saveHistory(history);
    return history;
  }

  clearHistory(): void {
    this.clear('chat_history');
  }

  savePanelState(state: Record<string, unknown>): void {
    this.save('session', state);
  }

  loadPanelState(): Record<string, unknown> {
    return this.load<Record<string, unknown>>('session') || {};
  }

  saveContext(context: string): void {
    this.save('context', { context, updatedAt: new Date().toISOString() });
  }

  loadContext(): string {
    const data = this.load<{ context: string }>('context');
    return data?.context || '';
  }

  saveUndoStack(stack: any[]): void {
    this.save('undo_stack', stack);
  }

  loadUndoStack(): any[] {
    return this.load<any[]>('undo_stack') || [];
  }

  saveProviderTable(providers: any[]): void {
    this.save('providers', providers);
  }

  loadProviderTable(): any[] {
    return this.load<any[]>('providers') || [];
  }

  logError(error: string, context?: Record<string, unknown>): void {
    try {
      const logPath = path.join(this.sessionDir, 'error.log');
      const entry = `[${new Date().toISOString()}] ${error} ${context ? JSON.stringify(context) : ''}\n`;
      this.ensureDir();
      fs.appendFileSync(logPath, entry, 'utf-8');
    } catch {
      // Last resort — fail silently
    }
  }

  listFiles(): string[] {
    try {
      if (fs.existsSync(this.sessionDir)) {
        return fs.readdirSync(this.sessionDir)
          .filter(f => f !== '.gitkeep')
          .map(f => path.join(this.sessionDir, f));
      }
    } catch {
      // Silently fail
    }
    return [];
  }

  clearAll(): void {
    try {
      if (fs.existsSync(this.sessionDir)) {
        const files = fs.readdirSync(this.sessionDir);
        for (const file of files) {
          if (file !== '.gitkeep') {
            fs.unlinkSync(path.join(this.sessionDir, file));
          }
        }
      }
      this.cache.clear();
    } catch {
      // Silently fail
    }
  }

  dispose(): void {
    this.cache.clear();
  }
}
