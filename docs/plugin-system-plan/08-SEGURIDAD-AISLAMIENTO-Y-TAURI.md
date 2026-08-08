# Seguridad, aislamiento y modelo de confianza

## Verdad del aislamiento

Un plugin JavaScript importado en el mismo WebView comparte origen, DOM y proceso JS con la app. Las fachadas y capabilities del runtime reducen acoplamiento y accidentes, pero **no contienen código malicioso**: ese código puede intentar usar `fetch`, DOM o imports Tauri directamente si el bundle/capabilities lo permiten.

Por eso la v1 sólo admite código first-party, curated o third-party revisado y fijado en lockfile. La UI y documentación NO DEBEN usar expresiones como “sandboxed” o “seguro para plugins no confiables”.

Las capabilities del runtime —incluidas `native.mpv.read` y `native.mpv.raw`— son un contrato cooperativo y auditable. No impiden que JavaScript hostil empaquetado en el mismo WebView intente importar la API Tauri/libmpv o acceder al DOM por fuera de la fachada. Lint, límites de imports y grants protegen estabilidad/accidentes y hacen visible la intención; el límite de seguridad real sigue siendo revisar el plugin antes de seleccionarlo.

## Fronteras de confianza

| Actor | Confianza v1 | Control |
|---|---|---|
| Core/first-party | Alta, revisión normal | Tests, lint, lockfile, code review. |
| Plugin curated | Revisado explícitamente | Version fija/range prudente, grants mínimos, auditoría. |
| Third-party npm | No por defecto | No se selecciona hasta revisión. |
| JS remoto/ZIP/directorio | No confiable | Prohibido; no loader. |
| Plugin nativo Rust | Máxima superficie | Dependencia compilada, ACL Tauri, revisión específica. |
| Medio/subtítulo/manifest de video | Datos no confiables | Parsers, límites, DOMPurify, libmpv/FFmpeg aislados del API plugin. |
| DLLs/libmpv wrapper | Código nativo de alta confianza | Versión/procedencia/licencia/integridad, staging reproducible y review. |

El manifest sólo declara `requestedCapabilities`. El archivo de selección controlado por la app concede `grants` y clasifica `trust`. Rechazar grants no solicitados y advertir solicitudes no concedidas.

## Capabilities del runtime

- `player.read`: snapshots/eventos públicos.
- `player.control`: comandos de playback.
- `ui.contribute`: slots nominales.
- `commands.contribute`, `services.consume`, `services.provide`.
- `storage`: namespace propio, sin secretos.
- `telemetry`: sólo sink host con política de privacidad.
- `network`: servicio mediado con allowlist/timeout; no es barrera contra código hostil.
- `native.media-read`: sólo metadatos de medio necesarios y tipados; no `command/getProperty/setProperty` de mpv.
- `native.mpv.read`: `isAvailable`, `getProperty`, observers y events mpv mediante broker. Puede revelar metadata/rutas dependiendo de la property elegida.
- `native.mpv.raw`: incluye lectura y permite `command`/`setProperty` con nombres arbitrarios. Requiere risk acknowledgement y equivale a confiar en que el plugin puede alterar, reemplazar o romper la reproducción.
- `unsafe.dom`: escape hatch inestable, visible en diagnóstico y no concedido por defecto.

Toda llamada se comprueba en runtime, se registra y tiene tests negativos. No usar sólo tipos como autorización. Para `native.mpv.raw` el control es el grant, no una allowlist de operaciones: una vez concedido, el broker transporta cualquier nombre mpv serializable. Debe quedar visible en diagnósticos y documentación de instalación.

## Auditoría Tauri obligatoria

El estado actual tiene `csp: null`, asset protocol con `scope: ['**']`, `libmpv:default` concedido al WebView `main` y comandos propios expuestos por defecto. Luna Max DEBE:

