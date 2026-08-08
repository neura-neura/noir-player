import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineNoirPlugins, type PluginSelection } from '@noir-player/plugin-api';
import {
  applyPluginCatalogToSelections,
  installGitHubPlugin,
  readPluginCatalog,
  setPluginEnabledOverride,
} from '@/plugins/catalog';

function installMemoryStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
}

describe('plugin catalog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists bundled enablement overrides', () => {
    installMemoryStorage();
    const selection = {
      id: 'fixture.bundled',
      loader: async () => ({ default: {} as never }),
      enabled: true,
      grants: [],
      trust: 'first-party',
    } as PluginSelection;
    setPluginEnabledOverride(selection.id, false);
    const selections = applyPluginCatalogToSelections(defineNoirPlugins([selection]));
    expect(selections[0]).toMatchObject({ id: selection.id, enabled: false });
  });

  it('reads a GitHub descriptor and keeps new plugins disabled', async () => {
    installMemoryStorage();
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.startsWith('https://api.github.com/')) {
        return { ok: true, status: 200, json: async () => ({ default_branch: 'main' }) };
      }
      if (input.endsWith('/noir.plugin.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            manifest: {
              id: 'example.remote',
              name: 'Remote example',
              version: '1.0.0',
              apiVersion: '^1.0.0',
              description: 'Remote test plugin',
              license: 'MIT',
              requestedCapabilities: [],
            },
            entry: 'dist/index.js',
          }),
        };
      }
      return { ok: true, status: 200, text: async () => 'export default {}' };
    }));

    const installed = await installGitHubPlugin('https://github.com/example/plugin');
    expect(installed).toMatchObject({ id: 'example.remote', enabled: false });
    expect(readPluginCatalog().github).toHaveLength(1);
    expect(applyPluginCatalogToSelections([])).toHaveLength(1);
  });
});
