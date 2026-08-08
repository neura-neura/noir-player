# Encargo maestro para Luna Max: implementar el sistema de plugins de Noir Player

**Ejecutor objetivo:** GPT-5.6 Luna con razonamiento `max` ("Luna Max"). Selecciona ese modelo y esfuerzo en la interfaz antes de iniciar; este texto define el trabajo, pero no puede cambiar por sí mismo la configuración del modelo.

Luna Max, actúa como mantenedora principal de `C:\Users\neura\repos\noir-player`. Este encargo exige una implementación completa, probada y documentada. No entregues otro plan, un prototipo aislado ni sólo interfaces: modifica el producto hasta que un plugin real funcione de extremo a extremo y todos los criterios de aceptación sean verificables.

## Orden de lectura obligatorio

Lee completos estos archivos, en este orden, antes de editar código:

1. `00-MASTER-PROMPT.md` (este archivo).
2. `01-ESTADO-ACTUAL-DEL-REPO.md`.
3. `02-OBJETIVOS-Y-DECISIONES.md`.
4. `03-ARQUITECTURA-OBJETIVO.md`.
5. `04-CONTRATO-TYPESCRIPT.md`.
6. `05-LIFECYCLE-EVENTOS-Y-HOOKS.md`.
7. `06-UI-SLOTS-COMANDOS-Y-SERVICIOS.md`.
8. `07-INSTALACION-CARGA-Y-COMPATIBILIDAD.md`.
9. `08-SEGURIDAD-AISLAMIENTO-Y-TAURI.md`.
10. `09-ERRORES-OBSERVABILIDAD-Y-RENDIMIENTO.md`.
11. `10-DX-Y-PLUGIN-FIRST-PARTY.md`.
12. `11-PRUEBAS-CI-MIGRACION-Y-DOCS.md`.
13. `12-ACEPTACION-Y-ENTREGA.md`.
14. `13-FUENTES-Y-TRAZABILIDAD.md`.

Después vuelve a inspeccionar el repositorio real. Estos documentos describen el estado observado el 7 de agosto de 2026, pero el código y los cambios sin commit que encuentres al empezar son la fuente de verdad.

## Misión

Implementa una plataforma de plugins modular para Noir Player que permita extender el comportamiento, la UI y las integraciones del reproductor mediante una API pública, tipada, versionada y testeable. Un plugin seleccionado debe instalarse como módulo independiente, cargarse de forma diferida, recibir sólo las fachadas del host que necesita, contribuir a slots/comandos/servicios y limpiarse sin fugas. Un plugin no seleccionado no debe ejecutarse ni entrar en el chunk inicial.

La implementación debe incluir, como mínimo:

- separación real entre el dominio del reproductor, una abstracción de motor de reproducción, los adaptadores de libmpv/HTMLMediaElement/Plyr/Hls/FFmpeg/Tauri y la UI React;
- paquete SDK/API público y pequeño para autores de plugins;
- runtime con selección, carga dinámica, validación, compatibilidad, dependencias, lifecycle y teardown;
- eventos observacionales, hooks interceptores, comandos, servicios y slots UI tipados;
- configuración validada y persistencia con namespace por plugin;
- modelo de confianza explícito y revisión de la superficie Tauri;
- soporte uniforme del motor nativo libmpv y del fallback browser/FFmpeg, incluyendo una fachada mpv avanzada: lectura mediante `native.mpv.read` y comandos/properties arbitrarios mediante la capability de alto riesgo `native.mpv.raw`;
- aislamiento de fallos, logging y telemetría local/opt-in sin datos sensibles;
- un plugin first-party independiente que pruebe todo el recorrido;
- pruebas unitarias, de integración, de UI, de contrato y E2E proporcionadas al riesgo;
- scripts coherentes de `typecheck`, `lint`, `test`, `build` y `check`, más CI;
- documentación para usuarios, mantenedores y autores de plugins;
- actualización de `.github/copilot-instructions.md`, que hoy está obsoleto y no debe usarse como descripción de la arquitectura.

## Reglas de ejecución

1. Empieza con `git status --short` y conserva cualquier cambio ajeno. No uses operaciones destructivas ni hagas commits.
2. Inspecciona `package.json`, lockfile, Vite/TypeScript, `src`, `src-tauri`, capacidades, README, historial relevante, `tauri-plugin-libmpv`, el staging de DLLs y cualquier archivo nuevo. No confíes en `.github/copilot-instructions.md`: describe una app Next.js que ya no existe.
3. Ejecuta y registra el baseline que sea posible antes de editar. Si falta un script, regístralo como deuda; no simules que pasó.
4. Crea `docs/architecture/plugin-system-decisions.md` o ADR equivalentes. Confirma o cambia cada decisión propuesta en `02`; toda desviación debe incluir evidencia, alternativa descartada y consecuencia.
5. Trabaja en incrementos verticales verificables. Primero crea seams y pruebas de caracterización; después el SDK/runtime; luego integra slots y adaptadores; finalmente instala el plugin first-party.
6. Mantén la reproducción existente funcional durante la migración. No hagas un big-bang ciego sobre `App.tsx`.
7. Usa fuentes oficiales/primarias y revisa versiones actuales antes de añadir dependencias. Justifica cada dependencia nueva y actualiza el lockfile de forma reproducible.
8. No expongas `App`, setters React, refs mutables ni `invoke` Tauri crudo. Para libmpv sí expón la `MpvPluginFacade` definida en `04`: acceso capability-gated a events/properties y, con `native.mpv.raw`, a `command`/`setProperty` sin allowlist de nombres. Mantén `init/destroy`, handles de ventana y superficie bajo autoridad del host.
9. No cargues JavaScript remoto, no uses `eval`/`new Function` y no presentes el modelo cooperativo de capacidades como una sandbox.
10. No dejes `TODO`, mocks conectados a producción, handlers vacíos, APIs “para después” ni pruebas saltadas para aparentar éxito.
11. Ejecuta al final todas las verificaciones de `11` y la checklist de `12`. Corrige los fallos causados por tu trabajo. Si descubres un fallo de baseline, demuéstralo y no lo ocultes.
12. No te detengas al compilar: verifica carga, interacción, error y descarga del plugin en navegador/Vite y en Tauri Windows con libmpv disponible y con su fallback forzado. Incluye resize, fullscreen, controles/captions sobre la superficie nativa y cambio de sesión.

## Jerarquía normativa

Las expresiones **DEBE**, **NO DEBE**, **DEBERÍA** y **PUEDE** son normativas. Si una prescripción exacta resulta incompatible con el código actualizado, conserva la intención, documenta la decisión y demuestra que la alternativa satisface los criterios de `12-ACEPTACION-Y-ENTREGA.md`.

## Resultado final esperado

Entrega el código funcionando, no este plan reescrito. Tu informe final debe incluir:

- resumen de arquitectura y decisiones;
- archivos/paquetes principales creados o modificados;
- plugin first-party y recorrido demostrado;
- comandos ejecutados con resultado;
- pruebas manuales realizadas;
- riesgos residuales y trabajo explícitamente fuera de alcance;
- `git status --short` final, confirmando que no hiciste commit.
