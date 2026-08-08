# UI slots, comandos y servicios

## Slots UI obligatorios

Declarar nombres estables y documentados. La implementación inicial debe cubrir al menos:

| Slot | Zona actual de Noir Player | Uso |
|---|---|---|
| `app.header.actions` | `.header-actions` | Acciones globales. |
| `app.hero.actions` | `.hero-actions` | Acciones sin medio. |
| `stage.info` | `.chip-row` | Chips/estado del medio. |
| `stage.actions` | `.stage-actions` | Acciones sobre el medio. |
| `player.before-media` | antes del host de video | Capas inferiores controladas; no acceso a child surface. |
| `player.overlay` | dentro de `.player-frame` en la capa WebView | Overlay visual con pointer policy, compatible con libmpv y fallback. |
| `player.controls.left` | barra de controles host | Botones accesibles tanto con libmpv como con Plyr. |
| `player.controls.right` | barra de controles host | Botones accesibles tanto con libmpv como con Plyr. |
| `player.dock` | `.floating-dock` | Acciones compactas. |
| `panel.tabs` | `.panel-tabs` | Tabs aportadas. |
| `panel.content` | body de tab de plugin | Contenido exclusivo por tab. |
| `settings.sections` | `.settings-container` | Config del plugin. |
| `notifications` | viewport de toast/status | Avisos no destructivos. |

La capa React de controles/overlays debe convivir con la superficie libmpv embebida, transparencia, margin ratio, redraw, cover/fade de fullscreen, auto-hide, teclado y el fallback Plyr. Los slots se montan en contenedores host de la WebView; no se promete estabilidad de clases `.plyr__*`, elementos del plugin libmpv ni geometría interna. `NativeSurfaceCoordinator` conserva la autoridad sobre z-order/márgenes y los plugins no reciben sus handles.

## Descriptor de contribución

```ts
export interface UiContribution<TProps = PluginSlotProps> {
  readonly id: `${PluginId}/${string}`;
  readonly slot: PluginSlotName;
  readonly order?: number;
  readonly component: React.ComponentType<TProps>;
  readonly when?: (snapshot: Readonly<PlayerSnapshot>) => boolean;
  readonly ariaLabel?: string;
}

interface PluginUiRegistry {
  contribute(contribution: UiContribution): Disposable;
}
```

Orden: `order` ascendente, después `pluginId`, después ID de contribución. Duplicados fallan, no sobrescriben. Cada contribución se renderiza con error boundary, theme tokens/CSS variables del host y props mínimas. No aceptar HTML string. HTML de terceros sólo por un componente que lo sanee explícitamente.

Requisitos de accesibilidad: navegación por teclado, foco visible, `aria-label` traducible, tooltips no exclusivos, contraste y ausencia de traps. Al retirar un control con foco, devolver foco a un destino host razonable.

## Command bus

Core y UI existente deben usar el mismo bus que se expone a plugins. Catálogo mínimo, con inputs/outputs exactos en un `CommandMap`:

- `media.open` (ruta/archivo sólo mediante tipo autorizado);
- `media.play`, `media.pause`, `media.toggle`;
- `media.seekTo`, `media.seekBy`;
- `media.setRate`, `media.setVolume`, `media.setMuted`;
- `media.retryWithFallback` (acción host segura; no acepta backend o comandos arbitrarios);
- `fullscreen.enter`, `fullscreen.exit`, `fullscreen.toggle`;
- `subtitle.open`, `subtitle.selectEmbedded`, `subtitle.clear`;
- `subtitle.setOffset`, `subtitle.export`;
- `playlist.refresh`, `playlist.play`, `playlist.next`, `playlist.previous`;
- `panel.open`, `panel.close`;
- `notice.show`.

```ts
interface PluginCommandBus {
  execute<K extends keyof HostCommandMap>(
    command: K,
    input: HostCommandMap[K]['input'],
    options?: { signal?: AbortSignal },
  ): Promise<HostCommandMap[K]['output']>;

  register<K extends `${PluginId}.${string}`>(
    command: K,
    handler: PluginCommandHandler,
  ): Disposable;
}
```

Los comandos aportados son namespaced, descubiertos por ID y pueden usarse en shortcuts/UI/otros plugins. Colisiones, input inválido, falta de capability, timeout y ejecución tras dispose deben fallar de forma determinista.

Syncplay, controles libmpv, Plyr y UI core deben delegar `open/play/pause/seek/rate/volume` al command bus preservando la semántica de estados pendientes. Los plugins portables también DEBERÍAN usarlo. Un plugin con `native.mpv.raw` PUEDE llamar `context.mpv.command`/`setProperty` deliberadamente para operaciones específicas de mpv; el runtime registra esa ruta y el autor acepta que puede competir con el core. Importar `mpvCommand` directamente, usar `<video>` interno o invocar fullscreen de ventana sigue fuera del contrato.

## Servicios

Usar tokens nominales tipados, no un objeto global de strings mutables:

```ts
export interface ServiceToken<T> {
  readonly id: `${PluginId | 'noir.core'}/${string}`;
  readonly version: string;
}

interface PluginServiceRegistry {
  provide<T>(token: ServiceToken<T>, value: T): Disposable;
  get<T>(token: ServiceToken<T>, range?: string): T;
  optional<T>(token: ServiceToken<T>, range?: string): T | undefined;
}
```

Servicios base sugeridos:

- logger estructurado;
- storage namespaced/transaccional básico;
- i18n namespaced;
- telemetría local/opt-in;
- scheduler/timers ligados al resource scope;
- selector de archivos mediado;
- native media metadata de sólo lectura;
- playback engine diagnostics normalizados de sólo lectura (`engine`, status, capabilities, fallback reason redactado);
- `MpvPluginFacade` brokered para lectura o control raw cuando se conceden `native.mpv.read`/`native.mpv.raw`.
- theme tokens.

Servicios de plugin declaran versión y dependencia. No exponer `window.localStorage` como contrato: `PluginStorage` prefija `noir-player:plugin:<id>:` y soporta `get/set/remove`, schema version y migración. Cuotas/tamaño y errores deben documentarse.

## Configuración UI del plugin

Un plugin puede aportar una sección React a `settings.sections`. Los datos se escriben a través del config store validado, no directamente a storage. Cambios inválidos no alcanzan `onConfigChange`; cambios válidos son atómicos y reversibles si el lifecycle falla.

Traducciones se registran como `pluginId` + locale, con fallback al inglés y aviso por clave faltante. Un plugin no puede sobrescribir mensajes core ni de otro plugin.
