import type { ComponentType } from 'react';

/** Public contract version. Keep this independent from the application version. */
export const NOIR_PLUGIN_API_VERSION = '1.0.0' as const;

export type PluginId = `${Lowercase<string>}.${Lowercase<string>}`;
export type MaybePromise<T> = T | Promise<T>;
export type Disposable = () => void;

export type PluginCapability =
  | 'player.read'
  | 'player.control'
  | 'ui.contribute'
  | 'commands.contribute'
  | 'services.consume'
  | 'services.provide'
  | 'storage'
  | 'telemetry'
  | 'network'
  | 'native.media-read'
  | 'native.mpv.read'
  | 'native.mpv.raw'
  | 'unsafe.dom';

export type PluginRiskAcknowledgement = 'native.mpv.raw' | 'unsafe.dom';
export type NoirPlatform = 'windows' | 'browser-preview';

export interface NoirPluginManifest {
  readonly id: PluginId;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly appVersion?: string;
  readonly description: string;
  readonly license: string;
  readonly authors?: readonly string[];
  readonly homepage?: string;
  readonly repository?: string;
  readonly platforms?: readonly NoirPlatform[];
  readonly requestedCapabilities: readonly PluginCapability[];
  readonly requires?: Readonly<Record<PluginId, string>>;
  readonly optional?: Readonly<Record<PluginId, string>>;
}

export interface ConfigParser<TConfig> {
  parse(input: unknown): TConfig;
}

export interface ConfigMigration {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(input: unknown): unknown;
}

export interface NoirPluginModule<TConfig = unknown, TApi = unknown> {
  readonly manifest: NoirPluginManifest;
  readonly defaultConfig: TConfig;
  readonly config: ConfigParser<TConfig>;
  readonly configVersion?: number;
  readonly configMigrations?: readonly ConfigMigration[];
  setup(
    context: NoirPluginContext,
    config: Readonly<TConfig>,
  ): MaybePromise<NoirPluginInstance<TConfig, TApi>>;
}

export interface NoirPluginInstance<TConfig = unknown, TApi = unknown> {
  readonly api?: TApi;
  start?(): MaybePromise<void>;
  onConfigChange?(
    next: Readonly<TConfig>,
    previous: Readonly<TConfig>,
  ): MaybePromise<void>;
  stop?(): MaybePromise<void>;
  dispose?(): MaybePromise<void>;
}

export function definePlugin<TConfig, TApi = unknown>(
  plugin: NoirPluginModule<TConfig, TApi>,
): NoirPluginModule<TConfig, TApi> {
  return plugin;
}

export interface PluginSelection<TConfig = unknown> {
  readonly id: PluginId;
  readonly loader: () => Promise<{
    default: NoirPluginModule<TConfig, unknown>;
  }>;
  readonly enabled?: boolean;
  readonly config?: unknown;
  readonly grants: readonly PluginCapability[];
  readonly riskAcknowledgements?: readonly PluginRiskAcknowledgement[];
  readonly trust: 'first-party' | 'curated' | 'reviewed-third-party';
  readonly priority?: number;
}

export function defineNoirPlugins(
  selections: readonly PluginSelection[],
): readonly PluginSelection[] {
  return Object.freeze([...selections]);
}

export type MpvPropertyFormat =
  | 'none'
  | 'string'
  | 'flag'
  | 'int64'
  | 'double'
  | 'node';

export type MpvValue =
  | null
  | boolean
  | number
  | string
  | readonly MpvValue[]
  | { readonly [key: string]: MpvValue };

export interface MpvObservedProperty {
  readonly name: string;
  readonly format: MpvPropertyFormat;
  readonly optional?: boolean;
}

export interface MpvPropertyEvent {
  readonly name: string;
  readonly data: MpvValue;
}

export interface MpvEvent {
  readonly name: string;
  readonly data?: MpvValue;
}

export interface MpvPluginFacade {
  isAvailable(): boolean;
  getProperty<T extends MpvValue = MpvValue>(
    name: string,
    format?: MpvPropertyFormat,
  ): Promise<T>;
  observeProperties(
    properties: readonly MpvObservedProperty[],
    listener: (event: MpvPropertyEvent) => void,
  ): Disposable;
  listenEvents(
    events: readonly string[],
    listener: (event: MpvEvent) => void,
  ): Disposable;
  command<T extends MpvValue = MpvValue>(
    name: string,
    args?: readonly MpvValue[],
  ): Promise<T>;
  setProperty(name: string, value: MpvValue): Promise<void>;
}

export interface TimeRangeSnapshot {
  readonly start: number;
  readonly end: number;
}

