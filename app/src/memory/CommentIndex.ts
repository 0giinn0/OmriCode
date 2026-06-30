import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface CommentEntry {
  id: string;
  filePath: string;
  lineNumber: number;
  comment: string;
  language: string;
  timestamp: string;
  embedding?: number[];
}

interface SearchResult {
  entry: CommentEntry;
  score: number;
  snippet: string;
}

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
  cpp: {
    single: /\/\/\s*(.+)$/gm,
    multiStart: '/*',
    multiEnd: '*/',
    doc: /\/\*\*\s*([\s\S]*?)\*\//g
  },
  rust: {
    single: /\/\/\s*(.+)$/gm,
    multiStart: '/*',
    multiEnd: '*/',
    doc: /\/\/\/\s*(.+)$/gm
  },
  lua: {
    single: /--\s*(.+)$/gm,
    multiStart: '--[[',
    multiEnd: ']]',
    doc: /---\s*(.+)$/gm
  }
};

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.gd': 'gdscript',
  '.cs': 'csharp',
  '.c': 'cpp',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.rs': 'rust',
  '.lua': 'lua'
};

export class CommentIndex {
  private workspacePath: string;
  private index: CommentEntry[] = [];
  private indexedFiles: Set<string> = new Set();

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  async initialize(): Promise<void> {
    const indexPath = path.join(this.workspacePath, '.omricode', 'comment_index.json');
    try {
      if (fs.existsSync(indexPath)) {
        const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as CommentEntry[];
        this.index = data;
        this.indexedFiles = new Set(data.map(e => e.filePath));
      }
    } catch {
      // Corrupted index — start fresh
    }

    await this.scanWorkspace();
  }

  async scanWorkspace(): Promise<void> {
    const files = this.walkFiles(this.workspacePath);

    for (const filePath of files) {
      await this.indexFile(filePath);
    }

    this.persist();
  }

  async indexFile(filePath: string): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const ext = path.extname(filePath).toLowerCase();
      const language = EXT_TO_LANG[ext] || 'javascript';
      const patterns = COMMENT_PATTERNS[language] || COMMENT_PATTERNS['javascript'];

      this.index = this.index.filter(e => e.filePath !== filePath);

      const lines = content.split('\n');
      const entries: CommentEntry[] = [];

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

      if (patterns.doc) {
        const docMatches = content.matchAll(patterns.doc);
        for (const match of docMatches) {
          const docText = (match[1] || match[2] || match[0]).trim();
          if (docText) {
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

  removeFile(filePath: string): void {
    this.index = this.index.filter(e => e.filePath !== filePath);
    this.indexedFiles.delete(filePath);
  }

  search(query: string, maxResults: number = 10): SearchResult[] {
    const lowerQuery = query.toLowerCase();
    const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 2);

    const scored: SearchResult[] = this.index
      .map(entry => {
        const lowerComment = entry.comment.toLowerCase();
        let score = 0;

        if (lowerComment.includes(lowerQuery)) {
          score += 10;
        }

        for (const word of queryWords) {
          if (lowerComment.includes(word)) {
            score += 2;
          }
        }

        score += Math.max(0, 5 - entry.comment.length / 20);

        return { entry, score, snippet: this.getSnippet(entry) };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    return scored;
  }

  private getSnippet(entry: CommentEntry): string {
    const relativePath = entry.filePath.replace(this.workspacePath, '').replace(/^[/\\]/, '');
    return `${relativePath}:${entry.lineNumber}`;
  }

  getCommentsForFile(filePath: string): CommentEntry[] {
    return this.index.filter(e => e.filePath === filePath);
  }

  get size(): number {
    return this.index.length;
  }

  get fileCount(): number {
    return this.indexedFiles.size;
  }

  private persist(): void {
    const dir = path.join(this.workspacePath, '.omricode');
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(dir, 'comment_index.json'), JSON.stringify(this.index, null, 2));
    } catch {
      // Silently fail
    }
  }

  private walkFiles(dir: string): string[] {
    const results: string[] = [];
    const exclude = new Set(['node_modules', '.git', '__pycache__', 'out', 'dist', 'build', '.omricode']);

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (exclude.has(entry.name) || entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.walkFiles(fullPath));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext in EXT_TO_LANG) {
            results.push(fullPath);
          }
        }
      }
    } catch {
      // Permission denied or missing directory
    }

    return results;
  }

  dispose(): void {
    this.persist();
  }
}
