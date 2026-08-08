# Instalación, selección, carga, config y compatibilidad

## Modelo de instalación v1

“Instalar” significa añadir una dependencia npm/workspace revisada y registrarla explícitamente en la configuración de build. No significa ejecutar un instalador desde la app.

Ejemplo normativo:

```ts
// noir.plugins.config.ts
import { defineNoirPlugins } from '@noir-player/plugin-api';

export default defineNoirPlugins([
  {
    id: 'noir.playback-stats',
    loader: () => import('@noir-player/plugin-playback-stats'),
    grants: [
      'player.read',
      'player.control',
      'ui.contribute',
      'commands.contribute',
      'storage',
      'telemetry',
    ],
    trust: 'first-party',
    config: { sampleIntervalMs: 1000 },
  },
]);
```

Los specifiers deben ser literales para que Vite los analice. Un plugin no presente no entra al grafo. Un loader presente pero no invocado puede producir un chunk separado, pero no debe evaluarse ni entrar al chunk inicial. Documentar claramente la diferencia entre **no seleccionado**, **seleccionado pero disabled** y **activo**.

Ejemplo de plugin avanzado con acceso mpv deliberadamente amplio:

```ts
{
  id: 'example.mpv-shaders',
  loader: () => import('@example/noir-mpv-shaders'),
  grants: ['player.read', 'ui.contribute', 'native.mpv.raw'],
  riskAcknowledgements: ['native.mpv.raw'],
  trust: 'reviewed-third-party',
}
```

El runtime permite a ese plugin llamar `context.mpv.command(name, args)`, `getProperty`, `setProperty`, `observeProperties` y `listenEvents` sin rebuild y sin catálogo cerrado de nombres. Quitar el grant o el acknowledgement hace que la activación falle antes de `setup` con diagnóstico accionable.

`import.meta.glob` PUEDE usarse para ejemplos first-party locales, sabiendo que Vite incluye como chunks todos los matches. Para el catálogo de producción preferir lista explícita: hace auditable qué código se empaqueta.

## Carga y validación

Antes de `setup`, el loader debe:

1. resolver el import con timeout y error de chunk recuperable;
2. comprobar `default` y forma del módulo;
3. validar manifest contra schema runtime;
4. comparar ID del selection/manifest;
5. validar SemVer de plugin, `apiVersion`, `appVersion` y platform;
6. comprobar grants/solicitudes;
7. resolver `requires`/`optional`, rangos y ciclos;
8. fusionar y validar config;
9. fijar orden topológico + priority + ID;
10. ejecutar lifecycle dentro de resource scope.

Un fallo no debe impedir el core ni plugins independientes. Un dependiente requerido queda `blocked` con causa; un optional ausente continúa. Exponer un diagnóstico legible y evento, sin stack en UI.

## Capas de configuración

Precedencia, de menor a mayor:

1. `defaultConfig` del paquete;
2. config en `noir.plugins.config.ts`;
3. config persistida del usuario para ese plugin;
4. override sólo de sesión para tests/dev, si se implementa.

La mezcla no debe ser un deep merge ambiguo de arrays/objetos. Definir semántica pública (recomendado: merge superficial y parsers responsables de defaults anidados) y probarla.

Cada plugin persiste `{ schemaVersion, value }` y aporta migraciones puras secuenciales. Si una migración falla, conservar backup/valor anterior, usar defaults seguros y notificar. Nunca borrar datos en silencio por incompatibilidad.

## SemVer y política de evolución

- `manifest.version`: versión de la implementación del plugin.
- `manifest.apiVersion`: range compatible con `NOIR_PLUGIN_API_VERSION`.
- `manifest.appVersion`: range opcional para capacidades del producto no expresadas por API.
- `requires[id]`: range del plugin requerido.
- `ServiceToken.version`: versión del contrato específico.

El runtime necesita una librería SemVer madura o implementación bien probada; no comparar strings manualmente. Toda API pública se documenta. Breaking changes del SDK incrementan major; deprecaciones tienen al menos una ventana minor y warning accionable.

Durante `0.x` de la app no asumir que todo es compatible. El SDK puede empezar `1.0.0` si el contrato está deliberadamente estabilizado, o `0.1.0` si se documenta la política especial; registrar la decisión.

## Vite, chunks y tree-shaking

- Mantener `type: module` y imports ESM.
- `plugin-api` debe declarar `sideEffects: false` salvo archivos CSS explícitos.
- Los módulos de plugin no ejecutan efectos globales al importarse; sólo dentro de `setup/start`.
- CSS del plugin debe pertenecer a su chunk o usar tokens namespaced. Verificar que no se carga antes del plugin.
- Analizar el build: plugin first-party en chunk propio, runtime razonable, sin React duplicado.
- Probar dynamic import bajo `vite preview` y dentro del esquema/bundle Tauri; no dar por hecho que una URL de chunk funciona igual.
- Si una actualización deja chunks antiguos cacheados y falla el import, mostrar recuperación/reinicio; no recargar en loop.

## SSR y entornos sin Tauri

Hoy no hay SSR, pero el SDK y manifest deben poder importarse en Node. Ningún acceso top-level a `window`, `document`, `localStorage`, Plyr, Hls, `tauri-plugin-libmpv-api` o Tauri. El host inyecta adaptadores y `MpvPluginFacade` después del arranque. `browser-preview` recibe un engine HTML degradado; `context.mpv.isAvailable()` devuelve `false` y operaciones mpv producen `MpvUnavailableError` tipado.

## Extensión nativa

Si un plugin requiere Rust:

- se añade como dependencia Cargo/Tauri en código fuente;
- se registra en `tauri::Builder` al compilar;
- expone bindings JS tipados separados;
- declara permisos/scopes/capabilities de Tauri;
- se prueba en Windows y requiere un rebuild de la app.

El manifest frontend puede declarar que necesita un servicio nativo; nunca descarga ni carga una DLL arbitraria.

La integración libmpv ya presente sigue estas mismas reglas: crate/npm API compilados, `libmpv:default`, ventana transparente y DLLs empaquetadas. Un plugin frontend obtiene acceso sólo si solicita y recibe `native.mpv.read` o `native.mpv.raw`; no importa el paquete Tauri directamente. La fachada permite comandos/properties sin rebuild, mientras nuevas bibliotecas nativas, lifecycle global o superficie/ventana sí requieren código host, revisión de capabilities y rebuild. `setup-lib` es preparación del runtime de Noir, no un instalador de plugins.