export interface SubtitlePublicSnapshot {
  readonly trackId: string | null;
  readonly displayName: string | null;
  readonly cueIndex: number;
  readonly cueText: string | null;
  readonly offsetMs: number;
}

export interface PlaylistPublicItem {
  readonly id: string;
  readonly displayName: string;
  readonly active: boolean;
}

export interface PlaylistPublicSnapshot {
  readonly items: readonly PlaylistPublicItem[];
  readonly activeId: string | null;
}

export interface UiPublicSnapshot {
  readonly panelVisible: boolean;
  readonly panelTab: string | null;
  readonly playbackControlsVisible: boolean;
}

export interface PlayerSnapshot {
  readonly revision: number;
  readonly sessionId: string | null;
  readonly status:
    | 'empty'
    | 'opening'
    | 'ready'
    | 'playing'
    | 'paused'
    | 'ended'
    | 'error';
  readonly media: null | {
    readonly displayName: string;
    readonly sourceKind: 'local-file' | 'object-url' | 'hls';
    readonly engine: 'libmpv' | 'html-media' | 'hls-js' | 'ffmpeg-fallback';
    readonly engineStatus: 'loading' | 'ready' | 'failed' | 'switching';
    readonly duration: number | null;
    readonly currentTime: number;
    readonly videoSize: null | { readonly width: number; readonly height: number };
    readonly buffered: readonly TimeRangeSnapshot[];
  };
  readonly playback: {
    readonly paused: boolean;
    readonly rate: number;
    readonly volume: number;
    readonly muted: boolean;
    readonly fullscreen: boolean;
  };
  readonly subtitles: SubtitlePublicSnapshot;
  readonly playlist: PlaylistPublicSnapshot;
  readonly ui: UiPublicSnapshot;
}

export interface PlayerFacade {
  getSnapshot(): Readonly<PlayerSnapshot>;
  subscribe(listener: () => void): Disposable;
}

export interface PluginEventMeta {
  readonly timestamp: number;
  readonly revision: number;
  readonly sessionId: string | null;
  readonly correlationId?: string;
}

export interface NoirEventPayloadMap {
  'host:ready': {
    readonly appVersion: string;
    readonly apiVersion: string;
    readonly platform: NoirPlatform;
  };
  'host:disposing': { readonly reason: string };
  'plugin:state-changed': {
    readonly id: PluginId;
    readonly from: string;
    readonly to: string;
  };
  'media:opening': {
    readonly sessionId: string;
    readonly displayName: string;
    readonly kind: 'local-file' | 'object-url' | 'hls';
  };
  'media:engine-changed': {
    readonly previous: PlayerSnapshot['media'] extends infer T
      ? T extends { engine: infer E }
        ? E | null
        : never
      : never;
    readonly next: 'libmpv' | 'html-media' | 'hls-js' | 'ffmpeg-fallback';
    readonly reason: string;
  };
  'media:source-changed': { readonly media: PlayerSnapshot['media'] };
  'media:loaded-metadata': {
    readonly duration: number | null;
    readonly dimensions: { readonly width: number; readonly height: number } | null;
  };
  'media:ready': { readonly media: PlayerSnapshot['media'] };
  'media:play': { readonly currentTime: number };
  'media:pause': { readonly currentTime: number };
  'media:time-update': { readonly currentTime: number; readonly duration: number | null };
  'media:seeking': { readonly from: number; readonly to: number };
  'media:seeked': { readonly from: number; readonly to: number };
  'media:rate-change': { readonly rate: number };
  'media:volume-change': { readonly volume: number; readonly muted: boolean };
  'media:ended': { readonly currentTime: number };
  'media:error': { readonly error: PublicMediaError };
  'subtitle:track-changed': { readonly track: SubtitlePublicSnapshot };
  'subtitle:cue-changed': {
    readonly index: number;
    readonly cueText: string | null;
  };
  'subtitle:offset-changed': { readonly offsetMs: number };
  'subtitle:style-changed': { readonly style: Readonly<Record<string, string | number | boolean>> };
  'playlist:changed': PlaylistPublicSnapshot;
  'playlist:item-changed': {
    readonly previous: PlaylistPublicItem | null;
    readonly next: PlaylistPublicItem | null;
  };
  'ui:panel-changed': { readonly visible: boolean; readonly tab: string | null };
  'ui:fullscreen-changed': { readonly fullscreen: boolean };
  'ui:playback-controls-visibility-changed': { readonly visible: boolean };
  'i18n:locale-changed': { readonly locale: string };
}

