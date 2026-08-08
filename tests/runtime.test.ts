import { describe, expect, it, vi } from 'vitest';
import {
  definePlugin,
  type MpvValue,
  type PluginSelection,
} from '@noir-player/plugin-api';
import mpvLab from '@noir-player/plugin-mpv-lab';
import { createPluginRuntime, CommandBus, TypedEventBus, HookRegistry, UiRegistry, ServiceRegistry, MemoryStorageAdapter } from '@/plugins/runtime';
import type { MpvBackend } from '@/player/engines/playback-engine';

function selection(module: Parameters<typeof definePlugin>[0], overrides: Partial<PluginSelection> = {}): PluginSelection {
  return {
    id: module.manifest.id,
    loader: async () => ({ default: module }),
    grants: [...module.manifest.requestedCapabilities],
    trust: 'first-party',
    ...overrides,
  } as PluginSelection;
}

function createHost(
  selections: readonly PluginSelection[],
  mpvBackend?: MpvBackend,
  storage = new MemoryStorageAdapter(),
) {
  return createPluginRuntime({
    selections,
    appVersion: '0.1.13',
    platform: 'browser-preview',
    commands: new CommandBus(),
    events: new TypedEventBus(10),
    hooks: new HookRegistry(),
    ui: new UiRegistry(),
    services: new ServiceRegistry(),
    storage,
    mpvBackend,
    lifecycleTimeoutMs: 100,
    importTimeoutMs: 100,
  });
}