1. inventariar comandos, argumentos, efectos, rutas y datos devueltos;
2. encapsularlos en `NativeBridge`; encapsular además `tauri-plugin-libmpv-api` en `LibmpvPlaybackEngine`/`NativeSurfaceCoordinator`. Proyectar desde ahí `MpvPluginFacade`: raw commands/properties sí para plugins autorizados; `invoke`, init/destroy, instancia interna y video margins/handles no;
3. estudiar `AppManifest::commands`, permissions y capabilities de Tauri 2 para limitar comandos propios cuando sea viable;
4. mantener capabilities por ventana/plataforma con mínimo privilegio y evaluar si `libmpv:default` puede sustituirse por permisos más estrechos. No afirmar que una capability separa plugins JS que comparten `main`;
5. evaluar y activar una CSP explícita compatible con assets locales, `blob:`, HLS loopback, Vite dev y el caso existente de CSS de fuentes;
6. evaluar si `assetProtocol.scope` puede acotarse. La apertura de videos elegidos en ubicaciones arbitrarias puede requerir una excepción amplia: si se conserva, documentar riesgo y mitigaciones;
7. probar que `dialog`, window state, show/fullscreen, transparencia, libmpv init/load/observe/command/destroy, margin/redraw, `convertFileSrc`, audio extraído y subtitles siguen funcionando;
8. no dar acceso remoto a comandos Tauri;
9. no ampliar CORS/escucha de Syncplay. El servidor debe seguir loopback-only.
10. auditar `setup-lib`, `libmpv-wrapper` y `libmpv-2.dll`: origen, arquitectura, hashes/versión, licencia MPL/LGPL aplicable, actualización y empaquetado. No confiar ciegamente en “latest” durante CI/release.

No copies una CSP de ejemplo sin probar esquemas reales de Tauri 2. Registra directivas/excepciones y por qué existen. Fuentes CSS remotas son una superficie existente: preferir allowlist/config explícita, validar `https`, limitar tamaño/timeout y evitar que esta compatibilidad permita plugins remotos.

## Datos y privacidad

- Rutas locales, nombres de archivo, texto de subtítulos, playlist y URL de fuente son sensibles.
- Snapshots/eventos generales usan display name cuando sea necesario, no ruta completa.
- Storage/telemetría de plugins no almacena secretos ni contenido de medios por defecto.
- Logs exportados deben redactar rutas y query strings/tokens.
- Telemetría remota, si se añade, es opt-in y documenta payload, retención y destino. La v1 puede limitarse a métricas locales.
- Errores mostrados al usuario no incluyen stack, argumentos FFmpeg/mpv completos, properties ni paths.

## Recursos no confiables

- Conservar DOMPurify/allowlist para cues; ningún plugin puede desactivar sanitización global sin capacidad unsafe y ADR.
- Validar límites de config/manifest, número/tamaño de contribuciones y payloads de eventos.
- Aplicar timeout/abort a imports, hooks, red y lifecycle.
- Evitar `eval`, `new Function`, scripts inline generados y HTML string de plugin.
- No permitir que IDs controlen rutas de filesystem o nombres de comandos Tauri sin normalización.
- No ejecutar automáticamente nombres de properties/comandos mpv provenientes sólo de manifest/config. El código activo de un plugin con `native.mpv.raw` sí puede pasarlos deliberadamente a la fachada; validar serialización/tamaño/scope y registrar la operación, sin allowlist semántica.
- Fijar dependencias con lockfile y ejecutar auditoría de supply chain proporcionada al proyecto; no aceptar automáticamente un paquete por declarar licencia o trust.

## Aislamiento futuro para plugins no confiables

Si el producto necesita terceros sin revisión, crear otro diseño: Worker, iframe/webview dedicado o proceso sidecar con RPC serializable, capability broker y UI declarativa limitada. `unsafe.dom` y componentes React directos no cruzan esa frontera. Esta posibilidad futura justifica que eventos/comandos/servicios actuales usen datos serializables, pero NO forma parte de la v1.

## Checklist de amenaza por plugin

Antes de seleccionar un plugin externo:

- procedencia, mantenedor, licencia y versión fijada;
- scripts de instalación/transitivos;
- imports Tauri, DOM global, red y filesystem;
- capabilities solicitadas vs concedidas;
- datos que lee/persiste/emite;
- comportamiento al fallar/timeout/dispose;
- peso de bundle y segunda copia de React;
- resultado de tests y revisión manual.
