import * as fs from 'fs';
import * as path from 'path';

export class SessionStore {
  private sessionDir: string;

  constructor(workspacePath?: string) {
    this.sessionDir = path.join(workspacePath || process.cwd(), '.omricode');
    try { fs.mkdirSync(this.sessionDir, { recursive: true }); } catch { /* noop */ }
  }

  save(key: string, data: unknown): void {
    try { fs.writeFileSync(path.join(this.sessionDir, `${key}.json`), JSON.stringify(data, null, 2)); } catch { /* noop */ }
  }

  load<T>(key: string): T | null {
    try { return JSON.parse(fs.readFileSync(path.join(this.sessionDir, `${key}.json`), 'utf-8')) as T; }
    catch { return null; }
  }

  append(key: string, entry: unknown, maxEntries = 100): void {
    const existing = this.load<unknown[]>(key) || [];
    existing.push(entry);
    if (existing.length > maxEntries) existing.splice(0, existing.length - maxEntries);
    this.save(key, existing);
  }

  clear(key: string): void {
    try { fs.unlinkSync(path.join(this.sessionDir, `${key}.json`)); } catch { /* noop */ }
  }
}
