# Estado actual del repositorio y restricciones de integración

## Snapshot inspeccionado

- Repositorio: `https://github.com/neura-neura/noir-player`.
- Checkout local: `C:\Users\neura\repos\noir-player`.
- Rama observada: `main`, commit `28f0a9d` y tag `v0.1.12` (`Release v0.1.12`).
- Producto: aplicación de escritorio orientada a Windows, Tauri 2 + React 18 + TypeScript estricto + Vite 8 + libmpv nativo + Plyr/Hls.js de fallback + Rust/FFmpeg.
- Versiones de la app: `0.1.12` en `package.json`, `Cargo.toml` y `tauri.conf.json`.
- El árbol estaba limpio durante esta inspección. Luna Max DEBE volver a comprobarlo; no puede asumir que siga así.

## Arquitectura real, no la documentación heredada

El entrypoint `src/main.tsx` monta un único componente `App` bajo `React.StrictMode`. `src/App.tsx` tiene aproximadamente 5.860 líneas y concentra casi todo:

- estado React y preferencias en `localStorage`;
- apertura por diálogo, ruta, asociación de archivo y drag-and-drop;
- inicialización/destroy de libmpv, observación de propiedades/eventos, comandos, volumen, márgenes, redraw y fallback;
- creación/destroy de Plyr y Hls.js para browser/fallback;
- `<video>`, audio externo sincronizado y transcodificación FFmpeg de compatibilidad;
- subtítulos externos/embebidos, cue activo, estilos y exportación;
- playlist de carpeta y comportamiento al terminar;
- controles React propios para libmpv, auto-hide, feedback, panel, dock, settings, notificaciones e i18n;
- coordinación de ventana transparente, superficie de video nativa, resize y transiciones de fullscreen;
- comandos/eventos/status de Syncplay;
- llamadas Tauri directas mediante `invoke` y `listen`.

`src/lib/subtitles.ts` es el único módulo de dominio sustancial ya separado. Parsea SRT/VTT/ASS/SSA, ZIP, codificaciones, sanea HTML con DOMPurify y hace búsqueda binaria del cue activo. `src/i18n` mantiene un contrato `AppMessages` común para `en`, `es` y `zh`.

`src/styles.css` es una hoja global de unas 1.580 líneas. Los puntos visuales actuales son el header, hero, stage, `player-frame`, loading/transition layers, controles nativos, capa de captions, dock, panel con tabs y secciones de settings. Plyr crea su barra para el fallback HTML; el camino principal de escritorio usa controles React sobre una superficie libmpv embebida.

## Puente nativo actual

`src-tauri/src/lib.rs` también es monolítico (unas 1.565 líneas). Registra estos comandos Tauri:

- `get_launch_video`;
- `open_devtools`;
- `list_system_fonts`;
- `list_folder_videos`;
- `prepare_hls_stream`;
- `prepare_video_playback_source` (usado al fallar libmpv para decidir/transcodificar el fallback browser según codec, pixel format y bit depth);
- `list_embedded_subtitle_streams`;
- `list_embedded_audio_streams`;
- `extract_embedded_subtitle_stream`;
- `extract_embedded_audio_stream`;
- `save_subtitle_to_downloads`;
- `syncplay_update_status`.

El backend resuelve FFmpeg/FFprobe, administra cachés y servidores loopback para HLS y Syncplay (`127.0.0.1:32123`). También emite `open-file` y `syncplay-command`.

La reproducción desktop principal se integra mediante `tauri-plugin-libmpv`/`tauri-plugin-libmpv-api` 0.3.2. `src-tauri/build.rs` copia `libmpv-2.dll` y `libmpv-wrapper.dll` al perfil de desarrollo; `tauri.conf.json` empaqueta `lib/**/*`, marca la ventana transparente y `src-tauri/capabilities/default.json` concede `libmpv:default` y operaciones de fullscreen/show. Las DLL se descargan con `npx tauri-plugin-libmpv-api setup-lib`, están ignoradas por Git y son parte de la cadena de suministro/runtime.

## Build, calidad y automatización observados

