# Objetivos, no-objetivos, invariantes y decisiones propuestas

## Objetivos funcionales

El sistema DEBE permitir que un plugin independiente pueda:

- observar estado/eventos del reproductor sin acoplarse a React interno;
- ejecutar y aportar comandos tipados;
- interceptar únicamente operaciones con hooks públicos y ordenados;
- aportar UI a slots nominales y ordenables;
- consumir/proveer servicios versionados;
- guardar configuración/datos en un namespace propio;
- aportar traducciones y settings;
- leer eventos/properties libmpv y, cuando el host conceda `native.mpv.raw`, ejecutar comandos y escribir properties mpv arbitrarios para extensiones avanzadas;
- declarar versión, compatibilidad, dependencias y capacidades solicitadas;
- iniciar, detenerse, recargarse si procede y liberar todos sus recursos;
- fallar sin impedir que el video y los demás plugins sigan funcionando.

La app DEBE cargar sólo los plugins seleccionados. Ausencia de la selección significa ausencia de ejecución; el bundle inicial no debe contener el cuerpo de sus chunks diferidos.

## No-objetivos de la primera versión

- Marketplace, descarga o actualización de plugins desde la UI.
- Ejecutar código desde una URL, ZIP o directorio arbitrario.
- Sandbox segura para código hostil dentro del mismo WebView.
- Carga dinámica de Rust/DLL sin recompilar la aplicación.
- Convertir de inmediato cada feature core existente en plugin.
- Prometer compatibilidad binaria o publicar paquetes a npm en este cambio.
- Reemplazar React, libmpv, Plyr, Hls.js, FFmpeg o Tauri sin necesidad demostrada.

## Invariantes

- El core puede arrancar y reproducir sin plugins.
- La API pública modela reproducción y sesiones, no libmpv ni HTMLMediaElement: cambiar de motor o caer al fallback no rompe comandos, eventos ni contribuciones.
- Ningún plugin es requisito para abrir archivos o manejar errores del medio.
- El medio tiene una sola autoridad de escritura: comandos/hook pipeline del host.
- Eventos son observacionales; hooks pueden influir; comandos producen acciones. No mezclar semánticas.
- IDs públicos son únicos, estables, en minúsculas y con namespace.
- Todo registro devuelve cleanup y todo plugin se destruye en orden inverso.
- Config y payloads cruzan límites como datos validados; no como refs React mutables.
- El host conserva lifecycle/surface ownership de libmpv; un plugin con `native.mpv.raw` recibe control operacional amplio y puede romper la reproducción, por lo que el riesgo debe ser visible y explícitamente aceptado.
- `apiVersion` del SDK es distinto de `version` de la app y de la versión del plugin.
- El manifest solicita capacidades; la selección controlada por el host las concede. El plugin no se concede privilegios a sí mismo.
- Compatibilidad y orden no dependen del orden incidental de imports u objetos JavaScript.

## Decisiones propuestas que Luna Max debe registrar

Cada punto debe quedar como ADR `Aceptado` o `Sustituido` con evidencia:

1. **D-001, plugins confiables y empaquetados en v1.** Los plugins frontend son dependencias de build revisadas. No existe sandbox real dentro del WebView.
2. **D-002, API de capacidades del host.** Plugins reciben una `PluginContext` estable; no `App`, setters, refs ni `invoke` crudo.
3. **D-003, SDK como paquete workspace.** Crear `@noir-player/plugin-api` sin dependencias pesadas y con contrato público versionado. React, si se usa para contribuciones UI, es `peerDependency`.
4. **D-004, runtime dentro de la app.** Descubrimiento/validación/carga/lifecycle pertenecen a `src/plugins/runtime`; el SDK no importa implementación del host.
5. **D-005, selección explícita y lazy.** `noir.plugins.config.ts` contiene loaders `() => import(...)` literales. Vite separa chunks y sólo el runtime invoca los elegidos.
6. **D-006, store externo, comandos y motor abstracto.** Extraer estado/acciones del monolito; React consume snapshots y los plugins usan la misma fachada. `PlaybackEngine` normaliza libmpv y browser fallback. Considerar `useSyncExternalStore` antes de añadir un state manager.
7. **D-007, slots nominales.** La UI extensible usa slots React con orden determinista; no inserción por selectores privados de Plyr ni manipulación de la superficie libmpv.
8. **D-008, lifecycle pequeño.** `setup -> start -> stop -> dispose`, configuración actualizable y `AbortSignal`; eventos cubren el ciclo de cada medio.
9. **D-009, SemVer.** Manifest, API del host y dependencias usan SemVer/ranges; incompatibilidades fallan antes de `setup` con error visible y testeado.
10. **D-010, nativo separado.** Una extensión nativa es un plugin/dependencia Tauri compilada, con comandos y permisos explícitos; no se descarga en runtime. La integración libmpv existente sigue siendo adaptador del host, pero proyecta una fachada pública opcional de events/properties/comandos a plugins frontend autorizados.
11. **D-011, aislamiento por fallo.** Error boundary por contribución UI, cleanup automático y circuit breaker para plugins que fallen repetidamente.
12. **D-012, dogfooding.** Un plugin first-party independiente usa sólo el SDK público. Los tests impiden importar internals de `src`.
13. **D-013, migración incremental.** Caracterizar, extraer, delegar y borrar código viejo por vertical slice; nunca duplicar dos autoridades activas.
14. **D-014, telemetría privada por defecto.** Logging local estructurado; exportación/telemetría remota sólo opt-in y sin rutas/nombres de medios.
15. **D-015, motor y superficie desacoplados.** El core selecciona entre `libmpv`, `html-media`/`hls-js` y fallback FFmpeg mediante adaptadores. Un coordinador host controla margen/redraw/transparencia/fullscreen de la superficie nativa. Los plugins normales ven estado/comandos/slots normalizados; los que reciben `native.mpv.read`/`native.mpv.raw` acceden además a la fachada mpv avanzada.
16. **D-016, escape hatch mpv explícito.** `native.mpv.read` permite disponibilidad, properties, observers y events. `native.mpv.raw` añade `command` y `setProperty` sin allowlist de nombres/valores. El grant requiere acknowledgement explícito, auditoría y logging; no concede `init`, `destroy`, `setVideoMarginRatio`, window handles ni `invoke` general.

## Cómo resolver tensiones

“Personalizar cualquier aspecto” significa que el host debe ofrecer extensiones suficientes y ampliables; no significa entregar acceso irrestricto como API estable. Para un caso imposible con la API segura, puede existir una capacidad explícita `unsafe.dom`, sólo para código revisado, marcada inestable y excluida de las garantías SemVer. Antes de usarla en el plugin first-party, debe demostrarse por qué falta un seam: el ejemplo de referencia NO DEBERÍA necesitarla.

Para mpv, el dueño del producto ha elegido deliberadamente una excepción más potente: `native.mpv.raw` sí permite comandos y properties arbitrarios porque desbloquea shaders, filtros, tracks, profiles y funciones nuevas de mpv sin esperar una ampliación del DTO core. Esta capability se considera unsafe/cooperativa, no sandboxed; su contrato garantiza transporte, cleanup y errores, no que cada nombre mpv conserve SemVer entre versiones del runtime.
