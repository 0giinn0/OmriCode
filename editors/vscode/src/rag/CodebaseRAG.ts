/**
 * CodebaseRAG.ts
 * OmriCode — Codebase Retrieval-Augmented Generation
 *
 * Chunks the project files by function/class boundaries and 50-line blocks,
 * embeds them via EmbeddingProvider, and stores in VectorStore.
 *
 * On each agent turn, the most relevant chunks are injected into the
 * system prompt so the model has awareness of the full codebase.
 *
 * Flow:
 *   First run / manual refresh → Walk files → Chunk → Embed → Store
 *   Each turn → query→ VectorStore.search() → inject top K chunks
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../config/ConfigManager';
import { VectorStore, VectorEntry, VectorSearchResult, EmbeddingProvider } from './VectorStore';



export class CodebaseRAG {
  private configManager: ConfigManager;
  private vectorStore: VectorStore;
  private embedder: EmbeddingProvider;
  private initialized: boolean = false;
  private indexing: boolean = false;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    this.vectorStore = new VectorStore(workspacePath);
    this.embedder = new EmbeddingProvider();
  }

  /**
   * Initialize: load vector store from disk, load embedding model.
   */
  async initialize(): Promise<void> {
    await this.vectorStore.initialize();
    await this.embedder.loadModel();
    this.initialized = true;

    // Auto-index if store is empty
    if (this.vectorStore.size === 0) {
      await this.refreshIndex();
    }
  }

  /**
   * Walk workspace files, chunk each file, embed, and store.
   */
  async refreshIndex(): Promise<void> {
    if (this.indexing) return;
    this.indexing = true;

    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) return;

      const ragConfig = this.configManager.getRagConfig();
      const chunkSize = ragConfig.chunkSize;
      const excludePatterns = ['**/node_modules/**', '**/.git/**', '**/__pycache__/**',
        '**/out/**', '**/dist/**', '**/build/**', '**/.omricode/**'];

      const includePattern = '**/*.{ts,js,tsx,jsx,py,gd,cs,rs,go,swift,kt,java,php,rb,c,cpp,h,hpp,glsl,fs,vs}';
      const files = await vscode.workspace.findFiles(includePattern, `{${excludePatterns.join(',')}}`);

      const batch: VectorEntry[] = [];
      for (let fi = 0; fi < files.length; fi++) {
        const fileUri = files[fi];
        const content = await this.readFileSafe(fileUri);
        if (!content) continue;

        const chunks = this.chunkContent(content, fileUri.fsPath, chunkSize);
        for (const chunk of chunks) {
          batch.push(chunk);
        }

        // Process in batches of 50 files
        if (fi % 50 === 0 && batch.length > 0) {
          const embeddings = await this.embedder.embedBatch(batch.map(b => b.text));
          for (let i = 0; i < batch.length; i++) {
            batch[i].embedding = embeddings[i];
          }
          await this.vectorStore.upsertBatch(batch);
          batch.length = 0;
        }
      }

      // Final batch
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

  /**
   * Search for relevant code chunks given a query.
   * Returns top K results formatted for system prompt injection.
   */
  async search(query: string, topK: number = 8): Promise<VectorSearchResult[]> {
    if (!this.initialized) await this.initialize();

    const queryEmbedding = await this.embedder.embed(query);
    return this.vectorStore.search(queryEmbedding, query, topK);
  }

  /**
   * Format search results as a string for system prompt injection.
   */
  formatResults(results: VectorSearchResult[]): string {
    if (results.length === 0) return '';

    const lines: string[] = ['## Relevant Code Context'];
    for (const r of results) {
      const filePath = r.entry.filePath;
      const relPath = filePath.replace(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', ''
      ).replace(/^[/\\]/, '') || filePath;
      lines.push('');
      lines.push(`### ${relPath}:${r.entry.startLine}-${r.entry.endLine} (score: ${r.score.toFixed(2)})`);
      const code = r.entry.text.split('\n').slice(0, 20).join('\n');
      lines.push('```');
      lines.push(code);
      lines.push('```');
    }

    return lines.join('\n');
  }

  /**
   * Chunk file content by function/class boundaries, falling back to line blocks.
   */
  private chunkContent(content: string, filePath: string, chunkSize: number): VectorEntry[] {
    const entries: VectorEntry[] = [];
    const ext = path.extname(filePath).toLowerCase();
    const lines = content.split('\n');

    // Try function/class-based chunking first
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

    // Fill gaps with line-block chunks
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
      // Don't overlap with covered lines
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

  /**
   * Get function/class regex by file extension.
   */
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

  /**
   * Read file content safely.
   */
  private async readFileSafe(fileUri: vscode.Uri): Promise<string | null> {
    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      return doc.getText();
    } catch {
      try {
        return fs.readFileSync(fileUri.fsPath, 'utf-8');
      } catch {
        return null;
      }
    }
  }

  /**
   * Handle file changes — re-index modified files.
   */
  async onFileChanged(fileUri: vscode.Uri): Promise<void> {
    const ext = path.extname(fileUri.fsPath).toLowerCase();
    const supported = ['.ts', '.js', '.tsx', '.jsx', '.py', '.gd', '.cs', '.rs', '.go'];
    if (!supported.includes(ext)) return;

    this.vectorStore.removeByFile(fileUri.fsPath);
    const content = await this.readFileSafe(fileUri);
    if (!content) return;

    const ragConfig = this.configManager.getRagConfig();
    const chunks = this.chunkContent(content, fileUri.fsPath, ragConfig.chunkSize);
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