export interface PublicMediaError {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export type CoreEventName = keyof NoirEventPayloadMap;
export type PluginEventName = CoreEventName | `${PluginId}:${string}`;

export interface PluginEventEnvelope<K extends CoreEventName = CoreEventName> extends PluginEventMeta {
  readonly name: K;
  readonly payload: Readonly<NoirEventPayloadMap[K]>;
}

export interface PluginEventBus {
  on<K extends CoreEventName>(
    event: K,
    listener: (envelope: PluginEventEnvelope<K>) => void,
  ): Disposable;
  once<K extends CoreEventName>(
    event: K,
    listener: (envelope: PluginEventEnvelope<K>) => void,
  ): Disposable;
  onAny?(listener: (envelope: PluginEventEnvelope) => void): Disposable;
}

export type HookDecision = 'allow' | 'cancel';
export interface HookInvocationContext {
  readonly signal: AbortSignal;
  readonly deadline: number;
  readonly correlationId: string;
}

export interface HostHookMap {
  'media:before-open': {
    readonly input: { readonly path: string; readonly displayName: string };
    readonly output: { readonly decision: HookDecision; readonly request?: { readonly path: string; readonly displayName: string } };
  };
  'media:resolve-source': {
    readonly input: { readonly sourceKind: PlayerSnapshot['media'] extends infer T ? T extends { sourceKind: infer K } ? K : never : never; readonly displayName: string };
    readonly output: { readonly decision: 'continue' | 'replace'; readonly sourceKind?: 'local-file' | 'object-url' | 'hls' };
  };
  'media:before-play': {
    readonly input: Readonly<PlayerSnapshot>;
    readonly output: { readonly decision: HookDecision };
  };
  'media:before-seek': {
    readonly input: { readonly from: number; readonly to: number };
    readonly output: { readonly decision: HookDecision; readonly target?: number };
  };
  'subtitle:before-load': {
    readonly input: { readonly displayName: string; readonly kind: string };
    readonly output: { readonly decision: HookDecision };
  };
  'subtitle:after-parse': {
    readonly input: Readonly<SubtitlePublicSnapshot>;
    readonly output: { readonly decision: 'keep' | 'replace'; readonly track?: Readonly<SubtitlePublicSnapshot> };
  };
  'player:select-engine': {
    readonly input: { readonly available: readonly string[]; readonly displayName: string };
    readonly output: { readonly engine?: string };
  };
  'player:configure-engine': {
    readonly input: { readonly engine: string; readonly options: Readonly<Record<string, string | number | boolean>> };
    readonly output: { readonly options: Readonly<Record<string, string | number | boolean>> };
  };
}

export type PluginHookHandler<K extends keyof HostHookMap> = (
  input: HostHookMap[K]['input'],
  context: HookInvocationContext,
) => MaybePromise<HostHookMap[K]['output'] | void>;

export interface PluginHookRegistry {
  register<K extends keyof HostHookMap>(
    hook: K,
    handler: PluginHookHandler<K>,
  ): Disposable;
}

export interface HostCommandMap {
  'media.open': { input: { readonly path: string; readonly displayName?: string }; output: void };
  'media.play': { input: undefined; output: void };
  'media.pause': { input: undefined; output: void };
  'media.toggle': { input: undefined; output: void };
  'media.seekTo': { input: { readonly seconds: number }; output: void };
  'media.seekBy': { input: { readonly seconds: number }; output: void };
  'media.setRate': { input: { readonly rate: number }; output: void };
  'media.setVolume': { input: { readonly volume: number }; output: void };
  'media.setMuted': { input: { readonly muted: boolean }; output: void };
  'media.retryWithFallback': { input: undefined; output: void };
  'fullscreen.enter': { input: undefined; output: void };
  'fullscreen.exit': { input: undefined; output: void };
  'fullscreen.toggle': { input: undefined; output: void };
  'subtitle.open': { input: { readonly path: string }; output: void };
  'subtitle.selectEmbedded': { input: { readonly id: string }; output: void };
  'subtitle.clear': { input: undefined; output: void };
  'subtitle.setOffset': { input: { readonly offsetMs: number }; output: void };
  'subtitle.export': { input: undefined; output: void };
  'playlist.refresh': { input: undefined; output: void };
  'playlist.play': { input: { readonly id: string }; output: void };
  'playlist.next': { input: undefined; output: void };
  'playlist.previous': { input: undefined; output: void };
  'panel.open': { input: { readonly tab?: string }; output: void };
  'panel.close': { input: undefined; output: void };
  'notice.show': { input: { readonly message: string; readonly level?: 'info' | 'warning' | 'error' }; output: void };
}

export type PluginCommandName = `${PluginId}.${string}`;
export type PluginCommandHandler = (input: unknown, context: { readonly signal: AbortSignal }) => MaybePromise<unknown>;

export interface PluginCommandBus {
  execute<K extends keyof HostCommandMap>(
    command: K,
    input: HostCommandMap[K]['input'],
    options?: { signal?: AbortSignal },
  ): Promise<HostCommandMap[K]['output']>;
  executePlugin<T = unknown>(
    command: PluginCommandName,
    input?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<T>;
  register<K extends PluginCommandName>(command: K, handler: PluginCommandHandler): Disposable;
}

export type PluginSlotName =
  | 'app.header.actions'
  | 'app.hero.actions'
  | 'stage.info'
  | 'stage.actions'
  | 'player.before-media'
  | 'player.overlay'
  | 'player.controls.left'
  | 'player.controls.right'
  | 'player.dock'
  | 'panel.tabs'
  | 'panel.content'
  | 'settings.sections'
  | 'notifications';

export interface PluginSlotProps {
  readonly snapshot: Readonly<PlayerSnapshot>;
  readonly className?: string;
}

export interface UiContribution<TProps = PluginSlotProps> {
  readonly id: `${PluginId}/${string}`;
  readonly slot: PluginSlotName;
  readonly order?: number;
  readonly component: ComponentType<TProps>;
  readonly when?: (snapshot: Readonly<PlayerSnapshot>) => boolean;
  readonly ariaLabel?: string;
}

export interface PluginUiRegistry {
  contribute<TProps = PluginSlotProps>(contribution: UiContribution<TProps>): Disposable;
}

export interface PluginServiceToken<T> {
  readonly id: `${PluginId | 'noir.core'}/${string}`;
  readonly version: string;
  readonly __type?: T;
}

export function createServiceToken<T>(
  id: PluginServiceToken<T>['id'],
  version: string,
): PluginServiceToken<T> {
  return Object.freeze({ id, version });
}

export interface PluginServiceRegistry {
  provide<T>(token: PluginServiceToken<T>, value: T): Disposable;
  get<T>(token: PluginServiceToken<T>, range?: string): T;
  optional<T>(token: PluginServiceToken<T>, range?: string): T | undefined;
}

export type PluginStorageValue = null | boolean | number | string | readonly PluginStorageValue[] | { readonly [key: string]: PluginStorageValue };

export interface PluginStorage {
  get<T extends PluginStorageValue = PluginStorageValue>(key: string): T | undefined;
  set<T extends PluginStorageValue>(key: string, value: T): void;
  remove(key: string): void;
  clear(): void;
  readonly schemaVersion: number;
}

export interface PluginI18n {
  t(key: string, variables?: Readonly<Record<string, string | number>>): string;
  register(locale: string, messages: Readonly<Record<string, string>>): Disposable;
  getLocale(): string;
}

export type PluginLogFields = Readonly<Record<string, string | number | boolean | null>>;
export interface PluginLogger {
  debug(message: string, fields?: PluginLogFields): void;
  info(message: string, fields?: PluginLogFields): void;
  warn(message: string, fields?: PluginLogFields): void;
  error(message: string, fields?: PluginLogFields): void;
}

export type PluginTelemetryEvent =
  | 'plugin.lifecycle'
  | 'plugin.engine'
  | 'plugin.operation'
  | 'plugin.failure'
  | 'plugin.performance';

export interface PluginTelemetry {
  record(event: PluginTelemetryEvent, fields: PluginLogFields): void;
}

export interface PluginResourceScope {
  add<T extends Disposable>(disposable: T): T;
  addAbortController(controller: AbortController): AbortSignal;
  addTimer(timer: ReturnType<typeof setTimeout>): ReturnType<typeof setTimeout>;
  dispose(): void;
  readonly size: number;
}

export interface NoirPluginContext {
  readonly pluginId: PluginId;
  readonly manifest: NoirPluginManifest;
  readonly signal: AbortSignal;
  readonly player: PlayerFacade;
  readonly mpv: MpvPluginFacade;
  readonly events: PluginEventBus;
  readonly hooks: PluginHookRegistry;
  readonly commands: PluginCommandBus;
  readonly ui: PluginUiRegistry;
  readonly services: PluginServiceRegistry;
  readonly storage: PluginStorage;
  readonly i18n: PluginI18n;
  readonly logger: PluginLogger;
  readonly telemetry: PluginTelemetry;
  readonly resources: PluginResourceScope;
  hasCapability(capability: PluginCapability): boolean;
}

export type PluginDiagnosticSeverity = 'info' | 'warning' | 'error';
export interface PluginDiagnostic {
  readonly pluginId: PluginId;
  readonly version?: string;
  readonly phase: string;
  readonly code: string;
  readonly severity: PluginDiagnosticSeverity;
  readonly recoverable: boolean;
  readonly message: string;
  readonly timestamp: number;
  readonly correlationId?: string;
  readonly sessionId?: string | null;
}

export type PluginRuntimeState =
  | 'selected'
  | 'disabled'
  | 'loading'
  | 'validated'
  | 'setup'
  | 'starting'
  | 'active'
  | 'stopping'
  | 'stopped'
  | 'disposed'
  | 'failed'
  | 'blocked';

export interface PluginRuntimeStatus {
  readonly id: PluginId;
  readonly enabled: boolean;
  readonly state: PluginRuntimeState;
  readonly manifest?: NoirPluginManifest;
  readonly grants: readonly PluginCapability[];
  readonly trust: PluginSelection['trust'];
  readonly diagnostics: readonly PluginDiagnostic[];
}

export type PluginErrorCode =
  | 'PLUGIN_MANIFEST_INVALID'
  | 'PLUGIN_COMPATIBILITY'
  | 'PLUGIN_DEPENDENCY'
  | 'PLUGIN_CONFIG_INVALID'
  | 'PLUGIN_PERMISSION_DENIED'
  | 'PLUGIN_LIFECYCLE'
  | 'PLUGIN_COMMAND'
  | 'PLUGIN_HOOK_TIMEOUT'
  | 'MPV_UNAVAILABLE'
  | 'MPV_OPERATION';

export class NoirPluginError extends Error {
  readonly code: PluginErrorCode;
  readonly pluginId: PluginId;
  readonly phase: string;
  readonly recoverable: boolean;
  readonly cause?: unknown;

