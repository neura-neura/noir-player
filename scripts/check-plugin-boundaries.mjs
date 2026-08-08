/* global console, process */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoots = ['packages/plugin-playback-stats', 'packages/plugin-mpv-lab'];
const forbidden = [
  /from\s+['"].*\/src(?:\/|['"])/,
  /from\s+['"].*tauri-plugin-libmpv-api['"]/,
  /from\s+['"].*@tauri-apps\//,
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
];

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(fullPath));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const violations = [];
for (const relativeRoot of pluginRoots) {
  for (const file of await collect(path.join(root, relativeRoot))) {
    const contents = await readFile(file, 'utf8');
    for (const expression of forbidden) {
      if (expression.test(contents)) violations.push(`${path.relative(root, file)} matches ${expression}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Plugin architecture boundary violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log('Plugin architecture boundaries passed.');
}
