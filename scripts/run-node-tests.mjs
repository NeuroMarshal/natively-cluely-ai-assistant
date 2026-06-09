import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const roots = [
  'electron/services/__tests__',
  'electron/llm/__tests__',
  'electron/llm/codeVerification/__tests__',
  'electron/audio/__tests__',
  'electron/rag/__tests__',
  'electron/update',
];

function collectTests(root) {
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTests(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      files.push(fullPath);
    }
  }

  return files;
}

const files = roots.flatMap(collectTests).sort();

if (files.length === 0) {
  console.error('[run-node-tests] No test files found.');
  process.exit(1);
}

console.log(`[run-node-tests] Running ${files.length} Node test files`);

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