  constructor(
    code: PluginErrorCode,
    pluginId: PluginId,
    phase: string,
    message: string,
    recoverable = true,
    cause?: unknown,
  ) {
    super(message);
    this.name = code;
    this.code = code;
    this.pluginId = pluginId;
    this.phase = phase;
    this.recoverable = recoverable;
    this.cause = cause;
  }
}

export class PluginManifestError extends NoirPluginError {
  constructor(pluginId: PluginId, message: string, cause?: unknown) {
    super('PLUGIN_MANIFEST_INVALID', pluginId, 'validate', message, false, cause);
  }
}

export class PluginCompatibilityError extends NoirPluginError {
  constructor(pluginId: PluginId, message: string, cause?: unknown) {
    super('PLUGIN_COMPATIBILITY', pluginId, 'validate', message, false, cause);
  }
}

export class PluginDependencyError extends NoirPluginError {
  constructor(pluginId: PluginId, message: string, cause?: unknown) {
    super('PLUGIN_DEPENDENCY', pluginId, 'validate', message, false, cause);
  }
}

export class PluginConfigError extends NoirPluginError {
  constructor(pluginId: PluginId, message: string, cause?: unknown) {
    super('PLUGIN_CONFIG_INVALID', pluginId, 'config', message, true, cause);
  }
}

export class PluginPermissionError extends NoirPluginError {
  readonly capability: PluginCapability;

