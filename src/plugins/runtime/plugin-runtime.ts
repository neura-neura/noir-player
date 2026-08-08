import {
  MpvOperationError,
  MpvUnavailableError,
  PluginCompatibilityError,
  PluginConfigError,
  PluginDependencyError,
  PluginLifecycleError,
  PluginManifestError,
  NoirPluginError,
  PluginPermissionError,
  type Disposable,
  type NoirPlatform,
  type NoirPluginContext,
  type NoirPluginManifest,
  type NoirPluginModule,
  type PluginCapability,
  type PluginDiagnostic,
  type PluginI18n,
  type PluginLogger,
  type PluginResourceScope,
  type PluginRuntimeState,
  type PluginRuntimeStatus,
  type PluginSelection,
  type PluginServiceRegistry,
  type PluginStorage,
  type PluginTelemetry,
  type PluginUiRegistry,
  type PlayerFacade,
} from '@noir-player/plugin-api';
import { NOIR_PLUGIN_API_VERSION } from '@noir-player/plugin-api';
import { PlayerStore } from '@/player/core/player-store';
import { CommandBus } from './command-bus';
import { TypedEventBus, type HostEventBus } from './event-bus';
import { HookRegistry } from './hook-registry';
import { MemoryTelemetry, NamespacedI18n, ScopedLogger, ServiceRegistry, UiRegistry, type DiagnosticSink, type LogSink } from './registries';
import { LocalStorageAdapter, MemoryStorageAdapter, NamespacedPluginStorage, type StorageAdapter } from './storage';
import { ResourceScope } from './resources';
import { createMpvPluginFacade } from './mpv-facade';
import type { MpvBackend, PlaybackEngine } from '@/player/engines/playback-engine';
import { versionSatisfies, isValidRange, isValidVersion } from './semver';

const KNOWN_CAPABILITIES = new Set<PluginCapability>([
  'player.read',
  'player.control',
  'ui.contribute',
  'commands.contribute',
  'services.consume',
  'services.provide',
  'storage',
  'telemetry',
  'network',
  'native.media-read',
  'native.mpv.read',
  'native.mpv.raw',
  'unsafe.dom',
]);

const DEFAULT_APP_VERSION = '0.1.13';
const DEFAULT_LIFECYCLE_TIMEOUT_MS = 5_000;
const DEFAULT_IMPORT_TIMEOUT_MS = 15_000;

type PluginIdString = string;

export interface PluginRuntimeOptions {
  readonly selections: readonly PluginSelection[];
  readonly appVersion?: string;
  readonly platform?: NoirPlatform;
  readonly player?: PlayerStore;
  readonly commands?: CommandBus;
  readonly events?: TypedEventBus;
  readonly hooks?: HookRegistry;
  readonly ui?: UiRegistry;
  readonly services?: ServiceRegistry;
  readonly storage?: StorageAdapter;
  readonly mpvBackend?: MpvBackend;
  readonly mpvEngine?: PlaybackEngine;
  readonly logger?: LogSink;
  readonly onDiagnostic?: DiagnosticSink;
  readonly lifecycleTimeoutMs?: number;
  readonly importTimeoutMs?: number;
  readonly development?: boolean;
}

interface PluginRecord {
  readonly selection: PluginSelection;
  enabled: boolean;
  state: PluginRuntimeState;
  manifest?: NoirPluginManifest;
  module?: NoirPluginModule;
  config?: unknown;
  instance?: PluginInstanceRuntime;
  scope?: ResourceScope;
  controller?: AbortController;
  diagnostics: PluginDiagnostic[];
  phase: string;
}

interface PluginInstanceRuntime {
  readonly api?: unknown;
  start?(): unknown;
  onConfigChange?(next: unknown, previous: unknown): unknown;
  stop?(): unknown;
  dispose?(): unknown;
}

