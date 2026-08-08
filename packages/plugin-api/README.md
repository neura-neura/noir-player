# @noir-player/plugin-api

The public Noir Player plugin contract. It contains serializable types, lifecycle
helpers, capability names, event/command maps, and stable error classes. It does
not import Tauri, libmpv, Plyr, Hls.js, or host internals.

Plugins are reviewed JavaScript bundled into the same WebView as Noir Player.
Capabilities reduce coupling and make intent auditable; they are not a sandbox
for untrusted code.

The current API is `1.0.0`. Breaking changes require a major version. See the
authoring documentation under `docs/plugins/` for the host selection and grant
flow.
