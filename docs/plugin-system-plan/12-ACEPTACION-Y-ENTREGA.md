# Criterios de aceptación y checklist de entrega

No marcar un punto por intención. Cada check requiere código, prueba o evidencia reproducible.

## Arquitectura y contrato

- [ ] Noir Player arranca y reproduce sin plugins.
- [ ] `App.tsx` ya no es la API implícita: core, adaptadores y composición UI tienen fronteras explícitas.
- [ ] `@noir-player/plugin-api` tiene package/exports/types propios y no importa internals/Tauri/libmpv/Plyr/Hls.
- [ ] Manifest, selección, config parser, context, instance y errores implementan las garantías de `04`.
- [ ] `NOIR_PLUGIN_API_VERSION` y política SemVer están documentados y probados.
- [ ] Un fixture externo compila contra exports públicos; imports internos están bloqueados.

## Runtime y modularidad

- [ ] Selecciones usan loaders dinámicos literales y validación previa a setup.
- [ ] Plugin ausente/no seleccionado no se ejecuta; plugin diferido no está en el chunk inicial.
- [ ] `npm run build` muestra el first-party en chunk propio, sin React duplicado.
- [ ] Dependencias, optional, ciclos, priority y orden determinista están implementados/probados.
- [ ] Lifecycle y teardown inverso/idempotente funcionan también ante excepciones y StrictMode.
- [ ] Config fusionada/validada/persistida y migraciones fallan de forma recuperable.

## Extensibilidad real

- [ ] Snapshot y subscriptions no exponen mutabilidad/DOM/rutas sin autorización.
- [ ] `sourceKind` y `engine` son conceptos separados; comandos/eventos/snapshot permanecen coherentes al cambiar de libmpv a fallback.
- [ ] `PlaybackEngine`, adaptadores libmpv/browser, resolver y `NativeSurfaceCoordinator` tienen fronteras y cleanup probados.
- [ ] `MpvPluginFacade` permite lectura con `native.mpv.read` y nombres arbitrarios de `command`/`setProperty` con `native.mpv.raw` + risk acknowledgement.
- [ ] Operaciones mpv raw se auditan/redactan, fallan tras dispose/fallback y sus observers/listeners se limpian.
- [ ] Catálogo core de eventos incluye orden/sessionId/coalescing y tests.
- [ ] Hooks mínimos soportan allow/cancel/replace, timeout, policy y reentrada.
- [ ] UI/core/Syncplay usan command bus; no quedan autoridades paralelas para acciones migradas.
- [ ] Plugins pueden registrar comandos y servicios namespaced/versionados con cleanup.
- [ ] Todos los slots de `06` necesarios para el ejemplo existen, se ordenan y se aíslan por error sobre libmpv y fallback sin manipular la superficie nativa.
- [ ] A11y, i18n y theme de contribuciones están comprobados.

## Plugin first-party

- [ ] `@noir-player/plugin-playback-stats` es paquete independiente y sólo usa SDK público.
- [ ] Demuestra manifest, lazy load, lifecycle, events, command core/custom, UI, config, storage y telemetry/logger.
- [ ] Se puede quitar de selección sin tocar el core ni romper el player.
- [ ] Su disable/stop elimina UI, timer, listeners, comandos y datos de sesión pertinentes.
- [ ] Su fallo de prueba no tapa/rompe video ni otros plugins.
- [ ] Existe guía y scaffold reproducible para crear otro plugin.

## Seguridad

- [ ] UI/docs dicen claramente que plugins same-WebView son trusted, no sandboxed.
- [ ] Manifest solicita y host concede; checks runtime negativos pasan.
- [ ] No hay carga remota, `eval`, `new Function` ni instalación runtime arbitraria.
- [ ] `invoke/listen` de producción está encapsulado y la superficie de comandos Tauri fue auditada.
- [ ] Plugins autorizados reciben comandos/properties mpv mediante la fachada capability-gated; no reciben `invoke`, init/destroy, instancia, window/webview o video margin handles.
- [ ] `libmpv:default`, ventana transparente, DLL staging/bundle, procedencia/licencia/integridad y política de actualización tienen decisión escrita y pruebas.
- [ ] CSP/capabilities/permissions/asset scope tienen decisión escrita y smoke tests; excepciones están justificadas.
- [ ] Reproducción local, HLS loopback, fuentes y Syncplay siguen funcionando tras hardening.
- [ ] Logs/diagnostics/telemetry no filtran rutas, nombres, cues, stacks o secretos.
- [ ] Extensión Rust requiere compile/rebuild y permisos Tauri; no se presenta como carga dinámica.

## Calidad, rendimiento y compatibilidad

- [ ] `typecheck`, `lint`, `test`, `test:coverage`, `build`, `check` existen y pasan.
- [ ] Rust fmt/clippy/test/check pasan o un fallo de baseline está demostrado sin ocultarlo.
- [ ] CI frontend + Windows/Rust + E2E existe y usa `npm ci`/scripts locales.
- [ ] Pruebas cubren loader, compat, lifecycle, cleanup, events, hooks, commands, services, slots, seguridad y E2E.
- [ ] Regresiones críticas de libmpv init/load/events/destroy, fallback FFmpeg/browser, native controls/surface, apertura, subtitles, audio, playlist, prefs, fullscreen y Syncplay están automatizadas o tienen smoke documentado.
- [ ] No hay fugas de registros tras ciclos; time updates están coalescidos; startup no espera sin límite.
- [ ] Dynamic imports funcionan en Vite preview y Tauri empaquetado/dev, con libmpv y fallback, según alcance probado.

## Documentación y limpieza

- [ ] ADR/decision log refleja decisiones finales y desviaciones.
- [ ] README describe estructura/comandos/plugins actuales.
- [ ] `.github/copilot-instructions.md` fue reescrito y ya no menciona arquitectura Next inexistente.
- [ ] Docs de autoría/API/seguridad/testing/ejemplo coinciden con los tipos finales.
- [ ] Se retiraron configs/restos Next inválidos y caminos duplicados del refactor.
- [ ] No quedan TODOs/placeholders/mocks de producción ni tests skipped para el alcance.
- [ ] Dependencias nuevas están justificadas, lockfile actualizado y licencias compatibles.

## Verificación final obligatoria

1. Ejecutar desde checkout limpio de dependencias (`npm ci` cuando corresponda) todos los comandos documentados.
2. Ejecutar suite Rust desde `src-tauri`.
3. Ejecutar E2E y smoke manual con y sin plugin.
4. Inspeccionar bundle/chunks y consola sin errores inesperados.
5. Revisar `git diff --check`, `git diff --stat`, `git status --short` y diff completo por secretos/binarios/cambios ajenos.
6. No hacer commit.

El informe de Luna Max debe mapear evidencia a estas secciones, listar cualquier criterio no cumplido y continuar trabajando mientras quede un punto obligatorio corregible dentro del alcance.
