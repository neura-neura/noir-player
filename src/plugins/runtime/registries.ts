import type {
  Disposable,
  PluginDiagnostic,
  PluginI18n,
  PluginLogger,
  PluginLogFields,
  PluginServiceRegistry,
  PluginServiceToken,
  PluginSlotName,
  PluginStorage,
  PluginTelemetry,
  PluginTelemetryEvent,
  PlayerSnapshot,
  PluginUiRegistry,
  UiContribution,
} from '@noir-player/plugin-api';
import { createServiceToken } from '@noir-player/plugin-api';
import { versionSatisfies } from './semver';

export interface UiRegistrySnapshot {
  readonly revision: number;
  readonly contributions: ReadonlyMap<PluginSlotName, readonly UiContribution[]>;
}

type UiEntry = UiContribution & { readonly pluginId: string };

export class UiRegistry implements PluginUiRegistry {
  private readonly entries = new Map<PluginSlotName, UiEntry[]>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  contribute<TProps>(contribution: UiContribution<TProps>, pluginId?: string): Disposable {
    const owner = pluginId ?? contribution.id.split('/')[0];
    const current = this.entries.get(contribution.slot) ?? [];
    if (current.some((entry) => entry.id === contribution.id)) {
      throw new Error(`UI contribution ${contribution.id} is already registered.`);
    }
    const entry = { ...contribution, pluginId: owner } as UiEntry;
    current.push(entry);
    this.entries.set(contribution.slot, current);
    this.notify();
    return () => {
      const values = this.entries.get(contribution.slot);
      if (!values) return;
      const index = values.indexOf(entry);
      if (index >= 0) values.splice(index, 1);
      if (values.length === 0) this.entries.delete(contribution.slot);
      this.notify();
    };
  }

  getContributions(slot: PluginSlotName, snapshot?: Readonly<PlayerSnapshot>): readonly UiContribution[] {
    return [...(this.entries.get(slot) ?? [])]
      .filter((entry) => !snapshot || !entry.when || entry.when(snapshot))
      .sort((left, right) =>
        (left.order ?? 0) - (right.order ?? 0)
        || left.pluginId.localeCompare(right.pluginId)
        || left.id.localeCompare(right.id),
      );
  }

  subscribe(listener: () => void): Disposable {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): UiRegistrySnapshot {
    const contributions = new Map<PluginSlotName, readonly UiContribution[]>();
    for (const slot of this.entries.keys()) contributions.set(slot, this.getContributions(slot));
    return Object.freeze({ revision: this.revision, contributions });
  }

  getRevision(): number {
    return this.revision;
  }

  count(slot?: PluginSlotName): number {
    if (slot) return this.entries.get(slot)?.length ?? 0;
    return [...this.entries.values()].reduce((total, values) => total + values.length, 0);
  }

  clear(): void {
    this.entries.clear();
    this.notify();
  }

  private notify(): void {
    this.revision += 1;
    for (const listener of [...this.listeners]) listener();
  }
}

type ServiceEntry = { owner: string; token: PluginServiceToken<unknown>; value: unknown };

export class ServiceRegistry implements PluginServiceRegistry {
  private readonly entries = new Map<string, ServiceEntry>();

