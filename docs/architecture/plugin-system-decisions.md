# Plugin system decisions

Status: accepted for Noir Player 0.1.12 / plugin API 1.0.0.

## Decisions

| ID | Decision | Status and evidence |
|---|---|---|
| D-001 | Plugins are reviewed, same-WebView modules with explicit host selection. | Accepted. `noir.plugins.config.ts` supplies built-ins and the Plugin manager persists reviewed GitHub descriptors. Remote entries are HTTPS-only, disabled by default, integrity-checkable, and still cooperative rather than sandboxed. |
| D-002 | Plugins receive a stable `NoirPluginContext`, never `App`, refs, setters, or raw `invoke`. | Accepted. Runtime creates scoped player, event, command, UI, service, storage, logger, telemetry, and mpv facades. |
| D-003 | `@noir-player/plugin-api` is a small workspace package. | Accepted. `packages/plugin-api` has independent package metadata, exports, README, and no runtime/browser/Tauri imports. |
| D-004 | Runtime implementation stays in `src/plugins/runtime`. | Accepted. API types do not import host internals; runtime owns loading and lifecycle. |
| D-005 | Selection is explicit and lazy. | Accepted. Literal dynamic import of `@noir-player/plugin-playback-stats` produces `dist/assets/src-*.js`; the plugin body is absent from the initial chunk. |
| D-006 | External player store plus command bus and engine seam. | Accepted. `PlayerStore`, `CommandBus`, `PlaybackEngine`, `PlaybackResolver`, and `useAppPluginBridge` are incremental seams. `App.tsx` still owns legacy media behavior while each migrated action is routed through the bus. |
| D-007 | UI uses nominal React slots. | Accepted. `PluginSlot` sorts by order, plugin ID, and contribution ID and gives each contribution its own error boundary. |
| D-008 | Lifecycle is `setup -> start -> stop -> dispose` with resource scope and abort. | Accepted. Stop is reverse-order/idempotent, abort happens before stop, and scope cleanup runs after callback failures. |
| D-009 | SemVer ranges are validated with the `semver` package. | Accepted. API, app, plugin, dependency, and service ranges are not compared as strings. |
| D-010 | Native extensions are compile-time Tauri dependencies. | Accepted. No runtime Rust/DLL loading was added. Existing libmpv remains a host adapter with `libmpv:default` capability. |
| D-011 | Failures are isolated. | Accepted. Runtime diagnostics, lifecycle cleanup, hook policy, and per-contribution error boundaries keep core playback available. |
| D-012 | First-party dogfooding uses only public API. | Accepted. `plugin-playback-stats` passes the architecture boundary check; `plugin-mpv-lab` is a non-selected fixture. |
| D-013 | Migration is vertical and characterized. | Accepted. Subtitle behavior, snapshot, engine, surface, command, event, and UI tests precede new seams. The remaining App extraction is intentionally incremental. |
| D-014 | Telemetry is local and redacted by default. | Accepted. Runtime keeps bounded local telemetry and logger redaction; no network sink is provided. |
| D-015 | Engine and native surface are separate. | Accepted. `PlaybackEngine` normalizes libmpv/browser events while `NativeSurfaceCoordinator` alone applies margins/redraw/transition state. |
| D-016 | `native.mpv.raw` is an explicit unsafe escape hatch. | Accepted. `native.mpv.read` gates reads/observers; `native.mpv.raw` additionally gates arbitrary command/property names and requires host `riskAcknowledgements`. No semantic allowlist is used. |
| D-017 | User-level plugin administration. | Accepted. The host persists enablement, GitHub sources, grants, and risk acknowledgements; lifecycle toggles clean resources immediately, while new source code and permission changes apply after restart. |

## Deliberate deviations and consequences

- The existing `App.tsx` is not deleted in one pass. Its current libmpv/Plyr/Hls,
  subtitle, Syncplay, and fullscreen paths are characterized and connected to
  the new public bridge first. This lowers regression risk but leaves more host
  code during the transition.
- The Tauri bundle references the `resources/bin` directory rather than naming
  absent `ffmpeg.exe`/`ffprobe.exe` files. This makes `cargo test` and Tauri
  validation reproducible on a checkout without staged large binaries; staging
  those files still bundles them from the same directory.
- The asset protocol scope remains `**` because arbitrary user-selected local
  video paths are a product feature. The risk is documented and not delegated
  to plugins; future file-token mediation can narrow it.
- `.ts`/`.m2ts` paths are routed through the host-owned loopback HLS server
  before the normal browser Hls.js path. Other desktop local files continue
  through libmpv first; the HLS server remains loopback-only.
- The CSP permits the existing local assets, Tauri IPC, loopback HLS/Syncplay,
  GitHub API/raw hosts for the manager, Vite development WebSocket, and
  optional jsDelivr font stylesheet. A packaged Windows smoke test with actual
  WebView2/libmpv/DLLs remains environment-bound.

## Rejected alternatives

- An arbitrary remote script or directory loader remains rejected; GitHub
  installation is limited to the descriptor plus self-contained ESM contract,
  HTTPS allowlist, explicit grants, optional integrity, and disabled-by-default
  activation.
- Passing `App` or a DOM/native surface ref would make React and libmpv
  implementation details the accidental API and would prevent fallback parity.
- A closed mpv command/property allowlist would block shaders, filters, tracks,
  profiles, and new mpv features. Raw names are therefore accepted only behind
  the explicit grant and risk acknowledgement, with transport validation and
  audit logging.
