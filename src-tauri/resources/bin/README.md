# FFmpeg Binaries

This folder is intentionally kept out of Git history.

Reason:

- `ffmpeg.exe` and `ffprobe.exe` are larger than GitHub's regular file size limit for normal repositories.

## For local development

The app can fall back to `ffmpeg` and `ffprobe` from your system `PATH`.

## For building a self-contained installer

From the repository root, stage and verify the complete native runtime before
running:

```powershell
npm run stage:native
npm run verify:native
npm run tauri build
```

Expected files inside this directory:

- `src-tauri/resources/bin/ffmpeg.exe`
- `src-tauri/resources/bin/ffprobe.exe`

## Helper script

If FFmpeg is installed but not available in `PATH`, provide its directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stage-native-runtime.ps1 `
  -FfmpegDirectory 'C:\path\to\ffmpeg\bin'
```

The helper copies `ffmpeg.exe` and `ffprobe.exe` into this folder. When Scoop
provides FFmpeg through a shim, it resolves the package's real `current\bin`
executables instead of copying the small shim launcher. Cargo also refreshes
`target\debug\resources\bin` whenever either staged binary changes.
