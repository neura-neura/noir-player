import {
  MpvOperationError,
  MpvUnavailableError,
  PluginPermissionError,
  type Disposable,
  type MpvEvent,
  type MpvPluginFacade,
  type MpvPropertyEvent,
  type MpvPropertyFormat,
  type MpvObservedProperty,
  type MpvValue,
} from '@noir-player/plugin-api';
import type { MpvBackend } from '@/player/engines/playback-engine';

const MAX_MPV_PAYLOAD_BYTES = 64 * 1024;

export interface MpvFacadeScope {
  readonly pluginId: string;
  readonly canRead: boolean;
  readonly canRaw: boolean;
  registerDisposable(disposable: Disposable): Disposable;
  audit(operation: string, name: string, durationMs: number, outcome: 'ok' | 'error'): void;
}

export function createMpvPluginFacade(backend: MpvBackend, scope: MpvFacadeScope): MpvPluginFacade {
  let active = true;
  scope.registerDisposable(() => { active = false; });
  const assertRead = () => {
    if (!scope.canRead && !scope.canRaw) {
      throw new PluginPermissionError(scope.pluginId as never, 'native.mpv.read');
    }
  };
  const assertRaw = () => {
    if (!scope.canRaw) {
      throw new PluginPermissionError(scope.pluginId as never, 'native.mpv.raw');
    }
  };
  const assertName = (name: string) => {
    if (typeof name !== 'string' || name.trim() === '' || name.length > 256) {
      throw new MpvOperationError(scope.pluginId as never, 'mpv operation names must be non-empty and at most 256 characters.');
    }
  };
  const assertPayload: (value: unknown) => asserts value is MpvValue = (value: unknown) => {
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch (error) {
      throw new MpvOperationError(scope.pluginId as never, 'mpv payload is not serializable.', error);
    }
    if (serialized === undefined || serialized.length > MAX_MPV_PAYLOAD_BYTES) {
      throw new MpvOperationError(scope.pluginId as never, 'mpv payload exceeds the 64 KiB safety limit.');
    }
  };
  const ensureAvailable = () => {
    if (!active) throw new MpvUnavailableError(scope.pluginId as never, 'The plugin mpv scope has been disposed.');
    if (!backend.available) throw new MpvUnavailableError(scope.pluginId as never);
  };
  const auditCall = async <T>(operation: string, name: string, action: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      const result = await action();
      scope.audit(operation, name, Math.round(performance.now() - started), 'ok');
      return result;
    } catch (error) {
      scope.audit(operation, name, Math.round(performance.now() - started), 'error');
      if (error instanceof MpvOperationError || error instanceof MpvUnavailableError || error instanceof PluginPermissionError) throw error;
      throw new MpvOperationError(scope.pluginId as never, `mpv ${operation} failed.`, error);
    }
  };

  return {
    isAvailable() {
      return active && (scope.canRead || scope.canRaw) && backend.available;
    },
    async getProperty<T extends MpvValue = MpvValue>(name: string, format?: MpvPropertyFormat): Promise<T> {
      assertRead();
      assertName(name);
      ensureAvailable();
      return auditCall('getProperty', name, () => backend.getProperty<T>(name, format));
    },
    observeProperties(properties: readonly MpvObservedProperty[], listener: (event: MpvPropertyEvent) => void): Disposable {
      assertRead();
      ensureAvailable();
      if (properties.length === 0 || properties.length > 64) {
        throw new MpvOperationError(scope.pluginId as never, 'mpv observers must contain between 1 and 64 properties.');
      }
      for (const property of properties) {
        assertName(property.name);
      }
      let disposed = false;
      const disposable = backend.observeProperties(properties, (event) => {
        if (!disposed) listener(Object.freeze({ name: event.name, data: event.data }));
      });
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        disposable();
      };
      scope.registerDisposable(cleanup);
      return cleanup;
    },
    listenEvents(events: readonly string[], listener: (event: MpvEvent) => void): Disposable {
      assertRead();
      ensureAvailable();
      if (events.length === 0 || events.length > 64) {
        throw new MpvOperationError(scope.pluginId as never, 'mpv event observers must contain between 1 and 64 events.');
      }
      events.forEach(assertName);
      const wanted = new Set(events);
      let disposed = false;
      const disposable = backend.listenEvents(events, (event) => {
        if (!disposed && wanted.has(event.name)) listener(Object.freeze({ name: event.name, data: event.data }));
      });
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        disposable();
      };
      scope.registerDisposable(cleanup);
      return cleanup;
    },
    async command<T extends MpvValue = MpvValue>(name: string, args: readonly MpvValue[] = []): Promise<T> {
      assertRaw();
      assertName(name);
      assertPayload(args);
      ensureAvailable();
      return auditCall('command', name, () => backend.command<T>(name, args));
    },
    async setProperty(name: string, value: MpvValue): Promise<void> {
      assertRaw();
      assertName(name);
      assertPayload(value);
      ensureAvailable();
      return auditCall('setProperty', name, () => backend.setProperty(name, value));
    },
  };
}
