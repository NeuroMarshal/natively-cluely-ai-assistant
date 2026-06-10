#!/usr/bin/env node
/**
 * Provisions the native libvosk library for vosk-koffi.
 *
 * vosk-koffi loads `libvosk.{dll,dylib,so}` from
 * `node_modules/vosk-koffi/bin-<platform>-<arch>/` but does NOT ship or download
 * it. The library lives in the alphacep/vosk-api releases. This script fetches
 * the right archive for the current platform/arch and extracts the libs into the
 * directory vosk-koffi expects, so `npm install` leaves a working VOSK engine.
 *
 * Idempotent: skips when the lib is already present. Best-effort: a download
 * failure logs a warning and exits 0 (VOSK simply won't load until libs exist;
 * the provider surfaces a clear VOSK_ADDON_MISSING error at runtime).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const VOSK_VERSION = '0.3.45';
const REL = `https://github.com/alphacep/vosk-api/releases/download/v${VOSK_VERSION}`;

// platform/arch -> { asset, libName }
const ASSETS = {
  'win32-x64':   { asset: `vosk-win64-${VOSK_VERSION}.zip`,         lib: 'libvosk.dll' },
  'darwin-x64':  { asset: `vosk-osx-${VOSK_VERSION}.zip`,           lib: 'libvosk.dylib' },
  'darwin-arm64':{ asset: `vosk-osx-${VOSK_VERSION}.zip`,           lib: 'libvosk.dylib' },
  'linux-x64':   { asset: `vosk-linux-x86_64-${VOSK_VERSION}.zip`,  lib: 'libvosk.so' },
  'linux-arm64': { asset: `vosk-linux-aarch64-${VOSK_VERSION}.zip`, lib: 'libvosk.so' },
};

function main() {
  const key = `${process.platform}-${process.arch}`;
  const spec = ASSETS[key];
  if (!spec) { console.log(`[ensure-vosk-native] no libvosk asset for ${key}, skipping`); return; }

  let pkgDir;
  try {
    // Resolve via the module entry, then walk up to the package root (the dir
    // containing package.json). require.resolve('vosk-koffi/package.json') can
    // fail under "exports" maps, so resolve the main entry instead.
    let p = path.dirname(require.resolve('vosk-koffi'));
    while (p && !fs.existsSync(path.join(p, 'package.json')) && path.dirname(p) !== p) {
      p = path.dirname(p);
    }
    pkgDir = p;
  } catch { console.log('[ensure-vosk-native] vosk-koffi not installed, skipping'); return; }

  const binDir = path.join(pkgDir, `bin-${process.platform}-${process.arch}`);
  const libPath = path.join(binDir, spec.lib);
  if (fs.existsSync(libPath) && fs.statSync(libPath).size > 0) {
    console.log(`[ensure-vosk-native] ${spec.lib} already present`);
    return;
  }

  fs.mkdirSync(binDir, { recursive: true });
  const tmpZip = path.join(binDir, spec.asset);
  console.log(`[ensure-vosk-native] downloading ${spec.asset} ...`);
  download(`${REL}/${spec.asset}`, tmpZip)
    .then(() => {
      // Extract all .dll/.dylib/.so from the zip's single top dir into binDir.
      extractLibs(tmpZip, binDir);
      try { fs.rmSync(tmpZip, { force: true }); } catch { /* noop */ }
      if (fs.existsSync(libPath)) console.log(`[ensure-vosk-native] installed ${spec.lib}`);
      else console.warn(`[ensure-vosk-native] WARN: ${spec.lib} not found after extract`);
    })
    .catch((e) => {
      console.warn(`[ensure-vosk-native] WARN: could not provision libvosk: ${e.message}`);
    });
}

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'Natively' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); file.close();
        if (redirects <= 0) return reject(new Error('too many redirects'));
        return download(res.headers.location, dest, redirects - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); file.close(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', (e) => { file.close(); reject(e); });
  });
}

function extractLibs(zip, destDir) {
  // Use yauzl (a vosk-koffi dependency) so we don't depend on system unzip.
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(zip, { lazyEntries: true }, (err, z) => {
      if (err || !z) return reject(err || new Error('zip open failed'));
      z.readEntry();
      z.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) { z.readEntry(); return; }
        const base = path.basename(entry.fileName);
        if (!/\.(dll|dylib|so)(\.\d+)*$/.test(base)) { z.readEntry(); return; }
        z.openReadStream(entry, (e, rs) => {
          if (e || !rs) return reject(e || new Error('read failed'));
          rs.pipe(fs.createWriteStream(path.join(destDir, base))).on('finish', () => z.readEntry());
        });
      });
      z.on('end', resolve);
      z.on('error', reject);
    });
  });
}

main();
