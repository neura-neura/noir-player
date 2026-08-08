# Plugin security and trust

Plugins share the host WebView origin, DOM, and JavaScript process. The runtime
facades reduce accidental coupling and expose grants in diagnostics, but they
cannot contain malicious same-WebView JavaScript. The built-in selection and
the Plugin manager's GitHub entries are both cooperative trust mechanisms.

This checkout is intended for personal use, so the owner may deliberately trust
plugins with broad capabilities. The explicit grant and risk acknowledgement
still remain in the manifest selection because they make that control visible
and prevent accidental raw mpv access during development.

## Capability policy

`player.read` exposes readonly snapshots/events; `player.control` exposes core
commands; `ui.contribute`, `commands.contribute`, `services.*`, `storage`,
`telemetry`, and `network` are explicit independent grants. `native.media-read`
is metadata-only. `native.mpv.read` exposes reads/observers. `native.mpv.raw`
also exposes arbitrary command/property names and requires a host
`riskAcknowledgements` entry. `unsafe.dom` is unstable and not granted by
default.

The manifest can request capabilities but cannot grant them or choose trust.
The host selection grants capabilities and validates that grants were requested.
Missing grants fail at the call boundary with `PluginPermissionError`.

## Native/Tauri boundary

Plugins do not receive raw `invoke`, `listen`, `App`, WebView/window handles,
libmpv init/destroy, internal instances, or `setVideoMarginRatio`. The
`MpvPluginFacade` broker validates names and serializable payloads, rejects
operations after cleanup or on fallback, and emits redacted local audit
records. It intentionally has no semantic mpv allowlist after `native.mpv.raw`
is granted because new mpv features must remain reachable.

Tauri capabilities apply to the shared `main` WebView and are not a plugin
sandbox. The current `libmpv:default` permission and broad asset scope are
host-level product requirements and are documented in the ADR. The CSP allows
only the GitHub API/raw hosts used by the manager, local assets, IPC, loopback
HLS/Syncplay, development HMR, and the optional font CDN. GitHub entries must
be HTTPS, publish `noir.plugin.json`, use a bundled ESM entry, and are disabled
until the user enables them. SHA-256 integrity is supported and checked when
declared.

## Data handling

Public snapshots use display names, not paths. Logs/diagnostics redact paths,
URLs, query secrets, subtitle/cue text, and raw values. Local telemetry is
bounded and opt-in for plugin calls; no remote sink exists in v1. Plugin storage
is namespaced and not a secret vault.

Before selecting third-party code, review provenance, license, install scripts,
transitive dependencies, imports, network/filesystem behavior, grants, bundle
weight, React peer dependencies, and failure/cleanup behavior.
