# Experiencia de autor y plugin first-party de validación

## Paquetes obligatorios

### `@noir-player/plugin-api`

- Contrato de `04`, helpers puros, event/command maps y tokens.
- ESM, declaraciones `.d.ts`, exports explícitos, `sideEffects: false` salvo excepciones.
- Sin dependencia de Tauri/libmpv/Plyr/Hls y sin acceso top-level al browser.
- README de API y changelog/política SemVer.

### `@noir-player/plugin-test-utils`

- `createTestPluginHost()` con reloj, player, bridge, storage y logger fakes.
- Helpers para avanzar lifecycle, emitir eventos, ejecutar comandos y montar slots.
- Assertions de cleanup, capabilities y diagnostics.
- No debe importar el runtime de producción de forma que los tests del plugin sólo pasen por compartir internals.

### `@noir-player/plugin-playback-stats`

Plugin first-party pequeño pero vertical. Debe usar exclusivamente el SDK público y demostrar:

- manifest/config/compatibilidad/grants;
- import dinámico en chunk independiente;
- `setup/start/stop/dispose` y AbortSignal;
- lectura de snapshot y suscripción a eventos de playback;
- visualización del engine efectivo y reacción a `media:engine-changed` sin importar APIs del backend;
- contribución de chip a `stage.info`;
- botón accesible en `player.dock` que ejecuta un comando namespaced para mostrar/ocultar;
- overlay o panel con estado actual (playing/paused, tiempo, rate) sin registrar cada frame;
- acción play/pause a través del comando core, no del `<video>`;
- el mismo comportamiento en browser preview y Tauri/libmpv, incluido fallback forzado;
- sección de settings para `sampleIntervalMs`, validada con límites razonables;
- persistencia namespaced de preferencia de visibilidad;
- logger/telemetría local sin ruta ni nombre del medio;
- cleanup total de UI, comando, listeners y timers al detenerse;
- error intencional inyectable sólo en test para probar aislamiento.

El plugin `playback-stats` debe seguir siendo portable y NO solicitar `native.mpv.raw`; valida el camino recomendado. Añadir además un fixture/test plugin no seleccionado en producción, `mpv-lab`, que solicite `native.mpv.read`/`native.mpv.raw` y demuestre `getProperty`, observe, un `command` inocuo y `setProperty`, cleanup y denegación sin grant. Así la escape hatch queda probada sin convertirla en dependencia del ejemplo principal.

No convertir una feature crítica existente en ejemplo. El reproductor debe funcionar igual si este paquete se elimina de `noir.plugins.config.ts`.

## Esqueleto mínimo para autores

La documentación final debe incluir un ejemplo compilable semejante a:

```ts
import {
  definePlugin,
  type NoirPluginContext,
} from '@noir-player/plugin-api';

type Config = { label: string };

export default definePlugin<Config>({
  manifest: {
    id: 'example.hello',
    name: 'Hello',
    version: '0.1.0',
    apiVersion: '^1.0.0',
    description: 'Ejemplo mínimo.',
    license: 'MIT',
    requestedCapabilities: ['player.read', 'ui.contribute'],
  },
  defaultConfig: { label: 'Hello' },
  config: {
    parse(value: unknown): Config {
      // Validación real; el ejemplo completo no debe usar casts inseguros.
      return parseHelloConfig(value);
    },
  },
  setup(context: NoirPluginContext, config) {
    const contribution = context.ui.contribute(createHelloChip(config));
    context.resources.add(contribution);
    return {
      dispose() {
        // El scope también garantiza cleanup ante excepciones.
      },
    };
  },
});
```

El ejemplo real debe mostrar config parser, traducción, test y selección; no dejar `parseHelloConfig` sin definir.

## Scaffold y flujo de autor

Añadir un comando simple y documentado, por ejemplo `npm run create-plugin -- my-plugin`, que copie una plantilla local segura o genere:

- package manifest y peerDependencies correctos;
- `src/index.ts`, manifest/config y componente opcional;
- unit/contract test;
- README con instalación/selección/grants;
- nombres namespaced validados.

No es necesario publicar CLI. El generador debe fallar sin sobrescribir si el destino existe y tener al menos una prueba o dry-run.

## Documentación para autores

Crear `docs/plugins/authoring.md`, `api.md`, `security.md`, `testing.md` y `examples/playback-stats.md` (o estructura equivalente) con:

- quickstart reproducible desde cero;
- reglas de IDs, versionado, manifest y config;
- lifecycle y cleanup;
- catálogo de eventos/hooks/comandos/slots/servicios;
- capabilities solicitadas/concedidas y límites de aislamiento;
- accesibilidad/i18n/theme;
- cómo testear, medir bundle y depurar;
- cómo añadir un seam público mediante propuesta/ADR sin importar internals;
- cómo desarrollar en browser preview y qué requiere Tauri Windows.
- cómo razonar sobre `sourceKind` vs `engine`, qué APIs son portables y por qué libmpv/DLL/surface no se exponen a plugins frontend.
- cómo solicitar `native.mpv.read`/`native.mpv.raw`, aceptar el riesgo, usar `context.mpv`, detectar fallback y evitar importar `tauri-plugin-libmpv-api` directamente.

## Experiencia de mantenedor

- Un solo comando `npm run check` debe ejecutar verificaciones frontend/workspaces en orden claro.
- Errores de manifest/config deben indicar plugin, campo y solución.
- Tipos/autocomplete deben guiar event names, command inputs, slot names y tokens.
- Mantener fixture de plugin incompatible para probar mensajes, no como selección de producción.
- Añadir reglas de arquitectura que impidan imports desde plugin a `src/**` salvo SDK público.
