import { describe, expect, it, vi } from 'vitest';
import playbackStats from '@noir-player/plugin-playback-stats';
import { createPluginRuntime, CommandBus, TypedEventBus, HookRegistry, UiRegistry, ServiceRegistry, MemoryStorageAdapter } from '@/plugins/runtime';

function createRuntime(config: unknown = { sampleIntervalMs: 1_000, showByDefault: true }) {
  return createPluginRuntime({
    selections: [{
      id: 'noir.playback-stats',
      loader: async () => ({ default: playbackStats }),
      grants: [...playbackStats.manifest.requestedCapabilities],
      trust: 'first-party',
      config,
    }],
    commands: new CommandBus(),
    events: new TypedEventBus(10),
    hooks: new HookRegistry(),
    ui: new UiRegistry(),
    services: new ServiceRegistry(),
    storage: new MemoryStorageAdapter(),
  });
}

describe('first-party playback-stats plugin', () => {
  it('uses the public runtime end to end and cleans every contribution', async () => {
    vi.useFakeTimers();
    const runtime = createRuntime();
    await runtime.start();
    expect(runtime.getStatus('noir.playback-stats')).toMatchObject({ state: 'active' });
    expect(runtime.ui.count()).toBe(4);
    expect(runtime.commands.pluginCommandCount()).toBe(2);

    const api = runtime.getPluginApi<{ getState(): { visible: boolean; engine: string } }>('noir.playback-stats')!;
    expect(api.getState().engine).toBe('none');
    await expect(runtime.commands.executePlugin('noir.playback-stats.toggle')).resolves.toEqual({ visible: false });
    expect(api.getState().visible).toBe(false);
    await expect(runtime.updateConfig('noir.playback-stats', { sampleIntervalMs: 500, showByDefault: true })).resolves.toBeUndefined();
    await runtime.disposeAll();
    expect(runtime.ui.count()).toBe(0);
    expect(runtime.commands.pluginCommandCount()).toBe(0);
    vi.useRealTimers();
  });

  it('fails before setup when test-only failure config is injected without affecting the host', async () => {
    const runtime = createRuntime({ sampleIntervalMs: 1_000, showByDefault: true, throwOnSetup: true });
    await runtime.start();
    expect(runtime.getStatus('noir.playback-stats')).toMatchObject({ state: 'failed' });
    expect(runtime.ui.count()).toBe(0);
    await runtime.disposeAll();
  });
});
