#!/usr/bin/env node
/**
 * Build the Windows NSIS installer + portable for the open-source Natively fork.
 *
 * Works around a long-standing electron-builder problem on Windows: the
 * winCodeSign-2.6.0 archive (fetched by app-builder for rcedit/signtool) ships
 * two macOS .dylib SYMLINKS that 7za cannot recreate on Windows unless the build
 * runs as admin or with Developer Mode enabled. The symlink failure makes 7za
 * exit non-zero and aborts the whole build — even though every Windows tool in
 * that archive extracts fine and the macOS symlinks are never used here.
 *
 * The fix: temporarily swap `node_modules/7zip-bin/win/x64/7za.exe` for a tiny
 * wrapper (build-tools/7za-wrapper.exe) that runs the real 7za and swallows ONLY
 * that specific winCodeSign symlink failure (exit 0); every other invocation
 * propagates the real exit code. The real 7za is always restored afterwards.
 *
 * Prereqs: `npm run build && npm run build:electron && npm run build:native`
 * (the npm "app:build:win" script runs those first). Code-signing is disabled
 * (CSC_IDENTITY_AUTO_DISCOVERY=false) — this is an unsigned open-source build.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const szDir = path.join(root, 'node_modules', '7zip-bin', 'win', 'x64');
const live = path.join(szDir, '7za.exe');
const real = path.join(szDir, '7za-real.exe');
const wrapper = path.join(root, 'build-tools', '7za-wrapper.exe');

function installWrapper() {
  if (!fs.existsSync(wrapper)) {
    throw new Error(
      'Missing build-tools/7za-wrapper.exe. Build it once with:\n' +
      '  rustc -O build-tools/sevenzip-wrapper.rs -o build-tools/7za-wrapper.exe',
    );
  }
  if (!fs.existsSync(live)) throw new Error(`7za not found at ${live} — run "npm install" first.`);
  if (!fs.existsSync(real)) fs.copyFileSync(live, real);
  fs.copyFileSync(wrapper, live);
  console.log('[build-win] installed 7za symlink-tolerant wrapper');
}

function restore() {
  try {
    if (fs.existsSync(real)) {
      fs.copyFileSync(real, live);
      fs.rmSync(real);
      console.log('[build-win] restored real 7za');
    }
  } catch (e) {
    console.warn('[build-win] WARNING: could not restore real 7za:', e.message);
  }
}

if (process.platform !== 'win32') {
  console.error('[build-win] This script targets Windows. On macOS use `npm run dist`.');
  process.exit(1);
}

installWrapper();
process.on('exit', restore);
process.on('SIGINT', () => { restore(); process.exit(1); });

try {
  execSync('npx electron-builder --win --x64', {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production', CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  });
  console.log('[build-win] done — installer + portable are in ./release');
} finally {
  restore();
}
