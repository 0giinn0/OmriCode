import * as fs from 'fs';
import * as path from 'path';
import { VectorStore, VectorEntry, VectorSearchResult, EmbeddingProvider } from './VectorStore';

interface RagConfig {
  chunkSize: number;
  excludePatterns: string[];
  includeExtensions: string[];
}

const DEFAULT_RAG_CONFIG: RagConfig = {
  chunkSize: 50,
  excludePatterns: ['node_modules', '.git', '__pycache__', 'out', 'dist', 'build', '.omricode'],
  includeExtensions: ['.ts', '.js', '.tsx', '.jsx', '.py', '.gd', '.cs', '.rs', '.go', '.swift', '.kt', '.java', '.php', '.rb', '.c', '.cpp', '.h', '.hpp', '.glsl', '.fs', '.vs']
};

export class CodebaseRAG {
  private ragConfig: RagConfig;
  private vectorStore: VectorStore;
  private embedder: EmbeddingProvider;
  private workspacePath: string;
  private initialized: boolean = false;
  private indexing: boolean = false;

  constructor(workspacePath: string, ragConfig?: Partial<RagConfig>) {
    this.workspacePath = workspacePath;
    this.ragConfig = { ...DEFAULT_RAG_CONFIG, ...ragConfig };
    this.vectorStore = new VectorStore(workspacePath);
    this.embedder = new EmbeddingProvider();
  }

  async initialize(): Promise<void> {
    await this.vectorStore.initialize();
    await this.embedder.loadModel();
    this.initialized = true;

    if (this.vectorStore.size === 0) {
      await this.refreshIndex();
    }
  }

  async refreshIndex(): Promise<void> {
    if (this.indexing) return;
    this.indexing = true;

    try {
      const files = this.walkFiles(this.workspacePath);
      const batch: VectorEntry[] = [];

      for (let fi = 0; fi < files.length; fi++) {
        const filePath = files[fi];
        const content = this.readFileSafe(filePath);
        if (!content) continue;

        const chunks = this.chunkContent(content, filePath, this.ragConfig.chunkSize);
        for (const chunk of chunks) {
          batch.push(chunk);
        }

        if (fi % 50 === 0 && batch.length > 0) {
          const embeddings = await this.embedder.embedBatch(batch.map(b => b.text));
          for (let i = 0; i < batch.length; i++) {
            batch[i].embedding = embeddings[i];
          }
          await this.vectorStore.upsertBatch(batch);
          batch.length = 0;
        }
      }

      if (batch.length > 0) {
        const embeddings = await this.embedder.embedBatch(batch.map(b => b.text));
        for (let i = 0; i < batch.length; i++) {
          batch[i].embedding = embeddings[i];
        }
        await this.vectorStore.upsertBatch(batch);
      }
    } finally {
      this.indexing = false;
    }
  }

  async search(query: string, topK: number = 8): Promise<VectorSearchResult[]> {
    if (!this.initialized) await this.initialize();

    const queryEmbedding = await this.embedder.embed(query);
    return this.vectorStore.search(queryEmbedding, query, topK);
  }

  formatResults(results: VectorSearchResult[]): string {
    if (results.length === 0) return '';

    const lines: string[] = ['## Relevant Code Context'];
    for (const r of results) {
      const filePath = r.entry.filePath;
      const relPath = filePath.replace(this.workspacePath, '').replace(/^[/\\]/, '') || filePath;
      lines.push('');
      lines.push(`### ${relPath}:${r.entry.startLine}-${r.entry.endLine} (score: ${r.score.toFixed(2)})`);
      const code = r.entry.text.split('\n').slice(0, 20).join('\n');
      lines.push('```');
      lines.push(code);
      lines.push('```');
    }

    return lines.join('\n');
  }

  private chunkContent(content: string, filePath: string, chunkSize: number): VectorEntry[] {
    const entries: VectorEntry[] = [];
    const ext = path.extname(filePath).toLowerCase();
    const lines = content.split('\n');

    const funcRegex = this.getFunctionRegex(ext);
    if (funcRegex) {
      const matches = content.matchAll(funcRegex);
      for (const match of matches) {
        const name = match[1] || match[2] || 'anonymous';
        const startLine = content.slice(0, match.index).split('\n').length;
        const endLine = startLine + match[0].split('\n').length - 1;

        entries.push({
          id: `${filePath}:fn:${name}:${startLine}`,
          text: match[0],
          filePath,
          startLine,
          endLine,
          metadata: { language: ext, chunkType: 'function', name },
          timestamp: new Date().toISOString()
        });
      }
    }

    const coveredLines = new Set<number>();
    for (const e of entries) {
      for (let i = e.startLine; i <= e.endLine; i++) coveredLines.add(i);
    }

    let blockStart = 1;
    while (blockStart <= lines.length) {
      if (coveredLines.has(blockStart)) {
        blockStart++;
        continue;
      }
      let blockEnd = Math.min(blockStart + chunkSize - 1, lines.length);
      while (blockEnd > blockStart && coveredLines.has(blockEnd)) blockEnd--;
      const text = lines.slice(blockStart - 1, blockEnd).join('\n');
      if (text.trim()) {
        entries.push({
          id: `${filePath}:block:${blockStart}`,
          text,
          filePath,
          startLine: blockStart,
          endLine: blockEnd,
          metadata: { language: ext, chunkType: 'block' },
          timestamp: new Date().toISOString()
        });
      }
      blockStart = blockEnd + 1;
    }

    return entries;
  }

  private getFunctionRegex(ext: string): RegExp | null {
    switch (ext) {
      case '.ts': case '.tsx': case '.js': case '.jsx':
        return /(?:export\s+)?(?:function\s+(\w+)|class\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function))/g;
      case '.py':
        return /(?:def\s+(\w+)|class\s+(\w+))/g;
      case '.gd':
        return /(?:func\s+(\w+)|class\s+(\w+))/g;
      case '.rs':
        return /(?:fn\s+(\w+)|struct\s+(\w+)|impl\s+(\w+))/g;
      case '.go':
        return /(?:func\s+(\w+)|type\s+(\w+)\s+struct)/g;
      case '.cs':
        return /(?:public|private|protected|internal)?\s*(?:static\s+)?(?:void|string|int|bool|float|double|var|Task|async Task)?\s+(\w+)\s*\(|class\s+(\w+)/g;
      default:
        return null;
    }
  }

  private readFileSafe(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  private walkFiles(dir: string): string[] {
    const results: string[] = [];
    const excludeSet = new Set(this.ragConfig.excludePatterns);

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (excludeSet.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.walkFiles(fullPath));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (this.ragConfig.includeExtensions.includes(ext)) {
            results.push(fullPath);
          }
        }
      }
    } catch {
      // Permission denied or missing directory
    }

    return results;
  }

  async onFileChanged(filePath: string): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();
    const supported = ['.ts', '.js', '.tsx', '.jsx', '.py', '.gd', '.cs', '.rs', '.go'];
    if (!supported.includes(ext)) return;

    this.vectorStore.removeByFile(filePath);
    const content = this.readFileSafe(filePath);
    if (!content) return;

    const chunks = this.chunkContent(content, filePath, this.ragConfig.chunkSize);
    for (const chunk of chunks) {
      chunk.embedding = await this.embedder.embed(chunk.text);
    }
    await this.vectorStore.upsertBatch(chunks);
  }

  get store(): VectorStore {
    return this.vectorStore;
  }

  get isIndexing(): boolean {
    return this.indexing;
  }

  dispose(): void {
    this.vectorStore.dispose();
  }
}
