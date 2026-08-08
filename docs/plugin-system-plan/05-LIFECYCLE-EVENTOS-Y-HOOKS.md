# Lifecycle, eventos y hooks

## Lifecycle del plugin

El runtime DEBE aplicar estas semánticas:

1. **load**: invocar el import dinámico una sola vez por selección activa.
2. **validate**: validar export, manifest, compatibilidad, dependencias, grants y config antes de ejecutar código de setup.
3. **setup**: crear registros/servicios/contribuciones dentro de un resource scope. No asumir que el DOM del player ya existe.
4. **start**: el host y los slots ya están disponibles. Al resolver, estado `active`.
5. **onConfigChange**: sólo con config nueva validada; si falla, conservar la anterior y reportar.
6. **stop**: abortar `context.signal`, dejar de reaccionar y retirar contribuciones en orden inverso.
7. **dispose**: liberar recursos propios finales. El scope del host se limpia aunque el plugin falle.

`stop` y `dispose` deben ser idempotentes. En shutdown/dependencias se procesan plugins en orden topológico inverso. React StrictMode no puede duplicar registro, listeners, comandos o UI. HMR/desarrollo debe descargar la instancia anterior antes de crear otra.

No existe callback de plugin obligatorio por cada frame; usar eventos coalescidos/snapshots.

## Catálogo mínimo de eventos

Eventos son notificaciones posteriores al hecho y NO pueden cancelarlo. Todos llevan `timestamp`, `revision`, `sessionId` cuando aplique y payload readonly.

| Evento | Payload mínimo | Nota |
|---|---|---|
| `host:ready` | versión app/API, platform | Una vez por runtime. |
| `host:disposing` | motivo | Antes de parar plugins. |
| `plugin:state-changed` | id, from, to | Diagnóstico; evita recursión. |
| `media:opening` | sessionId, displayName, kind | Sin ruta salvo grant. |
| `media:engine-changed` | previous/next engine, reason | Incluye selección inicial y fallback, sin detalles nativos sensibles. |
| `media:source-changed` | media pública | Tras resolver/adaptar fuente. |
| `media:loaded-metadata` | duration, dimensions | Antes de `ready`. |
| `media:ready` | snapshot media | Adaptadores/subtítulos listos. |
| `media:play` / `media:pause` | currentTime | Refleja evento real del medio. |
| `media:time-update` | currentTime, duration | Coalescer por defecto a <= 4 Hz para plugins. |
| `media:seeking` / `media:seeked` | from/to | Correlacionado con sessionId. |
| `media:rate-change` | rate | Sólo valor validado. |
| `media:volume-change` | volume, muted | Sin acceso a nodos WebAudio. |
| `media:ended` | currentTime | Antes de ejecutar acción final siguiente. |
| `media:error` | error público normalizado | Sin stack/ruta en payload. |
| `subtitle:track-changed` | metadata/none | Externo o embebido. |
| `subtitle:cue-changed` | índice y cue pública/none | HTML ya saneado o texto seguro. |
| `subtitle:offset-changed` | offsetMs | Cambio efectivo. |
| `subtitle:style-changed` | snapshot de estilo | No objeto React mutable. |
| `playlist:changed` | items públicos, activeId | IDs estables. |
| `playlist:item-changed` | previous/next | Tras abrir. |
| `ui:panel-changed` | visible, tab | Incluye tabs de plugins por ID. |
| `ui:fullscreen-changed` | fullscreen | Estado efectivo. |
| `ui:playback-controls-visibility-changed` | visible | Auto-hide efectivo para slots de controles. |
| `i18n:locale-changed` | locale | Para recomputar labels. |

El bus ofrece `on`, `once` y retorno `unsubscribe`. No debe usar strings libres fuera del mapa extensible namespaced. Un plugin puede emitir `pluginId:event-name`; el host rechaza eventos core falsificados.

## Hooks públicos

Hooks se ejecutan antes de una operación y pueden permitir, cancelar o transformar un valor. La v1 debe implementar sólo seams usados/probados:

| Hook | Entrada | Resultado permitido |
|---|---|---|
| `media:before-open` | solicitud de apertura sanitizada | allow, cancel o replace request |
| `media:resolve-source` | source candidato | continue o replace source |
| `media:before-play` | snapshot | allow/cancel |
| `media:before-seek` | from/to | allow/cancel/replace target |
| `subtitle:before-load` | metadata + contenido cuando autorizado | allow/cancel/replace fuente |
| `subtitle:after-parse` | track readonly | keep/replace track validado |
| `player:select-engine` | motores host disponibles + solicitud sanitizada | keep o preferir un engine ID disponible |
| `player:configure-engine` | engine ID + opciones públicas allowlisted | patch validado antes de init/load |

`player:select-engine` nunca permite aportar una DLL, URL de script o implementación arbitraria. `player:configure-engine` sigue siendo la ruta portable y validada. Para control específico de mpv no se fuerza a esperar un DTO: un plugin con `native.mpv.read`/`native.mpv.raw` usa `context.mpv` para observar events/properties o ejecutar nombres arbitrarios. Esa ruta es explícitamente no portable y queda fuera de las garantías SemVer de cada comando de mpv.

No crear hooks “por si acaso”. Documentar cómo añadir uno sin romper SemVer.

## Pipeline y orden

- Resolver dependencias primero; después `selection.priority` ascendente; empate por `pluginId` lexical.
- Cada hook recibe `AbortSignal`, deadline y contexto de correlación.
- Ejecución serial por defecto para transformaciones deterministas.
- Timeout por callback (valor inicial recomendado: 2 s en operaciones interactivas, configurable por host, nunca por el propio plugin por encima del máximo).
- Excepción/timeout se registra y se aplica la política declarada del hook: fail-open para adornos, fail-closed para validación de seguridad. La tabla de política debe vivir en código y tener tests.
- Cancelación devuelve razón pública y no simula un error del medio.
- Detectar reentrada del mismo comando/hook y rechazar ciclos con error tipado.
- Resultados se validan al cruzar de nuevo al core.

## Orden de eventos de referencia

Una apertura exitosa debe poder probarse así:

```text
command media.open
  -> hook media:before-open
  -> event media:opening (nuevo sessionId)
  -> hook media:resolve-source
  -> hook player:select-engine
  -> event media:engine-changed
  -> event media:source-changed
  -> event media:loaded-metadata
  -> event media:ready
  -> play/pause efectivo según preferencias/comando
```

Al abrir otro archivo, abortar primero las tareas del sessionId anterior; observers/listeners tardíos de libmpv, fallback FFmpeg, margin/redraw, fonts, playlist o tracks no pueden modificar la sesión nueva. Un fallo de libmpv que conserva el mismo medio puede cambiar de engine dentro de la sesión, pero debe cancelar el engine anterior antes de publicar el fallback como listo.
