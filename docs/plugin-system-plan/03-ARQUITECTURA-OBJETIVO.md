# Arquitectura objetivo ajustada a Noir Player

## Estructura propuesta

Los nombres pueden variar con un ADR, pero las fronteras no:

```text
noir-player/
├─ noir.plugins.config.ts             selección y loaders literales
├─ packages/
│  ├─ plugin-api/                     @noir-player/plugin-api
│  ├─ plugin-test-utils/              host fake y harness de contrato
│  └─ plugin-playback-stats/          plugin first-party independiente
├─ src/
│  ├─ app/                            composición React y bootstrap
│  ├─ player/
│  │  ├─ core/                        store, snapshots, commands, eventos
│  │  ├─ engines/                     contrato + libmpv/browser/Hls/fallback
│  │  ├─ adapters/                    Tauri, ventana/superficie, storage
│  │  ├─ subtitles/                   fachada sobre lib/subtitles
│  │  └─ ui/                          componentes extraídos de App
│  ├─ plugins/
│  │  ├─ runtime/                     loader, registry, lifecycle, compat
│  │  └─ ui/                          PluginProvider, PluginSlot, boundaries
│  └─ i18n/
├─ src-tauri/
│  ├─ capabilities/                   permisos revisados
│  ├─ permissions/                    si se restringen comandos propios
│  └─ src/                            módulos nativos separados por dominio
└─ docs/
   ├─ architecture/plugin-system-decisions.md
   └─ plugins/                        autoría, API, seguridad y ejemplo
```

No se exige convertir todo el repo en monorepo complejo. Sí se exige que `plugin-api` y el plugin de ejemplo tengan `package.json` propio, límites de import comprobables y verificación independiente.

## Capas y propiedad

### Player core

Es la única autoridad sobre `PlayerSnapshot` y comandos core. No importa React, libmpv, Plyr, Hls ni Tauri. Modela sesión/media actuales con un `sessionId` monotónico para descartar async stale. Publica snapshots inmutables y un bus tipado. El cambio `libmpv -> fallback browser` conserva el mismo `sessionId` cuando sigue siendo el mismo medio, pero incrementa la revisión y emite un cambio de motor correlacionado.

### Motores y adaptadores

- `PlaybackEngine`: contrato host para `load/play/pause/seek/rate/volume/mute/stop/dispose`, snapshot de capacidades y eventos normalizados. No expone objetos del backend.
- `LibmpvPlaybackEngine`: encapsula `init/destroy`, `command`, `get/setProperty`, observers/listeners y file URLs de `tauri-plugin-libmpv-api`. Traduce properties/events a dominio, libera unlisten/instancia una vez y actúa como broker de `MpvPluginFacade` para scopes autorizados.
- `BrowserPlaybackEngine`: envuelve `<video>`, Plyr, Hls y audio externo; traduce eventos DOM y limpia listeners.
- `PlaybackResolver`: en desktop prefiere libmpv; ante init/load failure usa `prepare_video_playback_source` y el motor browser/Hls sin crear una autoridad paralela.
- `NativeSurfaceCoordinator`: único dueño de `setVideoMarginRatio`, redraw, ventana transparente, resize, cover/fade de transición y fullscreen nativo. No forma parte del SDK.
- `NativeBridge`: encapsula los demás `invoke/listen`, window/webview APIs, tipa argumentos/resultados y ofrece implementación browser/fake.
- `StorageAdapter`: preferencias core y storage namespaced de plugins.
- Adaptadores de subtitles/playlist: encapsulan parseo, selección, extracción y carpeta.

No se debe poner `HTMLMediaElement`, instancia mpv o `AppHandle` en el snapshot público. Las properties/events/comandos mpv se obtienen mediante `MpvPluginFacade` y capabilities explícitas, no dentro del snapshot. El acceso DOM excepcional exige capability inestable y no concede por sí mismo control de la superficie nativa.

### Plugin runtime

Mantiene registros por `pluginId`, resuelve dependencias, valida manifest/config/ranges, crea un scope de recursos por plugin, carga módulos, invoca lifecycle y publica diagnósticos. No renderiza UI directamente.

Estado mínimo por plugin:

```text
selected -> loading -> validated -> setup -> starting -> active
                                      |          |         |
                                      +------ failed <------+
active -> stopping -> stopped -> disposed
```

Los estados inválidos y las transiciones dobles deben lanzar errores internos tipados y tener tests. `dispose` es terminal e idempotente.

### Plugin UI host

Un provider conecta runtime y React. `PluginSlot` obtiene contribuciones por nombre, aplica `order`, renderiza una key estable y envuelve cada contribución en su propio error boundary. El core conserva UI funcional si el slot está vacío o falla.

### SDK

Contiene sólo tipos, helpers puros (`definePlugin`, tokens/IDs, guards) y constantes de API. No conoce rutas del repo, no llama a Tauri y no crea singletons globales de runtime.

## Flujo de arranque

1. Crear `PlaybackResolver`, motores/adaptadores y player core sin plugins.
2. Crear runtime con versión de API y servicios base.
3. Leer la selección compilada; no ejecutar loaders ausentes/deshabilitados.
4. Cargar manifests/módulos elegidos de forma diferida.
5. Validar ID, schema, API/app/platform, dependencias, grants y config.
6. Ejecutar `setup` en orden topológico/determinista dentro de un resource scope.
7. Montar React/provider y declarar los slots host.
8. Ejecutar `start`; publicar `plugin:active` sólo al completarse.
9. Abrir medios mediante comandos del core. El resolver selecciona motor y puede degradar a fallback; eventos/hook pipeline alcanzan plugins activos con payload normalizado.
10. Al deshabilitar/salir: abortar trabajo, `stop` en reversa, limpiar scope, `dispose` una vez.

El arranque del reproductor no debe esperar indefinidamente a un plugin. Aplicar timeouts configurables y continuar degradado.

## Flujo de una acción

Para `media.play`:

```text
UI/Syncplay/plugin -> CommandBus -> hook media.beforePlay -> Player core
                  -> PlaybackEngine activo -> evento normalizado media.play
                  -> snapshot -> React/plugins
```

Syncplay debe usar comandos core, no mutar el `<video>` ni llamar mpv por una ruta paralela. De igual forma, controles nativos, Plyr y la UI existente deben migrar a esos comandos para que el contrato probado sea el que realmente usa el producto.

## Refactor incremental obligatorio

1. Añadir pruebas de caracterización de libmpv, fallback, fullscreen/surface y browser preview.
2. Extraer `NativeBridge`/`NativeSurfaceCoordinator` y reemplazar invocaciones/API mpv dispersas sin cambiar UI.
3. Extraer `PlaybackEngine`, implementar adaptadores libmpv/browser y mover la selección/fallback actual detrás del resolver.
4. Extraer snapshot/command bus y probar play/pause/seek/open/rate/volume/fullscreen sobre ambos motores.
5. Extraer bridge de eventos/lifecycle del medio y normalizar eventos mpv/DOM.
6. Dividir componentes visuales y declarar slots en zonas existentes, incluidos controles/overlay compatibles con superficie nativa.
7. Conectar plugin runtime con un plugin de prueba en memoria.
8. Conectar el paquete first-party real por loader dinámico.
9. Eliminar caminos duplicados y reducir `App.tsx` a composición razonable.

Cada paso debe compilar y tener tests. No fijar un límite arbitrario de líneas, pero `App.tsx` no puede seguir siendo la API implícita del reproductor.
