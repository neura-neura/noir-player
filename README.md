# Noir Player

<p align="center">
  <img src="public/icon.png" alt="Noir Player logo" width="180" />
</p>

Noir Player is a Windows desktop video player built with Tauri, React, TypeScript, and Plyr.

It focuses on local playback with a workflow that is especially useful when you need:

- file association support (`Open with Noir Player`)
- manual subtitle loading
- embedded subtitle selection
- embedded audio track switching
- persistent subtitle styling and sync controls
- DevTools access for inspecting the subtitle layer

## Highlights

- Open local videos from the app or from Windows file association.
- Drag and drop videos and subtitle files into the app.
- Load external subtitles from `.srt`, `.vtt`, `.ass`, `.ssa`, and `.zip`.
- Select embedded subtitle tracks detected from the video container.
- Select embedded audio tracks and use automatic fallback for codecs the WebView may not play natively.
- Adjust subtitle offset, font, size, weight, colors, opacity, position, width, padding, radius, line height, and letter spacing.
- Keep preferences persisted across app restarts.
- Switch the UI between English, Spanish, and Chinese.
- Open DevTools with the built-in button or `Ctrl + Shift + I`.

## Current Subtitle Support

### External subtitles

- `.srt`
- `.vtt`
- `.ass`
- `.ssa`
- `.zip` containing `.srt`, `.vtt`, `.ass`, or `.ssa`

### Embedded subtitles

- Text subtitle tracks that `ffmpeg` can extract and convert to WebVTT
- Basic support for `ASS/SSA`

### Important limitation for `ASS/SSA`

`ASS/SSA` subtitles are currently converted to a basic text overlay.

That means:

- text and timing are preserved
- advanced ASS positioning is not preserved
- karaoke effects are not preserved
- complex animation is not preserved
- custom ASS drawing/vector effects are not preserved

## Current Audio Support

- Detects embedded audio tracks from the container
- Supports switching between detected audio tracks
- Uses bundled `ffmpeg` / `ffprobe` as fallback for codecs that the WebView may not decode directly, including common cases such as `EAC3`

## Tech Stack

- Tauri 2
- React 18
- TypeScript
- Vite
- Plyr
- Rust
- FFmpeg / FFprobe bundled with the desktop build
  - not committed to GitHub because the Windows binaries exceed GitHub's regular file size limit

## Requirements

### For running the packaged app

- Windows 10 or Windows 11
- Microsoft Edge WebView2 Runtime

### For local development

- Node.js 20+ recommended
- npm
- Rust stable toolchain
- Visual Studio Build Tools for Rust/Tauri on Windows
- WebView2 Runtime

Official setup references:

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Rust installation](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/)

## Project Structure

```text
simplevideoplayer/
├─ public/                  Static assets and bundled web font assets
├─ src/                     React frontend
│  ├─ i18n/                 Modular translations
│  └─ lib/                  Subtitle parsing and helpers
├─ src-tauri/               Rust/Tauri desktop layer
│  ├─ icons/                App icons
│  ├─ resources/bin/        Bundled ffmpeg.exe and ffprobe.exe
│  └─ src/                  Native commands and app bootstrap
├─ package.json
└─ README.md
```

## Install Dependencies

```bash
npm install
```

## FFmpeg Setup

For local development, Noir Player can use `ffmpeg` and `ffprobe` from your system `PATH`.

If you want to build a self-contained installer that bundles those binaries inside the app, you need to stage them into:

```text
src-tauri/resources/bin/
```

Expected files:

- `src-tauri/resources/bin/ffmpeg.exe`
- `src-tauri/resources/bin/ffprobe.exe`

If FFmpeg is already installed and available in `PATH`, you can copy both binaries into the project with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stage-ffmpeg.ps1
```

If you skip this step:

- `npm run tauri dev` can still work as long as `ffmpeg` and `ffprobe` are available in `PATH`
- a fully self-contained Windows installer will not bundle those executables automatically

## Run in Development

```bash
npm run tauri dev
```

This starts:

- the Vite frontend
- the Tauri desktop shell
- the desktop window for Noir Player

## Build the Installer

```bash
npm run tauri build
```

Before building a portable/self-contained installer, make sure the FFmpeg staging step above has been completed.

Typical output files are generated under:

```text
src-tauri/target/release/bundle/nsis/
src-tauri/target/release/bundle/msi/
```

Examples:

- `Noir Player_0.1.0_x64-setup.exe`
- `Noir Player_0.1.0_x64_en-US.msi`

## How to Use

### Open a video

You can open a video in any of these ways:

- launch Noir Player and click `Open video`
- drag a video into the window
- right click a compatible video in Windows and use `Open with Noir Player`

### Load subtitles

You can:

- drag an external subtitle file into the app
- click `Load subtitles`
- choose an embedded subtitle track from the subtitle panel

### Change audio tracks

If the container has multiple audio tracks:

- open the subtitle/load panel
- look for the audio track list
- click the track you want to hear

### Inspect subtitle styling

Use:

- the `Inspect` button
- or `Ctrl + Shift + I`

The main rendered subtitle element is:

```text
.caption-text
```

## Persistence

The app persists user preferences such as:

- selected language
- subtitle style settings
- font configuration
- open behavior preferences
- window size and position
- optional remembered subtitle offset

## Fonts

The app supports:

- installed system fonts
- a bundled local Gotham Pro stylesheet by default
- loading a custom remote CSS font stylesheet manually

The default bundled Gotham Pro stylesheet is stored locally in:

```text
public/vendor/gotham-pro-font/
```

## File Associations

The installer registers common video file associations so the player can be selected from Windows `Open with`.

Formats currently configured include:

- `.mp4`
- `.mkv`
- `.avi`
- `.mov`
- `.m4v`
- `.webm`
- `.ts`
- `.m2ts`
- `.wmv`
- `.flv`

## No API Keys Required

This project does not require API keys to run.

The repository should not contain API keys, tokens, passwords, or local secret files.

## Known Limitations

- Advanced `ASS/SSA` styling is not fully preserved.
- Some codecs may require the bundled ffmpeg-based fallback path before audio becomes available.
- The project is currently oriented to Windows desktop usage.

## Troubleshooting

### The video opens but there is no sound

- Try switching audio tracks from the panel.
- If the track uses a codec such as `EAC3`, the app may prepare a compatible fallback track first.
- Wait a moment after opening a large file so the bundled audio fallback can prepare in the background.

### Embedded subtitles are detected but do not look identical to the source

- That is expected for `ASS/SSA`.
- The current implementation keeps timing and text, but not full ASS visual behavior.

### DevTools does not open

- Use the in-app `Inspect` button.
- If needed, try `Ctrl + Shift + I`.

## Development Notes

- Frontend source lives in [src](src).
- Native desktop logic lives in [src-tauri/src](src-tauri/src).
- Translations are modular inside [src/i18n](src/i18n).
- Bundled ffmpeg tools live in [src-tauri/resources/bin](src-tauri/resources/bin).
- The repo does not store `ffmpeg.exe` / `ffprobe.exe` directly because GitHub rejects files larger than 100 MB in a normal repo.

## License

See [LICENSE](LICENSE).
