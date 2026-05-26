# FFmpeg Binaries

This folder is intentionally kept out of Git history.

Reason:

- `ffmpeg.exe` and `ffprobe.exe` are larger than GitHub's regular file size limit for normal repositories.

## For local development

The app can fall back to `ffmpeg` and `ffprobe` from your system `PATH`.

## For building a self-contained installer

Place these files here before running:

```powershell
npm run tauri build
```

Expected files:

- `src-tauri/resources/bin/ffmpeg.exe`
- `src-tauri/resources/bin/ffprobe.exe`

## Helper script

If you already have FFmpeg installed and available in `PATH`, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stage-ffmpeg.ps1
```

That script copies `ffmpeg.exe` and `ffprobe.exe` into this folder.
