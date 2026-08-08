/* global console */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const assetsDirectory = path.resolve('dist/assets');
const warningLimitBytes = 500 * 1024;
const assetNames = await readdir(assetsDirectory);
const javascriptAssets = assetNames.filter((name) => name.endsWith('.js'));
const oversizedAssets = [];

for (const assetName of javascriptAssets) {
  const assetPath = path.join(assetsDirectory, assetName);
  const { size } = await stat(assetPath);
  if (size > warningLimitBytes) {
    oversizedAssets.push({ assetName, size });
  }
}

if (oversizedAssets.length > 0) {
  const details = oversizedAssets
    .map(({ assetName, size }) => `${assetName}: ${size} bytes`)
    .join(', ');
  throw new Error(`JavaScript bundle budget exceeded (${warningLimitBytes} bytes): ${details}`);
}

console.log(`Bundle budget passed: ${javascriptAssets.length} JavaScript chunks under 500 kB.`);
