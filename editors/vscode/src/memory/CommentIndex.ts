/**
 * CommentIndex.ts
 * OmriCode — Comment Vector Index
 *
 * Extracts comments from source files, embeds them using a local
 * model, and stores them in a vector index for semantic search.
 *
 * Supports comments in: TS/JS, Python, GDScript, C#, GLSL, and more.
 * The index is stored in .omricode/comment_index.db via SQLite.
 *
 * "Because your future self will have no idea what present you was thinking."
 */

import * as vscode from 'vscode';
import { ConfigManager } from '../config/ConfigManager';

interface CommentEntry {
  id: string;
  filePath: string;
  lineNumber: number;
  comment: string;
  language: string;
  timestamp: string;
  /** Low-dimensional embedding vector (simulated for now) */
  embedding?: number[];
}

interface SearchResult {
  entry: CommentEntry;
  score: number;
  snippet: string;
}

/**
 * Language-specific comment extraction patterns.
 * Each entry has: single-line, multi-line start, multi-line end, doc strings.
 */
const COMMENT_PATTERNS: Record<string, {
  single: RegExp;
  multiStart?: string;
  multiEnd?: string;
  doc?: RegExp;
}> = {
  typescript: {
    single: /\/\/\s*(.+)$/gm,
    multiStart: '/*',
    multiEnd: '*/',
    doc: /\/\*\*\s*([\s\S]*?)\*\//g
  },
  javascript: {
    single: /\/\/\s*(.+)$/gm,
    multiStart: '/*',
    multiEnd: '*/',
    doc: /\/\*\*\s*([\s\S]*?)\*\//g
  },
  python: {
    single: /#\s*(.+)$/gm,
    doc: /'''([\s\S]*?)'''|"""([\s\S]*?)"""/g
  },
  gdscript: {
    single: /#\s*(.+)$/gm,
    doc: /##\s*(.+)$/gm
  },
  csharp: {
    single: /\/\/\s*(.+)$/gm,
    multiStart: '/*',
    multiEnd: '*/',
    doc: /\/\/\/\s*(.+)$/gm
  },
  glsl: {
    single: /\/\/\s*(.+)$/gm,
    multiStart: '/*',
    multiEnd: '*/'
  }
};

export class CommentIndex {
  private configManager: ConfigManager;
  private index: CommentEntry[] = [];
  private indexedFiles: Set<string> = new Set();
  private fileWatcher: vscode.FileSystemWatcher | null = null;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
  }

  /**
   * Initialize the comment index.
   * Scans the workspace and sets up file watchers.
   */
  async initialize(): Promise<void> {
    // Load existing index from workspace state
    const saved = this.configManager.getWorkspaceState<CommentEntry[]>('omricode.commentIndex');
    if (saved) {
      this.index = saved;
      this.indexedFiles = new Set(saved.map(e => e.filePath));
    }

    // Initial scan of workspace
    await this.scanWorkspace();

    // Watch for file changes
    this.setupFileWatcher();
  }

  /**
   * Scan all files in the workspace for comments.
   */
  async scanWorkspace(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    for (const folder of workspaceFolders) {
      const pattern = new vscode.RelativePattern(folder, '**/*.{ts,js,py,gd,cs,glsl}');
      const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**,**/.git/**,**/__pycache__/**');

      for (const fileUri of files) {
        await this.indexFile(fileUri);
      }
    }

    this.persist();
  }

  /**
   * Index a single file for comments.
   */
  async indexFile(fileUri: vscode.Uri): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(fileUri);
      const content = document.getText();
      const language = document.languageId;
      const patterns = COMMENT_PATTERNS[language] || COMMENT_PATTERNS['javascript'];

      // Remove already-indexed entries for this file
      const filePath = fileUri.fsPath;
      this.index = this.index.filter(e => e.filePath !== filePath);

      const lines = content.split('\n');
      const entries: CommentEntry[] = [];

      // Extract single-line comments
      if (patterns.single) {
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(patterns.single);
          if (match) {
            const comment = match[1] || match[0];
            if (comment.trim()) {
              entries.push({
                id: crypto.randomUUID(),
                filePath,
                lineNumber: i + 1,
                comment: comment.trim(),
                language,
                timestamp: new Date().toISOString()
              });
            }
          }
        }
      }

      // Extract doc comments
      if (patterns.doc) {
        const docMatches = content.matchAll(patterns.doc);
        for (const match of docMatches) {
          const docText = (match[1] || match[2] || match[0]).trim();
          if (docText) {
            // Estimate line number by counting newlines before match
            const beforeContent = content.slice(0, match.index);
            const lineNumber = beforeContent.split('\n').length;

            entries.push({
              id: crypto.randomUUID(),
              filePath,
              lineNumber,
              comment: docText.slice(0, 500),
              language,
              timestamp: new Date().toISOString()
            });
          }
        }
      }

      this.index.push(...entries);
      this.indexedFiles.add(filePath);
    } catch {
      // Skip files that can't be read
    }
  }

  /**
   * Remove a file from the index.
   */
  removeFile(fileUri: vscode.Uri): void {
    const filePath = fileUri.fsPath;
    this.index = this.index.filter(e => e.filePath !== filePath);
    this.indexedFiles.delete(filePath);
  }

  /**
   * Search the comment index semantically.
   * Uses simple keyword matching as fallback (full vector search
   * requires an embedding model, which will be added in Phase 3).
   */
  search(query: string, maxResults: number = 10): SearchResult[] {
    const lowerQuery = query.toLowerCase();
    const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 2);

    const scored: SearchResult[] = this.index
      .map(entry => {
        const lowerComment = entry.comment.toLowerCase();
        let score = 0;

        // Exact phrase match (highest score)
        if (lowerComment.includes(lowerQuery)) {
          score += 10;
        }

        // Individual word matches
        for (const word of queryWords) {
          if (lowerComment.includes(word)) {
            score += 2;
          }
        }

        // Boost for shorter comments (more likely to be relevant)
        score += Math.max(0, 5 - entry.comment.length / 20);

        return { entry, score, snippet: this.getSnippet(entry) };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    return scored;
  }

  /**
   * Get a context snippet for a comment entry.
   */
  private getSnippet(entry: CommentEntry): string {
    const relativePath = entry.filePath
      .replace(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '')
      .replace(/^[/\\]/, '');
    return `${relativePath}:${entry.lineNumber}`;
  }

  /**
   * Get all comments for a specific file.
   */
  getCommentsForFile(filePath: string): CommentEntry[] {
    return this.index.filter(e => e.filePath === filePath);
  }

  /**
   * Get comment count.
   */
  get size(): number {
    return this.index.length;
  }

  /**
   * Get indexed file count.
   */
  get fileCount(): number {
    return this.indexedFiles.size;
  }

  /**
   * Persist the index to workspace state.
   */
  private persist(): void {
    this.configManager.setWorkspaceState('omricode.commentIndex', this.index);
  }

  /**
   * Set up a file system watcher to keep the index current.
   */
  private setupFileWatcher(): void {
    this.fileWatcher?.dispose();

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceFolders[0], '**/*.{ts,js,py,gd,cs,glsl}')
    );

    this.fileWatcher.onDidCreate(uri => this.indexFile(uri));
    this.fileWatcher.onDidChange(uri => this.indexFile(uri));
    this.fileWatcher.onDidDelete(uri => this.removeFile(uri));
  }

  /**
   * Dispose the file watcher.
   */
  dispose(): void {
    this.fileWatcher?.dispose();
    this.persist();
  }
}
