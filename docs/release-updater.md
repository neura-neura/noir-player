# Publicación del updater de Noir Player

El workflow [`release.yml`](../.github/workflows/release.yml) publica sólo
Windows x64 cuando se empuja un tag `v*`. Antes de construir, ejecuta
la preparación nativa (incluye `ffmpeg-full` 8.0.1, la versión fijada por el
manifest, los DLL de libmpv descargados desde releases versionadas y
`stage-native-runtime.ps1`) y `verify:native`; después
`tauri-apps/tauri-action@v1.0.0` crea la release, sube los instaladores NSIS/MSI,
sus firmas `.sig` y el `latest.json` que utiliza el updater. El job falla antes
de publicar si el tag no coincide con las versiones de `package.json`,
`src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml`, o si falta la clave
pública/`createUpdaterArtifacts`.

El comando de desarrollo `npm run stage:native` sigue usando `setup-lib` para
la preparación habitual. En releases se usa `stage-pinned-libmpv.ps1` y se
omite esa descarga dinámica para que el cambio de un artefacto upstream no
produzca un instalador diferente al manifest; las dos descargas se verifican
con SHA-256 antes de copiar los DLL.

## Bootstrap de firma (una sola vez)

1. En una máquina segura, instala/usa el CLI local y ejecuta
   `npm run tauri signer generate -- -w <ruta-privada>` y protégela con una
   contraseña robusta. No generes la clave desde CI, no la muestres en logs y
   nunca la agregues al repositorio.
2. Conserva el archivo privado y su contraseña en un gestor de secretos. En
   **Settings → Secrets and variables → Actions** crea exactamente estos
   secretos:
   - `TAURI_SIGNING_PRIVATE_KEY`: contenido de la clave privada.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: contraseña de esa clave. El workflow
     comprueba que ambos secretos existan antes de compilar.
3. Publica únicamente la clave pública: el valor generado por el CLI debe
   inyectarse en `plugins.updater.pubkey` dentro de `src-tauri/tauri.conf.json`
   (no es una ruta de archivo). Sin esa clave pública, el cliente no puede
   validar `latest.json` ni instalar una actualización.
4. La configuración Tauri debe mantener
   `bundle.createUpdaterArtifacts: true` y un endpoint HTTPS que apunte a
   `https://github.com/neura-neura/noir-player/releases/latest/download/latest.json`.
   El endpoint y la clave pública son una precondición del código de la app;
   este workflow no los inventa ni los sobreescribe.

La clave privada es la identidad de todas las actualizaciones ya instaladas:
si se pierde o se reemplaza sin una migración de clave pública, esas
instalaciones no podrán aceptar nuevas versiones. Para rotarla, planifica una
versión que distribuya primero la nueva clave pública. Nunca incluyas claves,
contraseñas o archivos `.sig` generados localmente en un commit.