export interface PluginRuntime {
  readonly player: PlayerStore;
  readonly commands: CommandBus;
  readonly events: HostEventBus;
  readonly hooks: HookRegistry;
  readonly ui: UiRegistry;
  readonly services: ServiceRegistry;
  load(): Promise<void>;
  start(): Promise<void>;
  stop(id: string): Promise<void>;
  dispose(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  disposeAll(reason?: string): Promise<void>;
  updateConfig(id: string, input: unknown): Promise<void>;
  getStatus(id?: string): readonly PluginRuntimeStatus[] | PluginRuntimeStatus | undefined;
  subscribe(listener: () => void): Disposable;
  getPluginApi<T = unknown>(id: string): T | undefined;
}

export function createPluginRuntime(options: PluginRuntimeOptions): PluginRuntime {
  return new NoirPluginRuntime(options);
}

class NoirPluginRuntime implements PluginRuntime {
  readonly player: PlayerStore;
  readonly commands: CommandBus;
  readonly events: HostEventBus;
  readonly hooks: HookRegistry;
  readonly ui: UiRegistry;
  readonly services: ServiceRegistry;
  private readonly records = new Map<PluginIdString, PluginRecord>();
  private readonly listeners = new Set<() => void>();
  private readonly appVersion: string;
  private readonly platform: NoirPlatform;
  private readonly storage: StorageAdapter;
  private readonly mpvBackend?: MpvBackend;
  private readonly mpvEngine?: PlaybackEngine;
  private readonly logSink?: LogSink;
  private readonly diagnosticSink?: DiagnosticSink;
  private readonly telemetryBuffer = new MemoryTelemetry();
  private readonly lifecycleTimeoutMs: number;
  private readonly importTimeoutMs: number;
  private readonly development: boolean;
  private loaded = false;
  private disposed = false;

  constructor(private readonly options: PluginRuntimeOptions) {
    this.player = options.player ?? new PlayerStore();
    this.commands = options.commands ?? new CommandBus();
    this.events = options.events ?? new TypedEventBus();
    this.hooks = options.hooks ?? new HookRegistry();
    this.ui = options.ui ?? new UiRegistry();
    this.services = options.services ?? new ServiceRegistry();
    this.appVersion = options.appVersion ?? DEFAULT_APP_VERSION;
    this.platform = options.platform ?? (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? 'windows' : 'browser-preview');
    this.storage = options.storage ?? new LocalStorageAdapter();
    this.mpvBackend = options.mpvBackend;
    this.mpvEngine = options.mpvEngine;
    this.logSink = options.logger;
    this.diagnosticSink = options.onDiagnostic;
    this.lifecycleTimeoutMs = options.lifecycleTimeoutMs ?? DEFAULT_LIFECYCLE_TIMEOUT_MS;
    this.importTimeoutMs = options.importTimeoutMs ?? DEFAULT_IMPORT_TIMEOUT_MS;
    this.development = options.development ?? Boolean(import.meta.env?.DEV);
    for (const selection of options.selections) {
      this.records.set(selection.id, {
        selection,
        enabled: selection.enabled !== false,
        state: selection.enabled === false ? 'disabled' : 'selected',
        diagnostics: [],
        phase: 'selected',
      });
    }
  }

  async load(): Promise<void> {
    if (this.loaded || this.disposed) return;
    this.loaded = true;
    for (const record of this.records.values()) {
      if (!record.enabled) {
        this.report(record, 'selection', 'PLUGIN_DISABLED', 'Plugin is selected but disabled by the host.', true);
      }
    }
    const selected = [...this.records.values()].sort((left, right) =>
      (left.selection.priority ?? 0) - (right.selection.priority ?? 0)
      || left.selection.id.localeCompare(right.selection.id),
    );
    // Load and validate every selected module first. Dependency declarations
    // live in manifests, so topology can only be resolved after this phase.
    for (const record of selected) {
      if (!record.enabled) continue;
      await this.loadModuleRecord(record);
    }
    for (const record of this.resolveOrder()) {
      if (record.state === 'validated') await this.setupRecord(record);
    }
  }

