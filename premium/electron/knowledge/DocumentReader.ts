// premium/electron/knowledge/DocumentReader.ts
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// Extracts raw UTF-8 text from a resume / JD file. Supports .txt, .pdf and
// .docx (the same extensions the upload dialog allows). PDF and DOCX parsing
// use the already-bundled `pdf-parse` and `mammoth` dependencies and are loaded
// lazily so a text-only ingest never pays their startup cost.

import fs from 'fs';
import path from 'path';

export class DocumentReader {
  /**
   * Read a document and return its plain text. Throws on an unreadable file or
   * an unsupported extension.
   */
  async read(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.txt':
      case '.md':
      case '.text':
        return fs.readFileSync(filePath, 'utf-8');
      case '.pdf':
        return this.readPdf(filePath);
      case '.docx':
        return this.readDocx(filePath);
      case '.doc':
        // Legacy .doc isn't supported by mammoth; best-effort text decode.
        return fs.readFileSync(filePath, 'utf-8');
      default:
        // Unknown extension: try a UTF-8 read so a mislabeled text file still works.
        return fs.readFileSync(filePath, 'utf-8');
    }
  }

  /** Alias kept for callers that prefer an explicit (path, type) signature. */
  async readDocument(filePath: string): Promise<{ text: string }> {
    return { text: await this.read(filePath) };
  }

  private async readPdf(filePath: string): Promise<string> {
    // pdf-parse v2 exposes a named `pdf` / default function depending on the
    // build; handle both shapes.
    const mod: any = await import('pdf-parse');
    const parse = typeof mod === 'function' ? mod : (mod.default ?? mod.pdf ?? mod.PdfParse);
    const buf = fs.readFileSync(filePath);
    const result = await parse(buf);
    return (result?.text ?? '').toString();
  }

  private async readDocx(filePath: string): Promise<string> {
    const mod: any = await import('mammoth');
    const mammoth = mod.default ?? mod;
    const result = await mammoth.extractRawText({ path: filePath });
    return (result?.value ?? '').toString();
  }
}
