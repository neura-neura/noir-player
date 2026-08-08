# Fuentes oficiales consultadas y trazabilidad de patrones

Consulta realizada el 7 de agosto de 2026. Son referencias de diseño, no código para copiar. Antes de implementar, Luna Max debe verificar que las páginas/versiones relevantes sigan vigentes y respetar sus licencias.

## Reproductores comparables

### Video.js

- [Guía oficial de plugins](https://videojs.com/guides/plugins/)
- [Fuente oficial de `plugin.js`](https://docs.videojs.com/plugin.js.html)
- [Repositorio oficial `videojs/video.js`](https://github.com/videojs/video.js)

Patrones adoptados: instancia por player, registro nominal, lifecycle explícito, `dispose` que limpia listeners/referencias, versión del plugin, logging contextual y eventos before/after setup. Adaptación Noir: no añadir métodos dinámicos al objeto player; usar registry/fachada tipada para evitar colisiones y acoplamiento.

### Artplayer

- [Documentación oficial: Writing Plugins](https://artplayer.org/document/en/advanced/plugin)
- [Repositorio oficial `zhw2590582/ArtPlayer`](https://github.com/zhw2590582/ArtPlayer)

Patrones adoptados: plugin como factory/módulo configurado al construir o añadido después, resultado con nombre/API propia, y composición de layers/controls mediante APIs del player. Adaptación Noir: módulo `setup` retorna instancia/API, pero UI entra por slots React saneados y ordenados.

### xgplayer

- [Introducción oficial a plugins](https://h5player.bytedance.com/en/plugins/)
- [Plugin/BasePlugin, lifecycle, posiciones y APIs](https://h5player.bytedance.com/en/plugins/custom_plugin.html)
- [Hooks oficiales](https://h5player.bytedance.com/en/api/hooks.html)
- [Repositorio oficial `bytedance/xgplayer`](https://github.com/bytedance/xgplayer)

Patrones adoptados: separar plugins sin UI de plugins UI, lifecycle `before/after/create/destroy`, cleanup automático de listeners, posición + índice determinista, registro/desregistro, acceso nominal a instancias y hooks sync/async que permiten/cancelan comportamiento. Adaptación Noir: un solo contrato modular, slots nominales del host, orden total estable, timeout/AbortSignal y separación estricta evento/hook/comando.

### Shaka Player

- [Configuración y custom elements de UI](https://shaka-project.github.io/shaka-player/docs/api/tutorial-ui-customization.html)
- [Botones custom accesibles](https://shaka-project.github.io/shaka-player/docs/api/tutorial-a11y.html)
- [Fuente oficial de `ui.Element`](https://shaka-project.github.io/shaka-player/docs/api/ui_element.js.html)
- [Fuente oficial de `ui.Controls.registerElement`](https://shaka-project.github.io/shaka-player/docs/api/ui_controls.js.html)
- [Repositorio oficial `shaka-project/shaka-player`](https://github.com/shaka-project/shaka-player)

Patrones adoptados: factory registrada por nombre, layout configurado como lista ordenada, elementos UI con base/contexto común, `EventManager.release`, CSS custom properties y accesibilidad ARIA obligatoria. Adaptación Noir: `PluginSlot` + contribution descriptor + error boundary; theme tokens y orden están en contrato, no en selectores privados.

## Plataforma y empaquetado

### Noir Player v0.1.12 y libmpv

- [Commit inspeccionado `28f0a9d` / tag `v0.1.12`](https://github.com/neura-neura/noir-player/commit/28f0a9d599563cb221c4dbd2782dc32182395331)
- [Paquete `tauri-plugin-libmpv-api` 0.3.2](https://www.npmjs.com/package/tauri-plugin-libmpv-api)
- [Repositorio del plugin `nini22P/tauri-plugin-libmpv`](https://github.com/nini22P/tauri-plugin-libmpv)
- [Manual de integración libmpv de Noir Player](../../src-tauri/lib/README.md)

Hechos incorporados al diseño: Noir Player desktop prefiere libmpv embebido, observa properties/events y usa controles/captions React sobre una ventana transparente; si init/load falla prepara una fuente browser/FFmpeg. El plugin libmpv requiere wrapper + biblioteca dinámica, recursos empaquetados, transparencia y capability Tauri. Decisión revisada por el dueño: abstraer el motor y normalizar el fallback, pero proyectar una `MpvPluginFacade` capability-gated para que plugins avanzados lean events/properties y, con `native.mpv.raw`, ejecuten comandos/escrituras arbitrarios. Las DLL siguen auditándose como supply chain nativa. El paquete comunitario declara soporte Windows completo y Linux/macOS limitado; el alcance verificable de Noir sigue siendo Windows.

### Vite

- [Documentación oficial de features: glob imports, dynamic imports y code splitting](https://vite.dev/guide/features.html)

Patrones adoptados: `import.meta.glob` genera loaders y chunks lazy; imports dinámicos literales permiten code splitting; named/eager imports pueden tree-shake. Decisión Noir: catálogo explícito con `() => import('specifier-literal')`, ausencia verificable del chunk inicial y uso consciente de que un glob empaqueta todos sus matches.

### Tauri 2

- [Desarrollo oficial de plugins Tauri](https://v2.tauri.app/develop/plugins/)
- [Capabilities](https://v2.tauri.app/security/capabilities/)
- [Permissions y scopes](https://v2.tauri.app/security/permissions/)
- [Runtime authority](https://v2.tauri.app/security/runtime-authority/)

Patrones adoptados: un plugin nativo se compone de crate Cargo y bindings npm opcionales; configuración/lifecycle son explícitos; comandos de plugin son deny-by-default hasta conceder permisos; capabilities limitan exposición por window/webview y scopes refinan comandos. Observación crítica para Noir: comandos propios de app en `invoke_handler` están permitidos por defecto salvo `AppManifest::commands`; además, capabilities de una misma window se combinan. Decisión: bridge tipado, revisión ACL/CSP y extensiones nativas sólo compile-time. Las capabilities Tauri no aíslan dos módulos JS dentro del mismo WebView.

## Contratos y paquetes

- [Semantic Versioning 2.0.0](https://semver.org/)
- [Documentación oficial npm de `package.json`](https://docs.npmjs.com/cli/configuring-npm/package-json/)
- [React: `createContext`](https://react.dev/reference/react/createContext)
- [React: `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore)

Patrones adoptados: declarar API pública antes de versionarla; major/minor/patch comunican incompatibilidad/feature/fix; `peerDependencies` evita que plugins UI posean otra React; context conecta runtime y árbol React; external store permite snapshots consistentes sin regalar setters.

## Matriz decisión -> inspiración -> adaptación

| Decisión Noir | Inspiración primaria | Adaptación específica |
|---|---|---|
| Lifecycle con cleanup garantizado | Video.js `dispose`, xgplayer `destroy`, Shaka `release` | Resource scope + AbortSignal + teardown inverso aunque haya error. |
| Instancia/API por plugin | Video.js advanced plugin, Artplayer return object | Registry `pluginId`, sin mutar prototipo de player. |
| Eventos tipados y logging contextual | Video.js events/log | Payload readonly/sessionId y redaction de datos locales. |
| Hooks allow/cancel/replace | xgplayer hooks | Sólo seams declarados, orden, timeout, reentrada y policy fail-open/closed. |
| Slots UI ordenados | xgplayer positions/index, Shaka factories/config list | Slots React nominales, tie-break por ID y error boundary. |
| A11y/theme como contrato | Shaka accessibility/CSS variables | ARIA/foco/i18n y tokens Noir obligatorios para contributions. |
| Loaders seleccionados/lazy | Vite dynamic import/glob | Config explícita auditable y test de chunks/no ejecución. |
| Manifest/API/deps versionados | Video.js VERSION + SemVer | Ranges separados para SDK/app/plugin/service, validación previa a setup. |
| Manifest solicita, host concede | Tauri permissions/capabilities | Grants en archivo app; aclaración de que no es sandbox same-WebView. |
| Nativo compile-time y bindings | Tauri plugin crate + npm API | Nada de DLL/Rust remoto; permisos/scopes y rebuild. |
| Motor desacoplado y fallback | Noir Player v0.1.12 + API libmpv | `PlaybackEngine`, resolver, events normalizados y surface coordinator; `MpvPluginFacade` expone raw commands/properties sólo con capabilities explícitas. |
| Plugin first-party como prueba | Ecosistemas donde built-ins usan mecanismo de plugins (xgplayer) | Ejemplo no crítico usa sólo SDK y puede retirarse sin afectar core. |

## Reglas de uso de estas fuentes

- Extraer patrones y reimplementar conforme a la arquitectura/licencia de Noir Player; no copiar bloques sustanciales.
- Preferir docs y código oficial sobre blogs/ejemplos de terceros.
- Registrar en ADR cualquier patrón descartado y por qué.
- Si una API cambió, citar enlace/version/fecha nueva en la documentación final.