  async start(): Promise<void> {
    await this.load();
    if (this.disposed) return;
    this.events.emit('host:ready', {
      appVersion: this.appVersion,
      apiVersion: NOIR_PLUGIN_API_VERSION,
      platform: this.platform,
    });
    for (const record of this.resolveOrder()) {
      if (record.state !== 'setup') continue;
      record.phase = 'start';
      this.transition(record, 'starting');
      try {
        await this.withTimeout(Promise.resolve(record.instance?.start?.()), this.lifecycleTimeoutMs, record, 'start');
        this.transition(record, 'active');
        this.telemetry(record, 'plugin.lifecycle', { phase: 'start', durationMs: 0 });
      } catch (error) {
        await this.failRecord(record, 'start', error);
      }
    }
  }

  async stop(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record || record.state === 'stopped' || record.state === 'disposed' || record.state === 'selected' || record.state === 'disabled' || record.state === 'blocked') return;
    record.phase = 'stop';
    record.controller?.abort();
    this.transition(record, 'stopping');
    try {
      await this.withTimeout(Promise.resolve(record.instance?.stop?.()), this.lifecycleTimeoutMs, record, 'stop');
    } catch (error) {
      this.report(record, 'stop', 'PLUGIN_LIFECYCLE', 'Plugin stop failed; resources were still cleaned.', true, error);
    } finally {
      record.scope?.dispose();
      record.scope = undefined;
      this.transition(record, 'stopped');
    }
  }

