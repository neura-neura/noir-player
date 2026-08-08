# Pruebas, CI, migración y documentación del producto

## Infraestructura de calidad a crear

El repo no tiene tests ni CI y su ESLint apunta a Next.js inexistente. La implementación DEBE añadir y mantener:

- `npm run typecheck`: TypeScript del host y workspaces/fixtures;
- `npm run lint`: configuración actual compatible con React 18, hooks y TypeScript; eliminar la config Next obsoleta;
- `npm run test`: unit/integration/component tests sin watch;
- `npm run test:coverage`: cobertura útil con thresholds razonados, no 100 % artificial;
- `npm run test:e2e`: browser preview y, si es viable estable, smoke Tauri;
- `npm run build`: Vite production;
- `npm run check`: typecheck + lint + test + build y checks de paquetes;
- checks Rust: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` y `cargo test` (ajustar sólo con justificación de warnings baseline).

Elegir herramientas mantenidas compatibles con Vite 8/React 18 (por ejemplo Vitest + Testing Library y Playwright), verificar documentación oficial/versiones actuales y fijar lockfile. No añadir un framework grande sin necesidad.

## Matriz mínima de pruebas

### SDK/contrato

- manifest/ID/config helpers y errores;
- type fixture de plugin externo compila sólo con exports públicos;
- imports prohibidos a internals fallan en lint/test de arquitectura;
- paquete no accede a DOM/Tauri/libmpv al importarse en Node.

### Loader/compatibilidad

- seleccionado vs disabled/no seleccionado;
- loader lazy invocado una vez;
- módulo/export/manifest inválido;
- ID distinto, grants inválidos;
- ranges API/app/plugin/service compatibles e incompatibles;
- required/optional, orden topológico y ciclo;
- error/timeout de chunk con core operativo.

### Lifecycle/cleanup

- orden exacto setup/start/stop/dispose;
- teardown inverso entre dependencias;
- idempotencia y React StrictMode/HMR;
- AbortSignal antes de stop;
- cleanup aunque cada fase lance;
- cero listeners/timers/comandos/slots después de ciclos repetidos.

### Eventos/hooks/comandos/servicios

- payload/orden/sessionId y descarte de resultado stale;
- selección de engine, evento `media:engine-changed` y continuidad de comandos/snapshot al pasar de libmpv a fallback;
- coalescing de time update;
- hook allow/cancel/replace, orden, timeout, error y reentrada;
- comando input/output/capability/error/abort;
- servicio versionado, colisión y desaparición;
- Syncplay delega a comandos core sin regresión de pending state.

### UI

- orden/condición de slots;
- error boundary por contribución;
- alta/baja dinámica sin foco roto;
- navegación teclado/ARIA y locale fallback;
- fullscreen/panel/dock con y sin plugins;
- controles/overlay/captions con superficie libmpv lista, cargando, fallida y durante cover/fade de fullscreen;
- ninguna dependencia de selectores DOM privados de Plyr, handles/márgenes del child surface o elementos internos libmpv.

### Seguridad

- capability denegada en runtime;
- manifest no puede auto-concederse trust/grants;
- logs/telemetría redactan ruta/nombre/texto de subtitles;
- no loader remoto/eval;
- Tauri deniega comandos/permisos fuera de ACL prevista;
- `native.mpv.read` permite get/observe/listen pero niega command/set; `native.mpv.raw` permite nombres arbitrarios sólo con grant + risk acknowledgement;
- facade mpv rechaza valores no serializables/excesivos, operaciones tras dispose o durante fallback; registra/redacta auditoría y limpia observers/listeners;
- imports directos de `tauri-plugin-libmpv-api` desde plugins fallan en lint/test de arquitectura;
- setup/staging de DLLs usa versión/origen/integridad documentados y no descarga “latest” silenciosamente en un job de release;
- CSP permite sólo recursos documentados y bloquea caso no permitido de prueba.

### Plugin first-party E2E

1. Arrancar sin selección: reproductor base funciona y no hay chunk/CSS/registro del plugin.
2. Arrancar seleccionado: chunk se carga, chip/botón aparecen en orden.
3. Abrir fixture de video, play/pause/seek/rate: stats se actualizan al ritmo configurado.
4. En Tauri, ejecutar el recorrido con libmpv; forzar init/load failure y repetir sobre FFmpeg/browser conservando el contrato público.
5. Ejecutar play/pause desde el plugin y comprobar command bus/eventos.
6. Cambiar setting, recargar y comprobar persistencia/migración.
7. Deshabilitar/detener y comprobar que UI/listeners/timer/comando desaparecen.
8. Inyectar fallo de test y comprobar que video/core siguen operativos.
9. Ejecutar el fixture `mpv-lab`: denegado sin grants; con raw grant lee property, observa event, ejecuta comando/escritura controlados y limpia todo. Forzar fallback y comprobar `MpvUnavailableError`.

## Pruebas de regresión del producto

Caracterizar y probar, según capa:

- abrir archivo por picker, ruta inicial, segunda instancia y drag/drop;
- libmpv init/load/file-loaded/end-file, observed properties, stop/destroy y ausencia de listeners tardíos;
- controles nativos play/pause/seek/volume/mute/fullscreen, auto-hide y persistencia de volumen;
- margen/redraw/background transparente durante resize, panel y transiciones fullscreen;
- fallo de libmpv y preparación FFmpeg/browser según codec/pix_fmt/bit depth;
- `.ts/.m2ts` mediante HLS loopback y recuperación Hls en el fallback;
- audio embebido/fallback externo y sincronización;
- SRT/VTT/ASS/SSA/ZIP, track embebido, offset, estilo y exportación;
- playlist/next/repeat y preservación de volume/mute/rate;
- preferencias/locales/fonts/panel/fullscreen;
- Syncplay health/status/open/play/pause/seek/rate;
- browser preview degradado sin Tauri.

Donde Tauri/libmpv/FFmpeg sea difícil de automatizar, usar engines/bridges fake en integración más un smoke Windows real documentado. No sustituir todo por mocks sin probar init/load/events/surface/fallback reales.

## CI

Crear workflows bajo `.github/workflows/`:

- job frontend reproducible con `npm ci` y `npm run check`;
- job Rust/Tauri en Windows para fmt/clippy/test/check; preparar FFmpeg/libmpv sólo si es imprescindible y con versión, fuente, hash y cache verificables, nunca subir binarios grandes al repo ni depender de un artefacto “latest” mutable;
- E2E browser headless con artifacts de fallo;
- cache con claves de lockfiles, no cachear resultados como éxito;
- concurrency/cancel de runs obsoletos;
- build/artefacto sólo después de checks.

Los workflows deben ejecutar los mismos scripts locales. No introducir secrets para tests normales.

## Plan de migración verificable

1. **Baseline y caracterización.** Documentar fallos existentes, añadir test runner/scripts sin cambiar behavior.
2. **Adapters.** `NativeBridge`, `NativeSurfaceCoordinator` y fakes; reemplazar `invoke/listen`, window/webview y llamadas libmpv dispersas.
3. **Engines.** Introducir `PlaybackEngine`, adaptadores libmpv/browser, `MpvPluginFacade` brokered y resolver/fallback sin cambiar comportamiento.
4. **Core.** Snapshot/store/command bus; migrar verticalmente play/pause/seek/open/rate/volume/fullscreen y Syncplay sobre ambos engines.
5. **Eventos/hooks.** Traducir events/properties mpv y listeners DOM, session IDs y hooks mínimos.
6. **UI.** Extraer componentes de `App`, provider y slots sin cambiar apariencia/flujo nativo o fallback.
7. **SDK/runtime.** Paquete API, loader, compat/deps/lifecycle/errors.
8. **Dogfood.** Paquete playback-stats, config lazy, settings y E2E en ambos engines.
9. **Hardening.** Tauri/libmpv ACL, CSP, DLL supply chain, redaction, performance/bundle, CI/docs.
10. **Limpieza.** Eliminar caminos duplicados, restos Next y APIs internas ya reemplazadas.

En cada fase: typecheck/lint/tests/build; en hitos de bridge/security, Rust y smoke Tauri.

## Documentación que debe actualizarse

- `README.md`: arquitectura real, plugins, instalación, scripts y árbol correcto (`noir-player`, no `simplevideoplayer`).
- `.github/copilot-instructions.md`: reescribir para Tauri 2 + React/Vite actual, comandos reales, módulos nuevos, validación y seguridad. No parchear sólo nombres sobre texto Next.
- `docs/architecture/plugin-system-decisions.md`/ADRs.
- `docs/plugins/*` descritos en `10`.
- catálogo generado o manual de API pública con eventos/hooks/comandos/slots/services.
- política de compatibilidad/deprecación y changelog del SDK.
- threat model y límites explícitos de aislamiento.
- instrucciones de prueba manual Tauri/libmpv/FFmpeg/Syncplay, incluido `setup-lib`, fallback y fullscreen/surface.

La documentación debe coincidir con nombres/types finales y contener ejemplos ejecutados por CI cuando sea práctico.
