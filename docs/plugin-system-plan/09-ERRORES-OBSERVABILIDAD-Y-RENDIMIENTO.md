# Errores, observabilidad, telemetría y rendimiento

## Política de fallos

El runtime debe mantener a Noir Player utilizable ante:

- import/chunk inexistente;
- manifest o config inválidos;
- incompatibilidad de API/app/platform;
- dependencia ausente, incompatible o cíclica;
- excepción/timeout en `setup`, `start`, hook, comando, config, `stop` o `dispose`;
- render fallido de una contribución React;
- servicio desaparecido durante teardown.
- init/load/destroy/event/property fallido de libmpv;
- transición libmpv -> FFmpeg/browser, resize/margin/redraw o fullscreen nativo fallido.

Cada fallo produce `PluginDiagnostic` con `pluginId`, versión, fase, código, severidad, recoverable, timestamp y correlation/session ID. Stack/cause queda sólo en log local de desarrollo. El estado del plugin pasa a `failed` o `blocked`; se retiran sus contribuciones y se limpia su scope. Los plugins no dependientes y el core continúan.

Un error boundary debe aislar cada contribución, no todo el player. Puede mostrar fallback compacto con opción de ocultar/reintentar en dev; en producción no debe cubrir el video.

## Circuit breaker y reintento

- Lifecycle/import: un reintento explícito como máximo por acción de usuario; nunca loop automático.
- Hooks/comandos: tras un umbral pequeño de fallos consecutivos, desactivar esa participación o el plugin y emitir diagnóstico.
- Render: error boundary retira sólo la contribución; si múltiples contribuciones fallan, detener plugin.
- Resetear contador sólo tras ejecución exitosa o nueva versión/config.
- Todos los límites deben ser constantes/config host y tener tests con fake timers.

## Logger

`PluginLogger` incluye automáticamente:

```text
scope=noir.plugin pluginId version phase sessionId correlationId level message
```

Soporta `debug/info/warn/error`, structured fields serializables y redaction central. El plugin no elige un sink remoto. Integrar con consola en dev y, si se decide, con `tauri-plugin-log`; documentar ubicación/rotación. No loggear `media:time-update` por defecto.

Las llamadas `context.mpv.command/getProperty/setProperty/observe/listen` generan una entrada de auditoría con plugin, operación, nombre mpv, duración y resultado. Argumentos/valores sensibles se redactan o resumen; en particular `loadfile`, paths, URLs, headers, scripts y subtitle text no se copian completos al log. La auditoría no bloquea nombres raw cuando existe el grant.

## Telemetría

Definir eventos internos útiles:

- duración de import/setup/start/stop;
- engine seleccionado, tiempo de init/load y transición a fallback, sin ruta/nombre del medio;
- conteo/latencia/error de operaciones mpv raw por plugin, sin payload sensible;
- estado y código de fallo;
- número de hooks/comandos/contribuciones activas;
- timeout/circuit breaker;
- tamaño/chunk del build obtenido en CI, no en runtime si no hace falta.

La API acepta nombres namespaced y campos allowlisted. No admite rutas, nombres de archivos, texto de cues ni config arbitraria. La primera implementación puede almacenar un buffer local acotado visible en DevTools/diagnóstico. Cualquier salida de red requiere opt-in explícito y revisión de `08`.

## Rendimiento

- Baseline `v0.1.12`: el build Vite produce un chunk JS principal de ~1.360 kB minificado/~431 kB gzip y ya emite warning de >500 kB. Registrar este dato antes del refactor; el runtime base debe tener presupuesto explícito y los cuerpos de plugins permanecer fuera de ese chunk.
- Plugin no seleccionado: cero setup, listeners, timers o CSS evaluado.
- Plugin seleccionado: cuerpo fuera del chunk inicial mediante dynamic import.
- Arranque core no bloqueado indefinidamente; medir y presupuestar lifecycle.
- `media:time-update` para plugins <= 4 Hz por defecto; UI que necesite animación usa mecanismo host dedicado y cancelable.
- Observers `time-pos`/properties de libmpv y eventos DOM convergen en el mismo coalescer; no duplican updates al cambiar a fallback.
- Selectores de snapshot deben evitar rerenders globales. Un cambio de tiempo no debe rerenderizar todas las secciones de settings.
- Registry/event bus no puede crecer después de ciclos start/stop; probar conteos y memoria indirectamente.
- No duplicar React/ReactDOM en chunks de plugins.
- Config/hook payloads se clonan/congelan razonablemente, evitando copiar cues completos en cada tick.

## Diagnóstico para mantenedores

Añadir una API o vista de desarrollo que muestre:

- API/app version y platform;
- engine activo, capacidades normalizadas y última razón de fallback redactada;
- plugins seleccionados y estados;
- versión/ranges/grants/trust;
- dependencias y orden;
- contribuciones/comandos/servicios registrados;
- último error redactado;
- timings básicos.

No es necesario un marketplace. El diagnóstico debe estar protegido como herramienta de desarrollo y ser testeable sin DevTools visuales.
