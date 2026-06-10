/**
 * Native-STT model downloader + filesystem catalog status.
 *
 * Stores models under `userData/native-stt-models/<id>/` (flattened — the
 * archive's single top-level dir is stripped). sherpa ships `.tar.bz2`
 * (unbzip2-stream -> tar.x), VOSK ships `.zip` (yauzl). Mirrors the progress /
 * status contract of the Whisper modelManager so the UI can share shapes.
 */

import path from 'path';
import fs from 'fs';
import https from 'https';
import { pipeline } from 'stream';
import bz2 from 'unbzip2-stream';
import * as tar from 'tar';
import yauzl from 'yauzl';
import {
  NATIVE_STT_CATALOG,
  getNativeSttModel,
  nativeSttArchitecture,
  type NativeSttModelInfo,
} from './catalog';

export function getNativeSttModelsDir(): string {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'native-stt-models');
}

export function getNativeSttModelDir(id: string): string {
  return path.join(getNativeSttModelsDir(), id);
}

/** A model is present when all its required files exist and are non-empty. */
export function isNativeSttModelCached(model: NativeSttModelInfo): boolean {
  const dir = getNativeSttModelDir(model.id);
  if (!fs.existsSync(dir)) return false;

  if (model.engine === 'vosk') {
    // VOSK models are directories — presence of the conf/am subdirs is enough.
    try {
      return fs.existsSync(path.join(dir, 'am')) || fs.existsSync(path.join(dir, 'conf'));
    } catch { return false; }
  }

  // sherpa — check the declared files exist with size > 0.
  const required = resolveSherpaFiles(model, dir);
  if (!required) return false;
  return Object.values(required).every(f => {
    try { return fs.statSync(f).size > 0; } catch { return false; }
  });
}

/**
 * Resolve the absolute paths of the files a sherpa recognizer needs. Uses the
 * catalog `files` names but falls back to prefix matching (encoder / decoder /
 * joiner / model, preferring .int8.onnx) so a model still loads if upstream
 * tweaks a filename. Returns null when a required slot can't be found.
 */
export function resolveSherpaFiles(
  model: NativeSttModelInfo,
  dir: string,
): Record<string, string> | null {
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return null; }

  const pick = (declared: string | undefined, prefix: string): string | undefined => {
    if (declared && entries.includes(declared)) return declared;
    const onnx = entries.filter(e => e.startsWith(prefix) && e.endsWith('.onnx'));
    if (onnx.length === 0) return declared && fs.existsSync(path.join(dir, declared)) ? declared : undefined;
    // Prefer int8 (smaller, ~same WER), else the first match.
    return onnx.find(e => e.endsWith('.int8.onnx')) ?? onnx[0];
  };

  const tokens = model.files?.tokens && entries.includes(model.files.tokens)
    ? model.files.tokens
    : entries.find(e => e === 'tokens.txt');
  if (!tokens) return null;

  const out: Record<string, string> = { tokens: path.join(dir, tokens) };

  const kind = model.sherpaKind;
  const isTransducer = kind === 'online-transducer' || kind === 'online-nemo-transducer' || kind === 'offline-nemo-transducer';
  const isWhisper = kind === 'offline-whisper';

  if (isTransducer) {
    const enc = pick(model.files?.encoder, 'encoder');
    const dec = pick(model.files?.decoder, 'decoder');
    const join = pick(model.files?.joiner, 'joiner');
    if (!enc || !dec || !join) return null;
    out.encoder = path.join(dir, enc);
    out.decoder = path.join(dir, dec);
    out.joiner = path.join(dir, join);
  } else if (isWhisper) {
    const enc = pick(model.files?.encoder, 'encoder');
    const dec = pick(model.files?.decoder, 'decoder');
    if (!enc || !dec) return null;
    out.encoder = path.join(dir, enc);
    out.decoder = path.join(dir, dec);
  } else {
    // single-model kinds (toneCtc, zipformer2Ctc, nemoCtc, senseVoice)
    const m = pick(model.files?.model, 'model');
    if (!m) return null;
    out.model = path.join(dir, m);
  }
  return out;
}

/** Catalog with filesystem-derived status for the UI. */
export function getNativeSttCatalogWithStatus(downloading: Set<string>): NativeSttModelInfo[] {
  return NATIVE_STT_CATALOG.map(m => {
    const dir = getNativeSttModelDir(m.id);
    const cached = isNativeSttModelCached(m);
    const bytes = directorySize(dir);
    return {
      ...m,
      architecture: nativeSttArchitecture(m),
      status: downloading.has(m.id) ? 'downloading' : cached ? 'available' : 'missing',
      partial: !cached && bytes > 0,
      partialBytes: bytes,
    };
  });
}

