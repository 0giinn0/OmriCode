import * as fs from 'fs';
import * as path from 'path';

export interface VectorEntry {
  id: string;
  text: string;
  filePath: string;
  startLine: number;
  endLine: number;
  embedding?: Float32Array;
  metadata: Record<string, string>;
  timestamp: string;
}

export interface VectorSearchResult {
  entry: VectorEntry;
  score: number;
}

export class VectorStore {
  private db: any = null;
  private dbPath: string;
  private entries: VectorEntry[] = [];

  constructor(workspacePath: string) {
    this.dbPath = path.join(workspacePath, '.omricode', 'vectors.db');
  }

  async initialize(): Promise<void> {
    try {
      const omriDir = path.dirname(this.dbPath);
      if (!fs.existsSync(omriDir)) {
        fs.mkdirSync(omriDir, { recursive: true });
      }

      const Database = require('better-sqlite3');
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS vectors (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          file_path TEXT NOT NULL,
          start_line INTEGER DEFAULT 0,
          end_line INTEGER DEFAULT 0,
          metadata TEXT DEFAULT '{}',
          timestamp TEXT DEFAULT (datetime('now'))
        )
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS embeddings (
          id TEXT PRIMARY KEY,
          vector BLOB,
          FOREIGN KEY (id) REFERENCES vectors(id)
        )
      `);

      try {
        this.db.loadExtension('vec0');
      } catch {
        // sqlite-vec not available — search uses in-memory cosine similarity
      }

      const rows = this.db.prepare('SELECT * FROM vectors').all() as any[];
      for (const row of rows) {
        const embRow = this.db.prepare('SELECT vector FROM embeddings WHERE id = ?').get(row.id) as any;
        this.entries.push({
          id: row.id,
          text: row.text,
          filePath: row.file_path,
          startLine: row.start_line,
          endLine: row.end_line,
          metadata: JSON.parse(row.metadata || '{}'),
          timestamp: row.timestamp,
          embedding: embRow ? new Float32Array(embRow.vector) : undefined
        });
      }
    } catch {
      this.db = null;
    }
  }

  async upsert(entry: VectorEntry): Promise<void> {
    const existing = this.entries.findIndex(e => e.id === entry.id);
    if (existing >= 0) {
      this.entries[existing] = entry;
    } else {
      this.entries.push(entry);
    }

    if (this.db) {
      this.db.prepare(`
        INSERT OR REPLACE INTO vectors (id, text, file_path, start_line, end_line, metadata, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(entry.id, entry.text, entry.filePath, entry.startLine, entry.endLine,
        JSON.stringify(entry.metadata), entry.timestamp);

      if (entry.embedding) {
        this.db.prepare(`
          INSERT OR REPLACE INTO embeddings (id, vector)
          VALUES (?, ?)
        `).run(entry.id, Buffer.from(entry.embedding.buffer));
      }
    }
  }

  async upsertBatch(entries: VectorEntry[]): Promise<void> {
    const insert = this.db?.prepare(`
      INSERT OR REPLACE INTO vectors (id, text, file_path, start_line, end_line, metadata, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEmb = this.db?.prepare(`
      INSERT OR REPLACE INTO embeddings (id, vector) VALUES (?, ?)
    `);

    const tx = this.db?.transaction(() => {
      for (const entry of entries) {
        const existing = this.entries.findIndex(e => e.id === entry.id);
        if (existing >= 0) {
          this.entries[existing] = entry;
        } else {
          this.entries.push(entry);
        }
        insert?.run(entry.id, entry.text, entry.filePath, entry.startLine, entry.endLine,
          JSON.stringify(entry.metadata), entry.timestamp);
        if (entry.embedding && insertEmb) {
          insertEmb?.run(entry.id, Buffer.from(entry.embedding.buffer));
        }
      }
    });
    tx?.();
  }

  removeByFile(filePath: string): void {
    const ids = this.entries.filter(e => e.filePath === filePath).map(e => e.id);
    this.entries = this.entries.filter(e => e.filePath !== filePath);

    if (this.db) {
      const del = this.db.prepare('DELETE FROM vectors WHERE file_path = ?');
      const delEmb = this.db.prepare('DELETE FROM embeddings WHERE id = ?');
      const tx = this.db.transaction(() => {
        del.run(filePath);
        for (const id of ids) delEmb.run(id);
      });
      tx();
    }
  }

  search(queryVector: Float32Array | null, queryText: string, topK: number = 10): VectorSearchResult[] {
    if (queryVector && this.entries.some(e => e.embedding)) {
      return this.searchByVector(queryVector, topK);
    }
    return this.searchByKeyword(queryText, topK);
  }

  private searchByVector(query: Float32Array, topK: number): VectorSearchResult[] {
    const scored: VectorSearchResult[] = [];
    for (const entry of this.entries) {
      if (!entry.embedding) continue;
      const score = this.cosineSimilarity(query, entry.embedding);
      if (score > 0.3) {
        scored.push({ entry, score });
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private searchByKeyword(query: string, topK: number): VectorSearchResult[] {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const scored: VectorSearchResult[] = [];
    for (const entry of this.entries) {
      let score = 0;
      const lower = entry.text.toLowerCase();
      for (const term of terms) {
        if (lower.includes(term)) score += 2;
      }
      if (entry.filePath.toLowerCase().includes(query.toLowerCase())) score += 3;
      if (score > 0) scored.push({ entry, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
    if (this.db) {
      this.db.exec('DELETE FROM vectors; DELETE FROM embeddings');
    }
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  dispose(): void {
    this.close();
    this.entries = [];
  }
}

export class EmbeddingProvider {
  private model: any = null;
  private modelLoaded: boolean = false;
  private dimension: number = 384;

  constructor(dimension: number = 384) {
    this.dimension = dimension;
  }

  async loadModel(): Promise<void> {
    try {
      const ort = require('onnxruntime-node');
      const modelPath = path.join(__dirname, '..', 'models', 'all-MiniLM-L6-v2.onnx');
      if (fs.existsSync(modelPath)) {
        this.model = await ort.InferenceSession.create(modelPath);
        this.modelLoaded = true;
        return;
      }
    } catch {
      // ONNX not available — fall back to hash embeddings
    }
    this.modelLoaded = false;
  }

  async embed(text: string): Promise<Float32Array> {
    if (this.modelLoaded && this.model) {
      return this.embedWithModel(text);
    }
    return this.embedWithHash(text);
  }

  private async embedWithModel(text: string): Promise<Float32Array> {
    try {
      const inputs = { input_ids: new Float32Array([1, 512]), attention_mask: new Float32Array([1, 512]) };
      const results = await this.model.run(inputs);
      const embedding = results.last_hidden_state || results.pooler_output;
      return new Float32Array(embedding.data as number[]);
    } catch {
      return this.embedWithHash(text);
    }
  }

  private embedWithHash(text: string): Float32Array {
    const vec = new Float32Array(this.dimension);
    const words = text.toLowerCase().split(/\s+/);
    for (let wi = 0; wi < words.length; wi++) {
      let hash = 0;
      for (let i = 0; i < words[wi].length; i++) {
        hash = ((hash << 5) - hash) + words[wi].charCodeAt(i);
        hash |= 0;
      }
      const idx = Math.abs(hash) % this.dimension;
      vec[idx] += 1.0 / words.length;
    }
    let mag = 0;
    for (let i = 0; i < vec.length; i++) mag += vec[i] * vec[i];
    mag = Math.sqrt(mag);
    if (mag > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= mag;
    }
    return vec;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  get isLoaded(): boolean {
    return this.modelLoaded;
  }

  get dimensions(): number {
    return this.dimension;
  }
}
