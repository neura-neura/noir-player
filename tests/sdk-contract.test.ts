import { describe, expect, it } from 'vitest';
import {
  NOIR_PLUGIN_API_VERSION,
  PluginConfigError,
  PluginPermissionError,
  defineNoirPlugins,
  definePlugin,
  createServiceToken,
} from '@noir-player/plugin-api';
import { isValidRange, isValidVersion, versionSatisfies } from '@/plugins/runtime';

describe('public plugin SDK', () => {
  it('is importable without browser or Tauri globals', () => {
    expect(NOIR_PLUGIN_API_VERSION).toBe('1.0.0');
    expect(() => definePlugin({
      manifest: {
        id: 'fixture.node' as const,
        name: 'Node fixture',
        version: '1.0.0',
        apiVersion: '^1.0.0',
        description: 'Node import fixture',
        license: 'MIT',
        requestedCapabilities: [],
      },
      defaultConfig: {},
      config: { parse: (value: unknown) => value as Record<string, never> },
      setup: async () => ({}),
    })).not.toThrow();
  });

  it('freezes explicit selection and keeps service tokens nominal', () => {
    const selection = defineNoirPlugins([]);
    expect(Object.isFrozen(selection)).toBe(true);
    const token = createServiceToken<{ value: string }>('fixture.node/service', '1.0.0');
    expect(token.id).toBe('fixture.node/service');
  });

  it('exposes stable typed error metadata', () => {
    const configError = new PluginConfigError('fixture.node', 'bad config');
    const permissionError = new PluginPermissionError('fixture.node', 'native.mpv.raw');
    expect(configError.code).toBe('PLUGIN_CONFIG_INVALID');
    expect(configError.pluginId).toBe('fixture.node');
    expect(permissionError.capability).toBe('native.mpv.raw');
    expect(permissionError.recoverable).toBe(true);
  });

  it('uses SemVer ranges rather than string comparison', () => {
    expect(isValidVersion('1.2.3')).toBe(true);
    expect(isValidRange('^1.0.0')).toBe(true);
    expect(versionSatisfies('1.2.0', '^1.0.0')).toBe(true);
    expect(versionSatisfies('2.0.0', '^1.0.0')).toBe(false);
  });
});
