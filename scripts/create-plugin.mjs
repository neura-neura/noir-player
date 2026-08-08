/* global console, process */

import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!input || input.startsWith('-') || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input)) {
  console.error('Usage: npm run create-plugin -- <plugin-name> [--dry-run]');
  process.exit(1);
}

const packageName = `@noir-player/plugin-${input}`;
const pluginId = `example.${input}`;
const destination = path.join(root, 'packages', `plugin-${input}`);

try {
  await access(destination);
  console.error(`Refusing to overwrite existing directory: ${destination}`);
  process.exit(1);
} catch {
  // Destination does not exist, which is the safe generation case.
}

const files = new Map([
  ['package.json', JSON.stringify({
    name: packageName,
    version: '0.1.0',
    private: true,
    type: 'module',
    sideEffects: false,
    exports: { '.': { types: './src/index.ts', import: './src/index.ts' } },
    peerDependencies: { '@noir-player/plugin-api': '1.0.0' },
  }, null, 2) + '\n'],
  ['src/index.ts', `import { definePlugin } from '@noir-player/plugin-api';

export interface Config {
  readonly label: string;
}

function parseConfig(input: unknown): Config {
  if (!input || typeof input !== 'object' || typeof (input as { label?: unknown }).label !== 'string') {
    throw new TypeError('label must be a string.');
  }
  return Object.freeze({ label: (input as { label: string }).label });
}

export default definePlugin<Config>({
  manifest: {
    id: '${pluginId}',
    name: '${input}',
    version: '0.1.0',
    apiVersion: '^1.0.0',
    description: 'A Noir Player plugin.',
    license: 'MIT',
    requestedCapabilities: ['player.read', 'ui.contribute'],
  },
  defaultConfig: { label: '${input}' },
  config: { parse: parseConfig },
  setup(context, config) {
    context.logger.info('Plugin ready', { label: config.label });
    return {
      dispose() {
        context.logger.info('Plugin disposed');
      },
    };
  },
});
`],
  ['README.md', `# ${packageName}

Install this workspace package, add a literal lazy loader to \`noir.plugins.config.ts\`,
grant only the capabilities requested by the manifest, and run the plugin contract tests.

Plugin ID: \`${pluginId}\`.
`],
  ['tests/index.test.ts', `import { describe, expect, it } from 'vitest';
import plugin from '../src/index';

describe('${packageName}', () => {
  it('has a valid public manifest', () => {
    expect(plugin.manifest.id).toBe('${pluginId}');
  });
});
`],
]);

if (dryRun) {
  console.log(`Would create ${destination}`);
  for (const file of files.keys()) console.log(`- ${path.join(destination, file)}`);
  process.exit(0);
}

for (const [relative, contents] of files) {
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}
console.log(`Created ${packageName} at ${destination}`);
