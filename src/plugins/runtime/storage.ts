import type { PluginStorage, PluginStorageValue } from '@noir-player/plugin-api';

export interface StorageAdapter {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  remove(key: string): void;
}

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, unknown>();

  read(key: string): unknown {
    return this.values.get(key);
  }

  write(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  remove(key: string): void {
    this.values.delete(key);
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  private readonly fallback = new MemoryStorageAdapter();

  read(key: string): unknown {
    try {
      const value = globalThis.localStorage?.getItem(key);
      return value === null || value === undefined ? this.fallback.read(key) : JSON.parse(value);
    } catch {
      return this.fallback.read(key);
    }
  }

  write(key: string, value: unknown): void {
    this.fallback.write(key, value);
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(value));
    } catch {
      // Quota/private browsing failure: the in-memory copy still works for the session.
    }
  }

  remove(key: string): void {
    this.fallback.remove(key);
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Best effort.
    }
  }
}

function isStorageValue(value: unknown): value is PluginStorageValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isStorageValue);
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isStorageValue);
  }
  return false;
}

export class NamespacedPluginStorage implements PluginStorage {
  readonly schemaVersion: number;
  private readonly prefix: string;
  private readonly keys = new Set<string>();

  constructor(
    private readonly adapter: StorageAdapter,
    pluginId: string,
    schemaVersion = 1,
  ) {
    this.prefix = `noir-player:plugin:${pluginId}:`;
    this.schemaVersion = schemaVersion;
  }

  get<T extends PluginStorageValue = PluginStorageValue>(key: string): T | undefined {
    const entry = this.adapter.read(this.prefix + key);
    if (!entry || typeof entry !== 'object') {
      return undefined;
    }
    const value = (entry as { schemaVersion?: unknown; value?: unknown }).value;
    const version = (entry as { schemaVersion?: unknown }).schemaVersion;
    if (version !== this.schemaVersion || !isStorageValue(value)) {
      return undefined;
    }
    this.keys.add(key);
    return value as T;
  }

  set<T extends PluginStorageValue>(key: string, value: T): void {
    if (!isStorageValue(value)) {
      throw new TypeError(`Plugin storage value for ${key} is not serializable.`);
    }
    this.adapter.write(this.prefix + key, { schemaVersion: this.schemaVersion, value });
    this.keys.add(key);
  }

  remove(key: string): void {
    this.adapter.remove(this.prefix + key);
    this.keys.delete(key);
  }

  clear(): void {
    for (const key of [...this.keys]) this.adapter.remove(this.prefix + key);
    this.keys.clear();
  }
}