describe('plugin runtime selection and lifecycle', () => {
  it('does not invoke disabled or absent loaders', async () => {
    const loader = vi.fn(async () => ({ default: definePlugin({
      manifest: {
        id: 'fixture.lazy', name: 'Lazy', version: '1.0.0', apiVersion: '^1.0.0', description: 'lazy', license: 'MIT', requestedCapabilities: [],
      },
      defaultConfig: {}, config: { parse: () => ({}) }, setup: () => ({}),
    }) }));
    const runtime = createHost([{
      id: 'fixture.lazy', loader, enabled: false, grants: [], trust: 'first-party',
    }]);
    await runtime.start();
    expect(loader).not.toHaveBeenCalled();
    expect(runtime.getStatus('fixture.lazy')).toMatchObject({ state: 'disabled' });
  });

  it('runs setup/start and cleans resources in reverse order', async () => {
    const calls: string[] = [];
    const module = definePlugin({
      manifest: {
        id: 'fixture.lifecycle', name: 'Lifecycle', version: '1.0.0', apiVersion: '^1.0.0', description: 'lifecycle', license: 'MIT', requestedCapabilities: ['player.read', 'storage'],
      },
      defaultConfig: { value: 1 },
      config: { parse: (value: unknown) => value as { value: number } },
      setup: (context) => {
        calls.push('setup');
        context.resources.add(() => calls.push('resource-first'));
        context.resources.add(() => calls.push('resource-second'));
        return {
          start: () => { calls.push('start'); },
          stop: () => { calls.push('stop'); },
          dispose: () => { calls.push('dispose'); },
        };
      },
    });
    const runtime = createHost([selection(module)]);
    await runtime.start();
    expect(runtime.getStatus('fixture.lifecycle')).toMatchObject({ state: 'active' });
    await runtime.disposeAll();
    expect(calls).toEqual(['setup', 'start', 'stop', 'resource-second', 'resource-first', 'dispose']);
  });

  it('isolates setup failure and records a recoverable diagnostic', async () => {
    const runtime = createHost([selection(definePlugin({
      manifest: {
        id: 'fixture.failure', name: 'Failure', version: '1.0.0', apiVersion: '^1.0.0', description: 'failure', license: 'MIT', requestedCapabilities: [],
      },
      defaultConfig: {}, config: { parse: () => ({}) }, setup: () => { throw new Error('intentional'); },
    }))]);
    await runtime.start();
    expect(runtime.getStatus('fixture.failure')).toMatchObject({ state: 'failed' });
    expect((runtime.getStatus('fixture.failure') as { diagnostics: readonly { code: string }[] }).diagnostics[0].code).toBe('PLUGIN_LIFECYCLE');
  });

  it('resolves required dependencies topologically and blocks missing ones before setup', async () => {
    const calls: string[] = [];
    const dependency = definePlugin({
      manifest: {
        id: 'fixture.dependency', name: 'Dependency', version: '1.0.0', apiVersion: '^1.0.0', description: 'dependency', license: 'MIT', requestedCapabilities: [],
      },
      defaultConfig: {}, config: { parse: () => ({}) }, setup: () => { calls.push('dependency'); return {}; },
    });
    const dependent = definePlugin({
      manifest: {
        id: 'fixture.dependent', name: 'Dependent', version: '1.0.0', apiVersion: '^1.0.0', description: 'dependent', license: 'MIT', requestedCapabilities: [], requires: { 'fixture.dependency': '^1.0.0' },
      },
      defaultConfig: {}, config: { parse: () => ({}) }, setup: () => { calls.push('dependent'); return {}; },
    });
    const runtime = createHost([selection(dependent, { priority: 0 }), selection(dependency, { priority: 10 })]);
    await runtime.start();
    expect(calls).toEqual(['dependency', 'dependent']);
    await runtime.disposeAll();

    const blocked = createHost([selection(definePlugin({
      manifest: {
        id: 'fixture.blocked', name: 'Blocked', version: '1.0.0', apiVersion: '^1.0.0', description: 'blocked', license: 'MIT', requestedCapabilities: [], requires: { 'fixture.missing': '^1.0.0' },
      },
      defaultConfig: {}, config: { parse: () => ({}) }, setup: () => { throw new Error('must not setup'); },
    }))]);
    await blocked.start();
    expect(blocked.getStatus('fixture.blocked')).toMatchObject({ state: 'blocked' });
  });

  it('migrates persisted configuration before setup and stores the new schema version', async () => {
    const storage = new MemoryStorageAdapter();
    storage.write('noir-player:plugin:fixture.migrating:config', {
      schemaVersion: 1,
      value: { count: 2 },
    });
    let receivedConfig: unknown;
    const module = definePlugin({
      manifest: {
        id: 'fixture.migrating', name: 'Migrating', version: '1.0.0', apiVersion: '^1.0.0', description: 'migration', license: 'MIT', requestedCapabilities: [],
      },
      defaultConfig: { count: 0 },
      configVersion: 2,
      configMigrations: [{
        fromVersion: 1,
        toVersion: 2,
        migrate: (value: unknown) => ({ count: Number((value as { count?: unknown }).count ?? 0) + 1 }),
      }],
      config: { parse: (value: unknown) => value as { count: number } },
      setup: (_context, config) => { receivedConfig = config; return {}; },
    });
    const runtime = createHost([selection(module)], undefined, storage);
    await runtime.start();
    expect(receivedConfig).toEqual({ count: 3 });
    expect(storage.read('noir-player:plugin:fixture.migrating:config')).toEqual({ schemaVersion: 2, value: { count: 3 } });
    await runtime.disposeAll();
  });

  it('blocks dependency cycles before any cyclic setup runs', async () => {
    const calls: string[] = [];
    const first = definePlugin({
      manifest: {
        id: 'fixture.cycle-first', name: 'Cycle first', version: '1.0.0', apiVersion: '^1.0.0', description: 'cycle', license: 'MIT', requestedCapabilities: [], requires: { 'fixture.cycle-second': '^1.0.0' },
      },
      defaultConfig: {}, config: { parse: () => ({}) }, setup: () => { calls.push('first'); return {}; },
    });
    const second = definePlugin({
      manifest: {
        id: 'fixture.cycle-second', name: 'Cycle second', version: '1.0.0', apiVersion: '^1.0.0', description: 'cycle', license: 'MIT', requestedCapabilities: [], requires: { 'fixture.cycle-first': '^1.0.0' },
      },
      defaultConfig: {}, config: { parse: () => ({}) }, setup: () => { calls.push('second'); return {}; },
    });
    const runtime = createHost([selection(first), selection(second)]);
    await runtime.start();
    expect(calls).toEqual([]);
    expect(runtime.getStatus('fixture.cycle-first')).toMatchObject({ state: 'blocked' });
    expect(runtime.getStatus('fixture.cycle-second')).toMatchObject({ state: 'blocked' });
    await runtime.disposeAll();
  });

  it('toggles an active plugin and can remove it from the host runtime', async () => {
    const calls: string[] = [];
    const module = definePlugin({
      manifest: {
        id: 'fixture.toggle', name: 'Toggle', version: '1.0.0', apiVersion: '^1.0.0', description: 'toggle', license: 'MIT', requestedCapabilities: [],
      },
      defaultConfig: {}, config: { parse: () => ({}) }, setup: () => {
        calls.push('setup');
        return {
          start: () => { calls.push('start'); },
          stop: () => { calls.push('stop'); },
          dispose: () => { calls.push('dispose'); },
        };
      },
    });
    const runtime = createHost([selection(module)]);
    await runtime.start();
    await runtime.setEnabled('fixture.toggle', false);
    expect(runtime.getStatus('fixture.toggle')).toMatchObject({ enabled: false, state: 'disabled' });
    await runtime.setEnabled('fixture.toggle', true);
    expect(runtime.getStatus('fixture.toggle')).toMatchObject({ enabled: true, state: 'active' });
    expect(calls).toEqual(['setup', 'start', 'stop', 'dispose', 'setup', 'start']);
    await runtime.remove('fixture.toggle');
    expect(runtime.getStatus('fixture.toggle')).toBeUndefined();
  });
});

