# Contrato TypeScript público del plugin

Este archivo define la forma mínima normativa. Luna Max puede mejorar nombres con ADR, pero debe conservar las garantías y publicar el contrato desde `@noir-player/plugin-api` sin imports de internals.

## Manifest y módulo

```ts
export const NOIR_PLUGIN_API_VERSION = '1.0.0' as const;

export type PluginId = `${Lowercase<string>}.${Lowercase<string>}`;
export type MaybePromise<T> = T | Promise<T>;

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

export interface NoirPluginManifest {
  readonly id: PluginId;
  readonly name: string;
  readonly version: string;          // SemVer exacto
  readonly apiVersion: string;       // range SemVer del SDK/host
  readonly appVersion?: string;      // range SemVer de Noir Player
  readonly description: string;
  readonly license: string;
  readonly authors?: readonly string[];
  readonly homepage?: string;
  readonly repository?: string;
  readonly platforms?: readonly ('windows' | 'browser-preview')[];
  readonly requestedCapabilities: readonly PluginCapability[];
  readonly requires?: Readonly<Record<PluginId, string>>;
  readonly optional?: Readonly<Record<PluginId, string>>;
}

export interface ConfigParser<TConfig> {
  parse(input: unknown): TConfig; // lanza error descriptivo sin secretos
}

export interface NoirPluginModule<TConfig = unknown, TApi = unknown> {
  readonly manifest: NoirPluginManifest;
  readonly defaultConfig: TConfig;
  readonly config: ConfigParser<TConfig>;
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
): NoirPluginModule<TConfig, TApi>;
```

`manifest` y `defaultConfig` DEBEN ser datos serializables e inmutables. La validación recibe `unknown`; no se permite `as TConfig` como sustituto. El host debe congelar en desarrollo los datos públicos para descubrir mutaciones indebidas.

## Selección controlada por la aplicación

La confianza y los grants no se leen del manifest:

```ts
export interface PluginSelection<TConfig = unknown> {
  readonly id: PluginId;
  readonly loader: () => Promise<{ default: NoirPluginModule<TConfig, unknown> }>;
  readonly enabled?: boolean;
  readonly config?: unknown;
  readonly grants: readonly PluginCapability[];
  readonly riskAcknowledgements?: readonly ('native.mpv.raw' | 'unsafe.dom')[];
  readonly trust: 'first-party' | 'curated' | 'reviewed-third-party';
  readonly priority?: number;
}

export function defineNoirPlugins(
  selections: readonly PluginSelection[],
): readonly PluginSelection[];
```

El runtime DEBE verificar que `selection.id === module.manifest.id`, que todo grant fue solicitado y que toda capacidad solicitada no concedida produce una denegación determinista o una fachada ausente, nunca privilegio implícito. `native.mpv.raw` y `unsafe.dom` requieren además aparecer en `riskAcknowledgements`; un manifest no puede reconocer el riesgo por el host. La app, no el paquete, decide `trust`.

## Contexto del host

```ts
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
```

Cada propiedad sensible debe estar capability-gated. Si no hay grant, la llamada falla con `PluginPermissionError` tipado. No basta con ocultar la propiedad en TypeScript.

`signal` se aborta antes de `stop`. `resources` registra disposables, listeners, timers y abort controllers; el host los limpia aunque `setup/start/stop/dispose` lance.

## Fachada avanzada de libmpv

La fachada pública no importa tipos de `tauri-plugin-libmpv-api`; publica DTOs equivalentes y estables para que los plugins no dependan del paquete interno. Debe ofrecer control real, no una lista cerrada de comandos:

```ts
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

  // Requieren native.mpv.read o native.mpv.raw.
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

  // Requieren native.mpv.raw + risk acknowledgement.
  command<T extends MpvValue = MpvValue>(
    name: string,
    args?: readonly MpvValue[],
  ): Promise<T>;
  setProperty(name: string, value: MpvValue): Promise<void>;
}
```

`native.mpv.raw` no aplica allowlist de nombres: el propósito es permitir acceso a funciones nuevas o especializadas de mpv. El broker sí valida que nombres no estén vacíos, que valores sean serializables/acotados, que el engine actual sea libmpv y que el scope siga activo. Todas las llamadas se correlacionan y registran con redacción; el plugin acepta que un comando válido puede alterar o romper la sesión.

`observeProperties` y `listenEvents` registran cleanup automáticamente en `PluginResourceScope` además de devolver `Disposable`. Al cambiar a fallback, emiten/cancelan de forma definida y las operaciones posteriores fallan con `MpvUnavailableError`; nunca se redirigen silenciosamente a HTMLMediaElement.

La v1 NO expone `initMpv`, `destroyMpv`, la instancia interna, `setVideoMarginRatio`, handles de ventana/WebView ni `invoke` Tauri general. Esos recursos tienen ownership global y no son necesarios para permitir comandos/properties mpv. Una capability futura podría ampliar lifecycle/surface mediante otro ADR.

## Snapshot y fachada del reproductor

```ts
export interface PlayerSnapshot {
  readonly revision: number;
  readonly sessionId: string | null;
  readonly status: 'empty' | 'opening' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';
  readonly media: null | {
    readonly displayName: string; // no ruta por defecto
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
  subscribe(listener: () => void): () => void;
}
```

La ruta local sólo debe aparecer en una API explícita con grant apropiado. `sourceKind` describe la fuente y `engine` el backend efectivo; no reutilizar el `VideoSource.kind === 'mpv'` interno como contrato público. Snapshots no incluyen elementos DOM, instancias Plyr/Hls/libmpv, callbacks, `File`, `Blob` ni setters. Properties/comandos mpv viven exclusivamente en `MpvPluginFacade`.

## Errores públicos

Exportar clases/códigos estables, serializables y testeados:

- `PluginManifestError`;
- `PluginCompatibilityError`;
- `PluginDependencyError`;
- `PluginConfigError`;
- `PluginPermissionError`;
- `PluginLifecycleError`;
- `PluginCommandError`;
- `PluginHookTimeoutError`.
- `MpvUnavailableError`;
- `MpvOperationError`.

Cada error incluye `code`, `pluginId`, `phase`, `recoverable` y `cause` sólo para logging local. Los mensajes de usuario no deben incluir stack ni rutas locales.

## Compatibilidad de paquetes

- `@noir-player/plugin-api` usa SemVer y declara su API pública.
- Plugins externos declaran `@noir-player/plugin-api` y `react`/`react-dom` como `peerDependencies` cuando aportan UI; no empaquetan una segunda copia de React.
- El paquete first-party no puede importar `src/App`, `src/player/*` internos, runtime, `tauri-plugin-libmpv-api` ni APIs Tauri. Si necesita mpv, consume `context.mpv` y declara/grants capabilities. Un lint rule/test de arquitectura debe hacerlo cumplir.
- Los tipos públicos deben pasar un test de consumo desde un paquete fixture ajeno al host.