- Scripts npm existentes: `dev`, `build`, `preview`, `tauri`.
- No hay scripts `typecheck`, `lint`, `test` ni `check`.
- No hay archivos de prueba, configuración de runner ni cobertura.
- No hay workflows CI en `.github/workflows`.
- `.eslintrc.json` extiende `next/core-web-vitals`, pero ESLint/Next no están instalados. Es un resto inválido.
- `.github/copilot-instructions.md` describe Next.js 14, rutas y comandos inexistentes. Está completamente obsoleto.
- `README.md` describe el stack actual en general, pero su árbol aún dice `simplevideoplayer/` y debe revisarse.
- `package.json` ahora incluye `lucide-react`, `tauri-plugin-libmpv-api` y la descripción de playback nativo.
- Baseline ejecutado tras actualizar a `v0.1.12`: `npm ci` completa (63 paquetes) y `npm run build` pasa con Vite 8.0.3/1.854 módulos. El bundle actual genera un JS principal de ~1.360 kB minificado (~431 kB gzip) y advierte por chunk mayor de 500 kB.
- `npm ci` reporta 3 vulnerabilidades de dependencias (1 moderada, 2 altas). Luna Max debe auditarlas y distinguir transitivas/explotabilidad antes de cambiar versiones; no ejecutar `npm audit fix --force` a ciegas.
- TypeScript tiene `strict`, `isolatedModules`, alias `@/*` y `moduleResolution: Bundler`.
- Vite produce sourcemaps y apunta a ES2022/Chrome 105/Safari 13.
- No hay SSR: `window`, `document` y Tauri se usan directamente. Aun así, los módulos públicos del SDK NO DEBEN fallar al importarse en Node/tests o ante un futuro prerender.

## Seguridad observada

- `tauri.conf.json` tiene `csp: null`.
- El asset protocol está habilitado con scope `['**']`, necesario hoy para rutas locales arbitrarias pero muy amplio.
- Las capabilities habilitan `core:default`, `dialog:default` y `window-state:default` para `main`.
- La capability `default` habilita además `libmpv:default` y operaciones de ventana necesarias para show/fullscreen. Esa concesión aplica al WebView `main`; no distingue módulos JavaScript del core y plugins.
- Los comandos propios registrados por `invoke_handler` están disponibles al WebView por defecto salvo que se declare un `AppManifest`/ACL más restrictivo.
- La ventana transparente y la superficie libmpv embebida introducen una frontera visual/lifecycle adicional. El runtime descarga DLLs de terceros fuera de Git y debe auditar procedencia, versión, licencia e integridad reproducible.
- La UI permite cargar una URL CSS de fuente y hacer `fetch` de ella.
- DOMPurify protege el HTML de cues, pero un plugin en el mismo WebView tiene el poder normal de cualquier JavaScript empaquetado.

Estas observaciones obligan a una revisión, no autorizan a endurecer configuración a ciegas y romper reproducción local, fuentes o HLS loopback.

## Seams que la migración debe crear

1. Un store/snapshot del reproductor independiente del árbol visual y del motor activo.
2. Comandos del host que encapsulen mutaciones hoy locales a `App` y se comporten igual sobre libmpv o fallback browser.
3. Una interfaz `PlaybackEngine` con adaptadores explícitos para libmpv, HTMLMediaElement/Plyr/Hls y FFmpeg fallback.
4. Un `NativeBridge` tipado para `invoke/listen`, APIs libmpv, ventana y coordinación de superficie. El runtime puede proyectar una `MpvPluginFacade` auditada para plugins con grants explícitos, sin entregar `invoke`, init/destroy ni handles de superficie.
5. Un bridge de eventos del medio que normalice libmpv/DOM con cleanup determinista y descarte por `sessionId`.
6. Un coordinador de superficie para márgenes, redraw, background transparente, resize y fullscreen.
7. Adaptadores de storage, subtítulos y playlist.
8. Slots React estables en vez de selectores DOM accidentales o acceso a la superficie nativa.

La primera fase DEBE añadir pruebas de caracterización alrededor de los flujos que se extraigan. La refactorización no puede cambiar silenciosamente: inicialización/liberación de libmpv, propiedades/eventos mpv, fallback FFmpeg/browser, apertura de video, TS/HLS, controles nativos, posición/redraw de superficie, audio embebido, subtítulos/captions, playlist, preferencias, fullscreen, drag-and-drop ni Syncplay.
