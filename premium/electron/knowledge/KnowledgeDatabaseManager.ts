// premium/electron/knowledge/KnowledgeDatabaseManager.ts
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// Persistence for the knowledge engine: the retrievable `context_nodes` corpus,
// the active resume / JD documents, and cached ahead-of-time artifacts (intro,
// gap analysis, negotiation script, mock questions, culture mappings). Backed by
// the app's shared better-sqlite3 database (or an in-memory db in tests).

import type { ContextNode, KnowledgeDocument } from './types';

type SqliteDb = any; // better-sqlite3 Database (typed `any` to avoid a hard dep here)

/** Encode a float vector to a little-endian Float32 blob. */
function floatsToBlob(vec: number[]): Buffer {
  const buf = Buffer.alloc(vec.length * 4);
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i] ?? 0, i * 4);
  return buf;
}

/** Decode a Float32 LE blob back to a number[] (null when absent/empty). */
function blobToFloats(blob: Buffer | null | undefined): number[] | null {
  if (!blob || blob.length === 0) return null;
  const out = new Array(Math.floor(blob.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = blob.readFloatLE(i * 4);
  return out;
}

/** Decode the embedding column of a raw row into a number[]. */
function decodeRow<T extends { embedding?: any }>(row: T): T {
  if (row && row.embedding != null && Buffer.isBuffer(row.embedding)) {
    (row as any).embedding = blobToFloats(row.embedding);
  }
  return row;
}

export class KnowledgeDatabaseManager {
  constructor(private db: SqliteDb) {}

  /** Create the knowledge tables if they don't already exist. Idempotent. */
  initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS context_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT,
        category TEXT,
        title TEXT,
        text_content TEXT,
        tags TEXT,
        embedding BLOB,
        embedding_space TEXT
      );

      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT UNIQUE,
        source_uri TEXT,
        created_at INTEGER,
        structured_data TEXT
      );

      CREATE TABLE IF NOT EXISTS knowledge_artifacts (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_context_nodes_source ON context_nodes(source_type);
    `);
  }

  // ── Context nodes ───────────────────────────────────────────────────────────

  getAllNodes(): ContextNode[] {
    return (this.db.prepare(
      `SELECT id, source_type, category, title, text_content, tags, embedding, embedding_space
         FROM context_nodes`,
    ).all() as ContextNode[]).map(decodeRow);
  }

  /**
   * Insert a batch of nodes. Accepts embeddings as number[] (encoded to a blob)
   * or a pre-built Buffer, and tags as an array (JSON-stringified) or string.
   */
  saveNodes(nodes: Array<Partial<ContextNode> & { embedding?: number[] | Buffer | null; tags?: any }>): void {
    const stmt = this.db.prepare(
      `INSERT INTO context_nodes (source_type, category, title, text_content, tags, embedding, embedding_space)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = this.db.transaction((rows: any[]) => {
      for (const n of rows) {
        const emb = Array.isArray(n.embedding) ? floatsToBlob(n.embedding) : (n.embedding ?? null);
        const tags = Array.isArray(n.tags) ? JSON.stringify(n.tags) : (n.tags ?? '[]');
        stmt.run(
          n.source_type ?? '', n.category ?? '', n.title ?? '', n.text_content ?? '',
          tags, emb, n.embedding_space ?? null,
        );
      }
    });
    tx(nodes);
  }

  getNodeCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM context_nodes`).get() as { n: number };
    return row?.n ?? 0;
  }

  getNodesBySourceType(sourceType: string): ContextNode[] {
    return (this.db.prepare(
      `SELECT id, source_type, category, title, text_content, tags, embedding, embedding_space
         FROM context_nodes WHERE source_type = ?`,
    ).all(sourceType) as ContextNode[]).map(decodeRow);
  }

  /** Embedded nodes whose embedding_space differs from the target space. */
  getNodesNeedingReembed(targetSpace: string): ContextNode[] {
    return (this.db.prepare(
      `SELECT id, source_type, category, title, text_content, tags, embedding, embedding_space
         FROM context_nodes
        WHERE embedding IS NOT NULL
          AND (embedding_space IS NULL OR embedding_space != ?)`,
    ).all(targetSpace) as ContextNode[]).map(decodeRow);
  }

  insertNode(n: ContextNode): number {
    const emb = Array.isArray((n as any).embedding) ? floatsToBlob((n as any).embedding) : (n.embedding ?? null);
    const tags = Array.isArray((n as any).tags) ? JSON.stringify((n as any).tags) : (n.tags ?? '[]');
    const info = this.db.prepare(
      `INSERT INTO context_nodes (source_type, category, title, text_content, tags, embedding, embedding_space)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      n.source_type, n.category, n.title, n.text_content,
      tags, emb, n.embedding_space ?? null,
    );
    return Number(info.lastInsertRowid);
  }

  /** Replace all nodes for a source type with a fresh set (re-ingest). */
  replaceNodes(sourceType: string, nodes: ContextNode[]): void {
    const tx = this.db.transaction((rows: ContextNode[]) => {
      this.db.prepare(`DELETE FROM context_nodes WHERE source_type = ?`).run(sourceType);
      for (const n of rows) this.insertNode({ ...n, source_type: sourceType });
    });
    tx(nodes);
  }

  updateNodeEmbedding(id: number, embedding: number[] | Buffer, space: string): void {
    const blob = Array.isArray(embedding) ? floatsToBlob(embedding) : embedding;
    this.db.prepare(
      `UPDATE context_nodes SET embedding = ?, embedding_space = ? WHERE id = ?`,
    ).run(blob, space, id);
  }

  deleteNodesBySourceType(sourceType: string): void {
    this.db.prepare(`DELETE FROM context_nodes WHERE source_type = ?`).run(sourceType);
  }

  // ── Documents ───────────────────────────────────────────────────────────────

  upsertDocument(type: string, sourceUri: string, structuredData: any): void {
    this.db.prepare(
      `INSERT INTO knowledge_documents (type, source_uri, created_at, structured_data)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(type) DO UPDATE SET
         source_uri = excluded.source_uri,
         created_at = excluded.created_at,
         structured_data = excluded.structured_data`,
    ).run(type, sourceUri, Date.now(), JSON.stringify(structuredData ?? null));
  }

  /** Upsert a document from an object form; returns its row id. */
  saveDocument(doc: { type: string; source_uri?: string; structured_data: any }): number {
    this.upsertDocument(doc.type, doc.source_uri ?? '', doc.structured_data);
    const row = this.db.prepare(`SELECT id FROM knowledge_documents WHERE type = ?`).get(doc.type) as any;
    return row?.id ?? 0;
  }

  getDocumentByType(type: string): KnowledgeDocument | null {
    const row = this.db.prepare(
      `SELECT id, type, source_uri, created_at, structured_data
         FROM knowledge_documents WHERE type = ?`,
    ).get(type) as any;
    if (!row) return null;
    let structured: any = null;
    try { structured = row.structured_data ? JSON.parse(row.structured_data) : null; } catch { structured = null; }
    return {
      id: row.id,
      type: row.type,
      source_uri: row.source_uri,
      created_at: row.created_at,
      structured_data: structured,
    };
  }

  updateDocumentStructuredData(type: string, structuredData: any): void {
    this.db.prepare(
      `UPDATE knowledge_documents SET structured_data = ? WHERE type = ?`,
    ).run(JSON.stringify(structuredData ?? null), type);
  }

  deleteDocumentsByType(type: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM knowledge_documents WHERE type = ?`).run(type);
      this.db.prepare(`DELETE FROM context_nodes WHERE source_type = ?`).run(type);
    });
    tx();
  }

  // ── Cached AOT artifacts (key/value JSON) ───────────────────────────────────

  private getArtifact<T = any>(key: string): T | null {
    const row = this.db.prepare(`SELECT value FROM knowledge_artifacts WHERE key = ?`).get(key) as any;
    if (!row?.value) return null;
    try { return JSON.parse(row.value) as T; } catch { return null; }
  }

  private saveArtifact(key: string, value: any): void {
    this.db.prepare(
      `INSERT INTO knowledge_artifacts (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, JSON.stringify(value ?? null));
  }

  getIntro(): any { return this.getArtifact('intro'); }
  saveIntro(v: any): void { this.saveArtifact('intro', v); }

  getGapAnalysis(): any { return this.getArtifact('gap_analysis'); }
  saveGapAnalysis(v: any): void { this.saveArtifact('gap_analysis', v); }

  getNegotiationScript(): any { return this.getArtifact('negotiation_script'); }
  saveNegotiationScript(v: any): void { this.saveArtifact('negotiation_script', v); }

  getMockQuestions(): any { return this.getArtifact('mock_questions'); }
  saveMockQuestions(v: any): void { this.saveArtifact('mock_questions', v); }

  getCultureMappings(): any { return this.getArtifact('culture_mappings'); }
  saveCultureMappings(v: any): void { this.saveArtifact('culture_mappings', v); }

  clearArtifacts(): void {
    this.db.prepare(`DELETE FROM knowledge_artifacts`).run();
  }

  close(): void {
    try { this.db.close?.(); } catch { /* ignore */ }
  }
}