  provide<T>(token: PluginServiceToken<T>, value: T, owner = token.id.split('/')[0]): Disposable {
    const key = `${token.id}@${token.version}`;
    if (this.entries.has(key)) throw new Error(`Service ${key} is already provided.`);
    const entry = { owner, token, value };
    this.entries.set(key, entry);
    return () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    };
  }

  get<T>(token: PluginServiceToken<T>, range?: string): T {
    const value = this.optional(token, range);
    if (value === undefined) throw new Error(`Service ${token.id}@${token.version} is unavailable.`);
    return value;
  }

  optional<T>(token: PluginServiceToken<T>, range?: string): T | undefined {
    const exact = this.entries.get(`${token.id}@${token.version}`);
    if (exact) return exact.value as T;
    if (!range) return undefined;
    for (const entry of this.entries.values()) {
      if (entry.token.id === token.id && versionSatisfies(entry.token.version, range)) return entry.value as T;
    }
    return undefined;
  }

  count(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

export class NamespacedI18n implements PluginI18n {
  private readonly messages = new Map<string, Readonly<Record<string, string>>>();
  private locale = 'en';

  constructor(private readonly pluginId: string) {}

  t(key: string, variables: Readonly<Record<string, string | number>> = {}): string {
    const value = this.messages.get(this.locale)?.[key] ?? this.messages.get('en')?.[key] ?? key;
    return Object.entries(variables).reduce(
      (text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)),
      value,
    );
  }

  register(locale: string, messages: Readonly<Record<string, string>>): Disposable {
    if (!locale || !Object.keys(messages).every((key) => key.startsWith(`${this.pluginId}.`))) {
      throw new Error('Plugin translation keys must be namespaced by plugin ID.');
    }
    if (this.messages.has(locale)) throw new Error(`Translations for ${locale} are already registered.`);
    this.messages.set(locale, Object.freeze({ ...messages }));
    return () => this.messages.delete(locale);
  }

  getLocale(): string {
    return this.locale;
  }

  setLocale(locale: string): void {
    this.locale = locale;
  }
}

export interface LogSink {
  (level: 'debug' | 'info' | 'warn' | 'error', message: string, fields: PluginLogFields): void;
}

function redact(value: string): string {
  return value
    .replace(/[A-Za-z]:\\[^\s]+/g, '<path>')
    .replace(/(?:file|https?):\/\/[^\s]+/gi, '<url>')
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, '$1<redacted>');
}

function safeFields(fields: PluginLogFields = {}): PluginLogFields {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (/path|file|url|token|secret|password|subtitle|cue|text|args|value/i.test(key)) {
      result[key] = typeof value === 'string' ? redact(value) : '<redacted>';
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class ScopedLogger implements PluginLogger {
  constructor(
    private readonly pluginId: string,
    private readonly version: string,
    private readonly phase: () => string,
    private readonly sink: LogSink = (level, message, fields) => {
      const method = console[level] ?? console.log;
      method(`[noir.plugin] ${message}`, fields);
    },
  ) {}

  debug(message: string, fields?: PluginLogFields): void { this.write('debug', message, fields); }
  info(message: string, fields?: PluginLogFields): void { this.write('info', message, fields); }
  warn(message: string, fields?: PluginLogFields): void { this.write('warn', message, fields); }
  error(message: string, fields?: PluginLogFields): void { this.write('error', message, fields); }

  private write(level: 'debug' | 'info' | 'warn' | 'error', message: string, fields?: PluginLogFields): void {
    this.sink(level, redact(message), {
      scope: 'noir.plugin',
      pluginId: this.pluginId,
      version: this.version,
      phase: this.phase(),
      ...safeFields(fields),
    });
  }
}

export class MemoryTelemetry implements PluginTelemetry {
  private readonly entries: Array<{ event: PluginTelemetryEvent; fields: PluginLogFields; timestamp: number }> = [];

  record(event: PluginTelemetryEvent, fields: PluginLogFields): void {
    this.entries.push({ event, fields: safeFields(fields), timestamp: Date.now() });
    if (this.entries.length > 200) this.entries.shift();
  }

  getSnapshot(): readonly { event: PluginTelemetryEvent; fields: PluginLogFields; timestamp: number }[] {
    return [...this.entries];
  }

  clear(): void { this.entries.length = 0; }
}

export const CORE_PLAYBACK_ENGINE_TOKEN = createServiceToken<{ getEngineId(): string }>('noir.core/playback-engine', '1.0.0');

export interface DiagnosticSink {
  (diagnostic: PluginDiagnostic): void;
}

export class NullPluginStorage implements PluginStorage {
  readonly schemaVersion = 1;
  get<T>(): T | undefined { return undefined; }
  set(): void { /* intentionally empty storage for a restricted host */ }
  remove(): void { /* intentionally empty storage for a restricted host */ }
  clear(): void { /* intentionally empty storage for a restricted host */ }
}
