import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineNoirPlugins, type PluginSelection } from '@noir-player/plugin-api';
import {
  applyPluginCatalogToSelections,
  discoverGitHubPluginRepository,
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
      if (input.endsWith('/noir.plugins.json')) {
        return { ok: false, status: 404, json: async () => ({}) };
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

  it('discovers every plugin in a repository catalog before installation', async () => {
    installMemoryStorage();
    const fetchMock = vi.fn(async (input: string) => {
      if (input.startsWith('https://api.github.com/')) {
        return { ok: true, status: 200, json: async () => ({ default_branch: 'main' }) };
      }
      if (input.endsWith('/noir.plugins.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            schemaVersion: 1,
            name: 'Example collection',
            description: 'Two independently selectable plugins.',
            plugins: [
              { descriptor: 'plugins/one/noir.plugin.json' },
              { descriptor: 'plugins/two/noir.plugin.json' },
            ],
          }),
        };
      }
      if (input.endsWith('/plugins/one/noir.plugin.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            manifest: {
              id: 'example.one',
              name: 'Plugin one',
              version: '1.0.0',
              apiVersion: '^1.0.0',
              description: 'First test plugin',
              license: 'MIT',
              requestedCapabilities: [],
            },
            entry: 'dist/index.js',
          }),
        };
      }
      if (input.endsWith('/plugins/two/noir.plugin.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            manifest: {
              id: 'example.two',
              name: 'Plugin two',
              version: '1.0.0',
              apiVersion: '^1.0.0',
              description: 'Second test plugin',
              license: 'MIT',
              requestedCapabilities: [],
            },
            entry: 'dist/index.js',
          }),
        };
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const repository = await discoverGitHubPluginRepository('https://github.com/example/collection');

    expect(repository).toMatchObject({
      name: 'Example collection',
      description: 'Two independently selectable plugins.',
    });
    expect(repository.plugins.map((plugin) => plugin.id)).toEqual(['example.one', 'example.two']);
    expect(readPluginCatalog().github).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