  constructor(pluginId: PluginId, capability: PluginCapability, message = `Capability ${capability} was not granted.`) {
    super('PLUGIN_PERMISSION_DENIED', pluginId, 'permission', message, true);
    this.capability = capability;
  }
}

export class PluginLifecycleError extends NoirPluginError {
  constructor(pluginId: PluginId, phase: string, cause: unknown) {
    super('PLUGIN_LIFECYCLE', pluginId, phase, `Plugin lifecycle failed during ${phase}.`, true, cause);
  }
}

export class PluginCommandError extends NoirPluginError {
  constructor(pluginId: PluginId, message: string, cause?: unknown) {
    super('PLUGIN_COMMAND', pluginId, 'command', message, true, cause);
  }
}

export class PluginHookTimeoutError extends NoirPluginError {
  constructor(pluginId: PluginId, hook: string) {
    super('PLUGIN_HOOK_TIMEOUT', pluginId, 'hook', `Hook ${hook} exceeded its deadline.`, true);
  }
}

export class MpvUnavailableError extends NoirPluginError {
  constructor(pluginId: PluginId, message = 'libmpv is not available for the active engine.') {
    super('MPV_UNAVAILABLE', pluginId, 'mpv', message, true);
  }
}

export class MpvOperationError extends NoirPluginError {
  constructor(pluginId: PluginId, message: string, cause?: unknown) {
    super('MPV_OPERATION', pluginId, 'mpv', message, true, cause);
  }
}