  async dispose(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record || record.state === 'disposed') return;
    if (record.state !== 'stopped' && record.state !== 'blocked' && record.state !== 'failed') await this.stop(id);
    record.phase = 'dispose';
    try {
      await this.withTimeout(Promise.resolve(record.instance?.dispose?.()), this.lifecycleTimeoutMs, record, 'dispose');
    } catch (error) {
      this.report(record, 'dispose', 'PLUGIN_LIFECYCLE', 'Plugin dispose failed after resource cleanup.', true, error);
    } finally {
      record.scope?.dispose();
      record.scope = undefined;
      this.transition(record, 'disposed');
      record.instance = undefined;
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Plugin ${id} is not installed.`);
    if (record.enabled === enabled && (enabled || record.state === 'disabled')) return;

    if (!enabled) {
      record.enabled = false;
      if (!['selected', 'disabled', 'blocked', 'disposed', 'failed'].includes(record.state)) {
        await this.dispose(id);
      }
      if (record.state !== 'disabled') this.transition(record, 'disabled');
      this.notify();
      return;
    }

    record.enabled = true;
    record.module = undefined;
    record.manifest = undefined;
    record.config = undefined;
    record.instance = undefined;
    record.scope = undefined;
    record.controller = undefined;
    this.transition(record, 'selected');
    await this.loadModuleRecord(record);
    if (record.state !== 'validated') return;
    await this.setupRecord(record);
    if (!(['setup'] as PluginRuntimeState[]).includes(record.state)) return;
    record.phase = 'start';
    this.transition(record, 'starting');
    try {
      const instance = record.instance as PluginInstanceRuntime | undefined;
      await this.withTimeout(Promise.resolve(instance?.start?.()), this.lifecycleTimeoutMs, record, 'start');
      this.transition(record, 'active');
    } catch (error) {
      await this.failRecord(record, 'start', error);
    }
    this.notify();
  }

  async remove(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    await this.dispose(id);
    this.records.delete(id);
    this.notify();
  }

  async disposeAll(reason = 'host-shutdown'): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.events.emit('host:disposing', { reason });
    const order = this.resolveOrder().reverse();
    for (const record of order) await this.dispose(record.selection.id);
    this.events.flush();
    this.events.dispose();
    this.hooks.clear();
    this.ui.clear();
    this.services.clear();
    this.commands.clear();
    this.listeners.clear();
  }

  async updateConfig(id: string, input: unknown): Promise<void> {
    const record = this.records.get(id);
    if (!record?.module || record.config === undefined) throw new PluginConfigError(id as never, `Plugin ${id} is not configured.`);
    let next: unknown;
    try {
      next = Object.freeze(record.module.config.parse(input));
    } catch (error) {
      throw new PluginConfigError(id as never, `Configuration for ${id} is invalid.`, error);
    }
    const previous = record.config;
    try {
      await this.withTimeout(Promise.resolve(record.instance?.onConfigChange?.(next, previous)), this.lifecycleTimeoutMs, record, 'config');
      record.config = next;
      this.storage.write(`noir-player:plugin:${id}:config`, { schemaVersion: record.module.configVersion ?? 1, value: next });
    } catch (error) {
      throw new PluginConfigError(id as never, `Configuration for ${id} could not be applied.`, error);
    }
  }

  getStatus(id?: string): readonly PluginRuntimeStatus[] | PluginRuntimeStatus | undefined {
    if (id) {
      const record = this.records.get(id);
      return record ? this.statusFor(record) : undefined;
    }
    return [...this.records.values()].map((record) => this.statusFor(record));
  }

  subscribe(listener: () => void): Disposable {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPluginApi<T = unknown>(id: string): T | undefined {
    return this.records.get(id)?.instance?.api as T | undefined;
  }

  private async loadModuleRecord(record: PluginRecord): Promise<void> {
    record.phase = 'load';
    this.transition(record, 'loading');
    let module: NoirPluginModule;
    try {
      const loaded = await this.withTimeout(record.selection.loader(), this.importTimeoutMs, record, 'load');
      module = loaded?.default;
      this.validateModule(record.selection, module);
      this.validateManifest(record.selection, module.manifest);
      this.validateCompatibility(record.selection, module.manifest);
      record.module = module;
      record.manifest = freezeManifest(module.manifest);
      this.transition(record, 'validated');
    } catch (error) {
      await this.failRecord(record, 'validate', error);
      return;
    }

    record.phase = 'config';
    let config: unknown;
    try {
      const configKey = `noir-player:plugin:${record.selection.id}:config`;
      const persisted = this.storage.read(configKey);
      const targetVersion = module.configVersion ?? 1;
      let persistedValue = persisted && typeof persisted === 'object'
        ? (persisted as { value?: unknown }).value
        : undefined;
      let persistedVersion = persisted && typeof persisted === 'object' && typeof (persisted as { schemaVersion?: unknown }).schemaVersion === 'number'
        ? (persisted as { schemaVersion: number }).schemaVersion
        : targetVersion;
      if (persistedValue !== undefined && persistedVersion < targetVersion) {
        try {
          this.storage.write(`${configKey}:backup:${Date.now()}`, persisted);
          while (persistedVersion < targetVersion) {
            const migration = module.configMigrations?.find((candidate) => candidate.fromVersion === persistedVersion);
            if (!migration || migration.toVersion <= persistedVersion) throw new Error(`No config migration from version ${persistedVersion}.`);
            persistedValue = migration.migrate(persistedValue);
            persistedVersion = migration.toVersion;
          }
        } catch (error) {
          this.report(record, 'config-migration', 'PLUGIN_CONFIG_MIGRATION', 'Stored plugin configuration was reset to safe defaults after migration failure.', true, error);
          persistedValue = undefined;
          persistedVersion = targetVersion;
        }
      } else if (persistedValue !== undefined && persistedVersion > targetVersion) {
        this.report(record, 'config-migration', 'PLUGIN_CONFIG_MIGRATION', 'Stored plugin configuration is newer than this plugin; safe defaults were used.', true);
        persistedValue = undefined;
        persistedVersion = targetVersion;
      }
      const input = {
        ...(isPlainObject(module.defaultConfig) ? module.defaultConfig : {}),
        ...(isPlainObject(record.selection.config) ? record.selection.config : {}),
        ...(isPlainObject(persistedValue) ? persistedValue : {}),
      };
      config = Object.freeze(module.config.parse(input));
      record.config = config;
      this.storage.write(configKey, { schemaVersion: targetVersion, value: config });
    } catch (error) {
      await this.failRecord(record, 'config', new PluginConfigError(record.selection.id as never, `Configuration for ${record.selection.id} is invalid.`, error));
      return;
    }

  }

  private async setupRecord(record: PluginRecord): Promise<void> {
    if (!record.module || record.config === undefined) return;
    record.phase = 'setup';
    record.scope = new ResourceScope();
    record.controller = new AbortController();
    try {
      const setup = record.module.setup as unknown as (context: NoirPluginContext, config: unknown) => unknown;
      record.instance = await this.withTimeout(Promise.resolve(setup(this.createContext(record), record.config)), this.lifecycleTimeoutMs, record, 'setup') as unknown as PluginInstanceRuntime;
      this.transition(record, 'setup');
      this.telemetry(record, 'plugin.lifecycle', { phase: 'setup', durationMs: 0 });
    } catch (error) {
      await this.failRecord(record, 'setup', error);
    }
  }

  private createContext(record: PluginRecord): NoirPluginContext {
    const selection = record.selection;
    const manifest = record.manifest!;
    const scope = record.scope!;
    const hasCapability = (capability: PluginCapability): boolean => selection.grants.includes(capability);
    const logger: PluginLogger = new ScopedLogger(selection.id, manifest.version, () => record.phase, this.logSink);
    const telemetry: PluginTelemetry = {
      record: (event, fields) => {
        if (hasCapability('telemetry')) this.telemetry(record, event, fields);
      },
    };
    const player: PlayerFacade = {
      getSnapshot: () => {
        if (!hasCapability('player.read')) throw new PluginPermissionError(selection.id as never, 'player.read');
        return this.player.getSnapshot();
      },
      subscribe: (listener) => {
        if (!hasCapability('player.read')) throw new PluginPermissionError(selection.id as never, 'player.read');
        return scope.add(this.player.subscribe(listener));
      },
    };
    const ui: PluginUiRegistry = {
      contribute: (contribution) => {
        if (!hasCapability('ui.contribute')) throw new PluginPermissionError(selection.id as never, 'ui.contribute');
        if (!contribution.id.startsWith(`${selection.id}/`)) throw new PluginManifestError(selection.id as never, `Contribution ${contribution.id} is outside the plugin namespace.`);
        return scope.add(this.ui.contribute(contribution, selection.id));
      },
    };
    const services: PluginServiceRegistry = {
      provide: (token, value) => {
        if (!hasCapability('services.provide')) throw new PluginPermissionError(selection.id as never, 'services.provide');
        if (!token.id.startsWith(`${selection.id}/`)) throw new PluginManifestError(selection.id as never, `Service ${token.id} is outside the plugin namespace.`);
        return scope.add(this.services.provide(token, value, selection.id));
      },
      get: (token, range) => {
        if (!hasCapability('services.consume')) throw new PluginPermissionError(selection.id as never, 'services.consume');
        return this.services.get(token, range);
      },
      optional: (token, range) => {
        if (!hasCapability('services.consume')) throw new PluginPermissionError(selection.id as never, 'services.consume');
        return this.services.optional(token, range);
      },
    };
    const readHooks = new Set(['media:before-open', 'media:resolve-source', 'subtitle:before-load', 'subtitle:after-parse', 'player:select-engine']);
    const hooks = {
      register: (hook: never, handler: never) => {
        const hookName = hook as string;
        const requiredCapability = readHooks.has(hookName) ? 'player.read' : 'player.control';
        if (!hasCapability(requiredCapability)) throw new PluginPermissionError(selection.id as never, requiredCapability);
        return scope.add(this.hooks.registerForPlugin(selection.id, hook, handler));
      },
    };
    const commands = this.commands.createScoped(selection.id, hasCapability, record.controller!.signal);
    const storage: PluginStorage = hasCapability('storage')
      ? new NamespacedPluginStorage(this.storage, selection.id)
      : new DeniedStorage(selection.id as never);
    const i18n: PluginI18n = new NamespacedI18n(selection.id);
    const mpv = this.createMpvFacade(record, hasCapability, scope);
    return {
      pluginId: selection.id,
      manifest,
      signal: scope.addAbortController(record.controller!),
      player,
      mpv,
      events: this.events,
      hooks,
      commands,
      ui,
      services,
      storage,
      i18n,
      logger,
      telemetry,
      resources: scope,
      hasCapability,
    };
  }

  private createMpvFacade(record: PluginRecord, hasCapability: (capability: PluginCapability) => boolean, scope: ResourceScope) {
    const backend = this.mpvEngine?.getMpvFacade
      ? undefined
      : this.mpvBackend;
    const rawFacade = this.mpvEngine?.getMpvFacade?.({
      canRead: hasCapability('native.mpv.read') || hasCapability('native.mpv.raw'),
      canRaw: hasCapability('native.mpv.raw'),
      pluginId: record.selection.id,
      registerDisposable: (disposable) => scope.add(disposable),
      audit: (operation, name, durationMs, outcome) => {
        this.telemetry(record, 'plugin.operation', { operation, name, durationMs, outcome: outcome === 'ok' });
      },
    });
    if (rawFacade) return rawFacade;
    if (backend) {
      return createMpvPluginFacade(backend, {
        canRead: hasCapability('native.mpv.read') || hasCapability('native.mpv.raw'),
        canRaw: hasCapability('native.mpv.raw'),
        pluginId: record.selection.id,
        registerDisposable: (disposable) => scope.add(disposable),
        audit: (operation, name, durationMs, outcome) => {
          this.telemetry(record, 'plugin.operation', { operation, name, durationMs, outcome: outcome === 'ok' });
        },
      });
    }
    return {
      isAvailable: () => false,
      getProperty: async () => { throw new MpvUnavailableError(record.selection.id as never); },
      observeProperties: () => { throw new MpvUnavailableError(record.selection.id as never); },
      listenEvents: () => { throw new MpvUnavailableError(record.selection.id as never); },
      command: async () => { throw new MpvUnavailableError(record.selection.id as never); },
      setProperty: async () => { throw new MpvUnavailableError(record.selection.id as never); },
    };
  }

  private validateModule(selection: PluginSelection, module: unknown): asserts module is NoirPluginModule {
    if (!module || typeof module !== 'object') throw new PluginManifestError(selection.id as never, 'Dynamic import did not return a plugin module.');
    const candidate = module as Partial<NoirPluginModule>;
    if (!candidate.manifest || typeof candidate.setup !== 'function' || !candidate.config || typeof candidate.config.parse !== 'function') {
      throw new PluginManifestError(selection.id as never, 'Plugin module must export manifest, defaultConfig, config.parse and setup.');
    }
  }

  private validateManifest(selection: PluginSelection, manifest: NoirPluginManifest): void {
    const idPattern = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
    if (!manifest || typeof manifest !== 'object') throw new PluginManifestError(selection.id as never, 'manifest is required.');
    if (!idPattern.test(manifest.id)) throw new PluginManifestError(selection.id as never, 'manifest.id must be lowercase namespace.name.');
    if (manifest.id !== selection.id) throw new PluginManifestError(selection.id as never, `selection.id ${selection.id} does not match manifest.id ${manifest.id}.`);
    if (!manifest.name || !manifest.description || !manifest.license) throw new PluginManifestError(selection.id as never, 'manifest.name, description and license are required.');
    if (!isValidVersion(manifest.version)) throw new PluginManifestError(selection.id as never, 'manifest.version must be an exact SemVer version.');
    if (!isValidRange(manifest.apiVersion)) throw new PluginManifestError(selection.id as never, 'manifest.apiVersion must be a SemVer range.');
    const requested = new Set(manifest.requestedCapabilities);
    if (requested.size !== manifest.requestedCapabilities.length || manifest.requestedCapabilities.some((capability) => !KNOWN_CAPABILITIES.has(capability))) {
      throw new PluginManifestError(selection.id as never, 'manifest.requestedCapabilities contains an unknown or duplicate capability.');
    }
    if (manifest.platforms?.some((platform) => platform !== 'windows' && platform !== 'browser-preview')) {
      throw new PluginManifestError(selection.id as never, 'manifest.platforms contains an unknown platform.');
    }
    for (const [dependency, range] of Object.entries(manifest.requires ?? {})) {
      if (!idPattern.test(dependency) || !isValidRange(range)) throw new PluginManifestError(selection.id as never, `Invalid required dependency ${dependency}.`);
    }
  }

  private validateCompatibility(selection: PluginSelection, manifest: NoirPluginManifest): void {
    if (!versionSatisfies(NOIR_PLUGIN_API_VERSION, manifest.apiVersion)) throw new PluginCompatibilityError(selection.id as never, `Plugin API range ${manifest.apiVersion} does not include ${NOIR_PLUGIN_API_VERSION}.`);
    if (manifest.appVersion && !versionSatisfies(this.appVersion, manifest.appVersion)) throw new PluginCompatibilityError(selection.id as never, `Plugin app range ${manifest.appVersion} does not include ${this.appVersion}.`);
    if (manifest.platforms && !manifest.platforms.includes(this.platform)) throw new PluginCompatibilityError(selection.id as never, `Plugin does not support ${this.platform}.`);
    for (const grant of selection.grants) {
      if (!manifest.requestedCapabilities.includes(grant)) throw new PluginPermissionError(selection.id as never, grant, `Selection grants ${grant}, but the manifest did not request it.`);
    }
    for (const acknowledgement of selection.riskAcknowledgements ?? []) {
      if (!selection.grants.includes(acknowledgement)) throw new PluginPermissionError(selection.id as never, acknowledgement, `Risk acknowledgement ${acknowledgement} has no matching grant.`);
    }
    for (const risk of ['native.mpv.raw', 'unsafe.dom'] as const) {
      if (selection.grants.includes(risk) && !selection.riskAcknowledgements?.includes(risk)) throw new PluginPermissionError(selection.id as never, risk, `${risk} requires an explicit risk acknowledgement.`);
    }
  }

  private resolveOrder(): PluginRecord[] {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const ordered: PluginRecord[] = [];
    const visit = (record: PluginRecord) => {
      if (visited.has(record.selection.id) || record.state === 'blocked') return;
      if (visiting.has(record.selection.id)) {
        record.state = 'blocked';
        this.report(record, 'validate', 'PLUGIN_DEPENDENCY', 'Required plugin dependency cycle detected.', false);
        return;
      }
      visiting.add(record.selection.id);
      const requires = record.manifest?.requires ?? {};
      for (const [dependency, range] of Object.entries(requires)) {
        const dependencyRecord = this.records.get(dependency);
        if (!dependencyRecord || !dependencyRecord.enabled) {
          record.state = 'blocked';
          this.report(record, 'validate', 'PLUGIN_DEPENDENCY', `Required plugin ${dependency} is not selected or enabled.`, false);
          visiting.delete(record.selection.id);
          return;
        }
        if (dependencyRecord.manifest && !versionSatisfies(dependencyRecord.manifest.version, range)) {
          record.state = 'blocked';
          this.report(record, 'validate', 'PLUGIN_DEPENDENCY', `Required plugin ${dependency} does not satisfy ${range}.`, false);
          visiting.delete(record.selection.id);
          return;
        }
        visit(dependencyRecord);
        if (!['validated', 'setup', 'starting', 'active', 'stopping', 'stopped'].includes(dependencyRecord.state)) {
          record.state = 'blocked';
          this.report(record, 'validate', 'PLUGIN_DEPENDENCY', `Required plugin ${dependency} is blocked.`, false);
          visiting.delete(record.selection.id);
          return;
        }
      }
      visiting.delete(record.selection.id);
      visited.add(record.selection.id);
      ordered.push(record);
    };
    for (const record of [...this.records.values()].sort((left, right) => (left.selection.priority ?? 0) - (right.selection.priority ?? 0) || left.selection.id.localeCompare(right.selection.id))) visit(record);
    return ordered;
  }

  private transition(record: PluginRecord, state: PluginRuntimeState): void {
    const from = record.state;
    record.state = state;
    this.events.emit('plugin:state-changed', { id: record.selection.id as never, from, to: state });
    this.notify();
  }

  private async failRecord(record: PluginRecord, phase: string, error: unknown): Promise<void> {
    record.phase = phase;
    record.scope?.dispose();
    record.scope = undefined;
    record.controller?.abort();
    record.controller = undefined;
    record.instance = undefined;
    record.state = 'failed';
    this.report(record, phase, error instanceof NoirPluginError ? error.code : 'PLUGIN_LIFECYCLE', this.publicMessage(error), error instanceof NoirPluginError ? error.recoverable : true, error);
    this.notify();
  }

  private report(record: PluginRecord, phase: string, code: string, message: string, recoverable: boolean, cause?: unknown): void {
    const diagnostic: PluginDiagnostic = Object.freeze({
      pluginId: record.selection.id as never,
      version: record.manifest?.version,
      phase,
      code,
      severity: recoverable ? 'warning' : 'error',
      recoverable,
      message: this.publicMessage(message),
      timestamp: Date.now(),
    });
    record.diagnostics.push(diagnostic);
    this.diagnosticSink?.(diagnostic);
    if (cause && this.development) {
      const logger = new ScopedLogger(record.selection.id, record.manifest?.version ?? 'unknown', () => phase, this.logSink);
      logger.error('Plugin diagnostic cause', { code, phase });
    }
    this.notify();
  }

  private statusFor(record: PluginRecord): PluginRuntimeStatus {
    return Object.freeze({
      id: record.selection.id as never,
      enabled: record.enabled,
      state: record.state,
      manifest: record.manifest,
      grants: Object.freeze([...record.selection.grants]),
      trust: record.selection.trust,
      diagnostics: Object.freeze([...record.diagnostics]),
    });
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, record: PluginRecord, phase: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new PluginLifecycleError(record.selection.id as never, phase, new Error('timeout'))), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private telemetry(record: PluginRecord, event: Parameters<PluginTelemetry['record']>[0], fields: Parameters<PluginTelemetry['record']>[1]): void {
    this.telemetryBuffer.record(event, { pluginId: record.selection.id, ...fields });
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private publicMessage(error: unknown): string {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message.replace(/([A-Za-z]:\\[^\s]+|file:\/\/[^\s]+)/gi, '<redacted>');
    return 'Plugin operation failed.';
  }
}

class DeniedStorage implements PluginStorage {
  readonly schemaVersion = 1;
  constructor(private readonly pluginId: never) {}
  get(): undefined { throw new PluginPermissionError(this.pluginId, 'storage'); }
  set(): void { throw new PluginPermissionError(this.pluginId, 'storage'); }
  remove(): void { throw new PluginPermissionError(this.pluginId, 'storage'); }
  clear(): void { throw new PluginPermissionError(this.pluginId, 'storage'); }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function freezeManifest(manifest: NoirPluginManifest): NoirPluginManifest {
  return Object.freeze({
    ...manifest,
    authors: manifest.authors ? Object.freeze([...manifest.authors]) : undefined,
    platforms: manifest.platforms ? Object.freeze([...manifest.platforms]) : undefined,
    requestedCapabilities: Object.freeze([...manifest.requestedCapabilities]),
    requires: manifest.requires ? Object.freeze({ ...manifest.requires }) : undefined,
    optional: manifest.optional ? Object.freeze({ ...manifest.optional }) : undefined,
  });
}

export function createDefaultPluginRuntimeOptions(selections: readonly PluginSelection[]): PluginRuntimeOptions {
  return {
    selections,
    player: new PlayerStore(),
    commands: new CommandBus(),
    events: new TypedEventBus(),
    hooks: new HookRegistry(),
    ui: new UiRegistry(),
    services: new ServiceRegistry(),
    storage: typeof window === 'undefined' ? new MemoryStorageAdapter() : new LocalStorageAdapter(),
  };
}