function directorySize(root: string): number {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    try {
      for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
        const fp = path.join(cur, e.name);
        if (e.isDirectory()) stack.push(fp);
        else if (e.isFile()) total += fs.statSync(fp).size;
      }
    } catch { /* concurrent download writing */ }
  }
  return total;
}

export function deleteNativeSttModel(id: string): void {
  const dir = getNativeSttModelDir(id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`[native-stt] deleted model: ${id}`);
  }
}

export interface NativeDownloadHandle {
  cancel: () => void;
}

type ProgressCb = (p: { loadedBytes: number; totalBytes: number; progress: number }) => void;

/**
 * Download + extract a native-STT model. Returns a handle whose cancel() aborts
 * the in-flight request and removes the partial dir. Resolves when extraction
 * finishes; rejects on error/cancel.
 */
export function downloadNativeSttModel(
  id: string,
  onProgress: ProgressCb,
): { promise: Promise<void>; handle: NativeDownloadHandle } {
  const model = getNativeSttModel(id);
  let cancelled = false;
  let req: ReturnType<typeof https.get> | null = null;

  const handle: NativeDownloadHandle = {
    cancel: () => {
      cancelled = true;
      try { req?.destroy(new Error('cancelled')); } catch { /* noop */ }
    },
  };

  const promise = (async () => {
    if (!model) throw new Error(`unknown model: ${id}`);
    const modelsDir = getNativeSttModelsDir();
    fs.mkdirSync(modelsDir, { recursive: true });
    const finalDir = getNativeSttModelDir(id);
    // Fresh start: a half-extracted dir from a prior failed run must not shadow
    // the completeness check.
    fs.rmSync(finalDir, { recursive: true, force: true });

    const tmpArchive = path.join(modelsDir, `${id}.${model.archive}.part`);
    await downloadToFile(model.url, tmpArchive, onProgress, () => cancelled, (r) => { req = r; });
    if (cancelled) { cleanup(tmpArchive, finalDir); throw new Error('cancelled'); }

    fs.mkdirSync(finalDir, { recursive: true });
    if (model.archive === 'tar.bz2') {
      await extractTarBz2(tmpArchive, finalDir);
    } else {
      await extractZip(tmpArchive, finalDir);
    }
    try { fs.rmSync(tmpArchive, { force: true }); } catch { /* noop */ }

    if (cancelled) { cleanup(tmpArchive, finalDir); throw new Error('cancelled'); }
    if (!isNativeSttModelCached(model)) {
      throw new Error('Downloaded model is incomplete. Try again or Repair.');
    }
  })();

  return { promise, handle };
}

function cleanup(archive: string, dir: string): void {
  try { fs.rmSync(archive, { force: true }); } catch { /* noop */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
}

function downloadToFile(
  url: string,
  dest: string,
  onProgress: ProgressCb,
  isCancelled: () => boolean,
  setReq: (r: ReturnType<typeof https.get>) => void,
  redirectsLeft = 5,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': 'Natively' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        file.close();
        if (redirectsLeft <= 0) { reject(new Error('too many redirects')); return; }
        downloadToFile(res.headers.location, dest, onProgress, isCancelled, setReq, redirectsLeft - 1)
          .then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume(); file.close();
        reject(new Error(`HTTP ${res.statusCode} fetching model`));
        return;
      }
      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let loaded = 0;
      let lastEmit = 0;
      res.on('data', (chunk) => {
        loaded += chunk.length;
        const now = Date.now();
        if (now - lastEmit > 200) {
          lastEmit = now;
          onProgress({ loadedBytes: loaded, totalBytes, progress: totalBytes ? (loaded / totalBytes) * 100 : 0 });
        }
      });
      pipeline(res, file, (err) => {
        if (err) { reject(err); return; }
        onProgress({ loadedBytes: loaded, totalBytes, progress: 100 });
        resolve();
      });
    });
    setReq(req);
    req.on('error', (err) => { file.close(); reject(err); });
  });
}

function extractTarBz2(archive: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pipeline(
      fs.createReadStream(archive),
      bz2(),
      tar.x({ cwd: dest, strip: 1 }),
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

/** Extract a zip, stripping the single top-level dir (VOSK models nest one). */
function extractZip(archive: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) { reject(err ?? new Error('zip open failed')); return; }
      zip.readEntry();
      zip.on('entry', (entry: any) => {
        const stripped = entry.fileName.replace(/^[^/]+\//, '');
        if (!stripped) { zip.readEntry(); return; }
        const outPath = path.join(dest, stripped);
        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(outPath, { recursive: true });
          zip.readEntry();
          return;
        }
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        zip.openReadStream(entry, (e: any, rs: any) => {
          if (e || !rs) { reject(e ?? new Error('zip read failed')); return; }
          pipeline(rs, fs.createWriteStream(outPath), (pe) => {
            if (pe) { reject(pe); return; }
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve());
      zip.on('error', reject);
    });
  });
}
