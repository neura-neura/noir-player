# Noir Player contributor instructions

Noir Player is a Tauri 2 + React 18 + TypeScript + Vite desktop player. Do not
use the old Next.js architecture described by historical files.

## Boundaries

- `src/player/core` owns serializable public snapshots and command semantics.
- `src/player/engines` owns `PlaybackEngine` adapters and engine selection.
- `src/player/adapters` owns Tauri invocation, native surface margins/redraw,
  fullscreen, and window lifecycle. Plugins never receive `invoke`, window
  handles, libmpv init/destroy, or surface margins.
- `src/plugins/runtime` owns selection, dynamic loading, SemVer validation,
  grants, dependencies, lifecycle, diagnostics, cleanup, and registries.
- `src/plugins/ui` owns React provider, nominal slots, and contribution error
  boundaries.
- `packages/plugin-api` is the only supported import surface for plugin authors.
  First-party plugins must not import `src/**`, Tauri, libmpv, Plyr, or Hls.js.
- `src/App.tsx` is being migrated incrementally. Add characterization tests and
  move one authority at a time; do not perform a blind rewrite.

Plugins are reviewed same-WebView code, not sandboxed code. Selection is
explicit in `noir.plugins.config.ts`; loaders are literal dynamic imports.
`native.mpv.raw` requires a host grant plus an explicit risk acknowledgement and
permits arbitrary mpv names, so it must be visible in diagnostics and tests.

## Required verification

```powershell
npm ci
npm run typecheck
npm run check:boundaries
npm run lint
npm test
npm run test:coverage
npm run build
npm run check:rust
npm run test:e2e
```

Use `npm run check` for the frontend sequence. Run `npm run create-plugin --
my-plugin --dry-run` before generating a scaffold. Do not use `git reset --hard`,
`git checkout --`, force-pushes, or commits for implementation tasks.

## Native playback

libmpv remains the desktop primary engine. Browser/Plyr/Hls.js and FFmpeg
fallbacks must preserve the public source/session/command/event contract. Keep
`init`/`destroy`, window handles, and native surface ownership in the host.
When changing native behavior, test resize, fullscreen transitions, controls,
captions, fallback, and cleanup. `setup-lib` stages DLLs; it is not a plugin
installer.

## Privacy and safety

Do not put local paths, subtitle text, tokens, or stacks in public snapshots,
diagnostics, telemetry, or user-facing errors. Do not add remote code, `eval`,
`new Function`, runtime plugin downloads, or arbitrary Tauri command exposure.
The loopback Syncplay server must stay loopback-only.
