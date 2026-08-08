# Noir Player

Noir Player is a Windows-first desktop video player built with Tauri 2,
React 18, TypeScript, Vite, native libmpv, Plyr/Hls.js browser fallback, and
FFmpeg/FFprobe compatibility tools. The core player works with no plugins
selected.

## Playback

- Native libmpv is the primary desktop engine for HEVC and high bit-depth media.
- HTMLMediaElement/Plyr/Hls.js and the FFmpeg-prepared source are the fallback
  path when native initialization or loading fails. `.ts`/`.m2ts` files use
  the host-owned loopback HLS server; ordinary desktop files remain on libmpv.
- React controls, captions, playlist, embedded subtitle/audio selection,
  fullscreen, resize, and Syncplay operate above the selected engine.
- Local paths stay in host-only code. Public plugin snapshots expose a display
  name, source kind, engine, and playback state instead.

## Plugin system

Plugins run in the same WebView as the host. The runtime is capability-gated
and auditable, but this is not a sandbox for hostile code. The Plugin manager
can toggle built-in plugins and install reviewed GitHub repositories that
publish a `noir.plugin.json` descriptor plus a self-contained ESM entry.

The explicit build-time selection lives in
[`noir.plugins.config.ts`](noir.plugins.config.ts). A loader such as
`() => import('@noir-player/plugin-playback-stats')` is lazy and creates a
separate Vite chunk. Removing the selection removes plugin execution and keeps
the core player usable.

For a core-only smoke, set `VITE_NOIR_DISABLE_PLUGINS=1` for the Vite/Tauri
process; the normal selection remains unchanged.

Open `Plugin manager` in the header to enable or disable plugins, review
requested permissions, remove GitHub plugins, and add a repository URL. New
GitHub entries start disabled and require a restart after installation or
permission changes. Third-party entries are fetched only from HTTPS GitHub
raw content, can declare a SHA-256 integrity digest, and never receive raw
Tauri or host internals.

The first-party `@noir-player/plugin-playback-stats` package demonstrates
events, snapshots, the core command bus, UI slots, config, namespaced storage,
settings, telemetry, and cleanup. `@noir-player/plugin-mpv-lab` is a non-selected
fixture for testing `native.mpv.read` and the deliberately high-risk
`native.mpv.raw` escape hatch. Raw access requires both a host grant and
`riskAcknowledgements: ['native.mpv.raw']`; it accepts arbitrary mpv command
and property names and can disrupt playback.

Public authoring documentation is in [`docs/plugins/authoring.md`](docs/plugins/authoring.md),
with the API, security, testing, and example guides beside it.

## Development commands

```powershell
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:unit
npm run test:integration
npm run test:components
npm run test:contracts
npm run test:coverage
npm run test:e2e
npm run build
npm run check:rust
npm run check
```

`npm run check` runs the frontend/workspace boundary checks, lint, tests, and
production build. `npm run check:rust` runs `cargo fmt --check`, clippy with
`-D warnings`, and Rust tests. `npm run tauri dev` runs the desktop shell;
`npm run tauri build` creates the installer.

For a self-contained Windows build, stage and hash the complete native runtime
(libmpv DLLs plus FFmpeg/FFprobe) with one command:

```powershell
npm run stage:native
npm run verify:native
```

The native staging manifest at
[`scripts/native-runtime-manifest.json`](scripts/native-runtime-manifest.json)
pins the expected Windows x86_64 SHA-256 values. The helper resolves Scoop
shims to the real FFmpeg executables, runs
`tauri-plugin-libmpv-api setup-lib` for the matching libmpv DLLs, and fails on
missing or unexpected artifacts. If FFmpeg is not on `PATH`, pass an installed
directory with `-FfmpegDirectory`; the DLLs and executables remain ignored
because they are large generated runtime artifacts, but a clean checkout can
recreate and verify them deterministically.

## Project structure

```text
noir-player/
├─ packages/
│  ├─ plugin-api/                 @noir-player/plugin-api
│  ├─ plugin-test-utils/          public-contract fakes and assertions
│  ├─ plugin-playback-stats/      first-party vertical plugin
│  └─ plugin-mpv-lab/             non-selected mpv capability fixture
├─ src/
│  ├─ app/                        host bootstrap and runtime wiring
│  ├─ player/
│  │  ├─ core/                    snapshots, command bridge, seams
│  │  ├─ engines/                 PlaybackEngine adapters and resolver
│  │  └─ adapters/                NativeBridge and surface coordinator
│  ├─ plugins/runtime/             loader, lifecycle, grants, registries
│  ├─ plugins/ui/                  provider, nominal slots, boundaries
│  ├─ App.tsx                      legacy UI being migrated by vertical seams
│  └─ lib/subtitles.ts             subtitle parser/sanitizer
├─ src-tauri/                     Rust/Tauri commands and libmpv integration
├─ noir.plugins.config.ts         explicit lazy plugin selection
└─ tests/                          unit, contract, component, integration, E2E
```

## Existing media features

Noir Player supports local file association, drag-and-drop, SRT/VTT/ASS/SSA
and ZIP subtitles, embedded text subtitles/audio tracks, persistent subtitle
styling, English/Spanish/Chinese UI, and loopback-only Syncplay control on
`127.0.0.1:32123`. ASS/SSA is rendered as a sanitized basic text overlay, so
advanced positioning and karaoke effects are not preserved.

## Security notes

The Tauri CSP explicitly lists local assets, IPC, loopback HLS/Syncplay, Vite
development HMR, and the existing optional jsDelivr font stylesheet. The asset
scope remains broad because users can open arbitrary local files; this is a
documented host risk, not a plugin privilege. Tauri capabilities apply to the
shared `main` WebView and do not sandbox one JavaScript module from another.

See [`docs/architecture/plugin-system-decisions.md`](docs/architecture/plugin-system-decisions.md)
and [`docs/plugins/security.md`](docs/plugins/security.md) for the trust model,
capabilities, raw mpv audit, DLL staging, redaction, and future isolation path.

## License

See [`LICENSE`](LICENSE).