function fakeMpvBackend(): MpvBackend & {
  propertyListeners: Set<(event: { name: string; data: MpvValue }) => void>;
  eventListeners: Set<(event: { name: string; data?: MpvValue }) => void>;
  reads: string[];
  commands: string[];
  writes: string[];
} {
  const propertyListeners = new Set<(event: { name: string; data: MpvValue }) => void>();
  const eventListeners = new Set<(event: { name: string; data?: MpvValue }) => void>();
  const reads: string[] = [];
  const commands: string[] = [];
  const writes: string[] = [];
  return {
    available: true,
    propertyListeners,
    eventListeners,
    reads,
    commands,
    writes,
    init: async () => undefined,
    destroy: async () => undefined,
    loadFile: async () => undefined,
    play: async () => undefined,
    pause: async () => undefined,
    seek: async () => undefined,
    setRate: async () => undefined,
    setVolume: async () => undefined,
    setMuted: async () => undefined,
    getProperty: async <T extends MpvValue>(name: string) => {
      reads.push(name);
      return 'ok' as unknown as T;
    },
    observeProperties: (_properties, listener) => {
      propertyListeners.add(listener);
      return () => propertyListeners.delete(listener);
    },
    listenEvents: (_events, listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    command: async <T extends MpvValue>(name: string) => {
      commands.push(name);
      return undefined as unknown as T;
    },
    setProperty: async (name: string) => {
      writes.push(name);
    },
  };
}

describe('mpv capability broker', () => {
  const module = mpvLab;

  it('denies read and raw operations without grants', async () => {
    const runtime = createHost([selection(module, { grants: [] })], fakeMpvBackend());
    await runtime.start();
    const api = runtime.getPluginApi<{ readProperty(): Promise<unknown> }>('fixture.mpv-lab')!;
    await expect(api.readProperty()).rejects.toMatchObject({ code: 'PLUGIN_PERMISSION_DENIED', capability: 'native.mpv.read' });
  });

  it('rejects a raw grant without the explicit risk acknowledgement', async () => {
    const runtime = createHost([selection(module, { grants: ['native.mpv.raw'] })], fakeMpvBackend());
    await runtime.start();
    expect(runtime.getStatus('fixture.mpv-lab')).toMatchObject({ state: 'failed' });
    expect((runtime.getStatus('fixture.mpv-lab') as { diagnostics: readonly { code: string }[] }).diagnostics[0].code).toBe('PLUGIN_PERMISSION_DENIED');
    await runtime.disposeAll();
  });

  it('allows arbitrary raw names only with grant and acknowledgement, then cleans observers', async () => {
    const backend = fakeMpvBackend();
    const runtime = createHost([selection(module, {
      grants: ['native.mpv.read', 'native.mpv.raw'],
      riskAcknowledgements: ['native.mpv.raw'],
      config: { property: 'audio-device-list', command: 'script-message-to' },
    })], backend);
    await runtime.start();
    const api = runtime.getPluginApi<{
      readProperty(): Promise<unknown>;
      observe(): void;
      listen(): void;
      runRawCommand(): Promise<unknown>;
      setRawProperty(value: boolean): Promise<void>;
    }>('fixture.mpv-lab')!;
    await expect(api.readProperty()).resolves.toBe('ok');
    api.observe();
    api.listen();
    await api.runRawCommand();
    await api.setRawProperty(true);
    expect(backend.reads).toContain('audio-device-list');
    expect(backend.commands).toContain('script-message-to');
    expect(backend.writes).toContain('audio-device-list');
    expect(backend.propertyListeners.size).toBe(1);
    expect(backend.eventListeners.size).toBe(1);
    await runtime.disposeAll();
    expect(backend.propertyListeners.size).toBe(0);
    expect(backend.eventListeners.size).toBe(0);
    await expect(api.readProperty()).rejects.toMatchObject({ code: 'MPV_UNAVAILABLE' });
  });

  it('allows read observers but denies raw command and property writes without raw grant', async () => {
    const runtime = createHost([selection(module, { grants: ['native.mpv.read'] })], fakeMpvBackend());
    await runtime.start();
    const api = runtime.getPluginApi<{
      runRawCommand(): Promise<unknown>;
      setRawProperty(value: boolean): Promise<void>;
      observe(): void;
    }>('fixture.mpv-lab')!;
    api.observe();
    await expect(api.runRawCommand()).rejects.toMatchObject({ code: 'PLUGIN_PERMISSION_DENIED', capability: 'native.mpv.raw' });
    await expect(api.setRawProperty(true)).rejects.toMatchObject({ code: 'PLUGIN_PERMISSION_DENIED', capability: 'native.mpv.raw' });
    await runtime.disposeAll();
  });
});
