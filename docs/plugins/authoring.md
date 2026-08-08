# Plugin authoring quickstart

Noir Player plugins are reviewed TypeScript packages selected at build time.
They run in the same WebView as the host, so capabilities are an auditable
contract, not a security sandbox.

## GitHub installation format

The Plugin manager accepts a repository URL when the repository contains a
`noir.plugin.json` file. The descriptor has this shape:

```json
{
  "manifest": { "id": "example.my-plugin", "name": "My plugin", "version": "1.0.0", "apiVersion": "^1.0.0", "description": "…", "license": "MIT", "requestedCapabilities": [] },
  "entry": "dist/index.js",
  "integrity": "sha256:<64 hexadecimal characters>"
}
```

`entry` must be a bundled, self-contained ESM module whose default export is
the plugin module. Imports such as `@noir-player/plugin-api` must be bundled
before publishing; the runtime does not resolve arbitrary package imports.
GitHub plugins are installed disabled, and permission changes apply after a
restart.

## Create a package

```powershell
npm run create-plugin -- my-plugin --dry-run
npm run create-plugin -- my-plugin
```

The generator refuses to overwrite an existing directory and creates a package,
public-SDK entry point, README, and test under `packages/plugin-my-plugin/`.
Use a lowercase `namespace.name` plugin ID with letters, digits, and hyphens.
Versions are exact SemVer and `apiVersion` is a SemVer range.

## Select it

Add a literal loader to `noir.plugins.config.ts`:

```ts
{
  id: 'example.my-plugin',
  loader: () => import('@noir-player/plugin-my-plugin'),
  grants: ['player.read', 'ui.contribute'],
  trust: 'reviewed-third-party',
}
```

The host grants only capabilities requested by the manifest. Disabled selections
are visible as disabled diagnostics and their loaders are not invoked. A plugin
that is not in the selection list is not in the runtime registry.

## Lifecycle and cleanup

`setup` receives validated config and a scoped context. Register every listener,
timer, contribution, command, service, and custom abort controller with
`context.resources`. The runtime aborts the scope before `stop`, removes
contributions in reverse order, and calls `dispose` once.

Use `context.player` and `context.events` for portable playback state. Use the
core command bus for play/pause/seek/rate/volume. Do not access the internal
`<video>`, Plyr, Tauri, native surface, or mpv package directly.

## UI, accessibility, and i18n

Contribute React components to documented slots with a stable ID such as
`example.my-plugin/status`. Components receive a readonly public snapshot.
Use semantic buttons and labels, keyboard focus, visible focus rings, and host
theme tokens. Register namespaced translations through `context.i18n` and
provide English fallback messages.

## Configuration and storage

Config parsers receive `unknown` and must validate without casts as a substitute
for validation. The host merges defaults, build selection config, and persisted
config shallowly, then parses atomically. `context.storage` is prefixed by plugin
ID and stores `{ schemaVersion, value }`; it is not a secret store.

## Native mpv (advanced and non-portable)

Request `native.mpv.read` for `isAvailable`, property reads, observers, and event
listeners. Requesting `native.mpv.raw` additionally enables arbitrary
`context.mpv.command(name, args)` and `setProperty(name, value)`, but selection
must include:

```ts
grants: ['native.mpv.read', 'native.mpv.raw'],
riskAcknowledgements: ['native.mpv.raw'],
```

The broker validates serializability, size, non-empty names, active libmpv
engine, and cleanup, and records redacted audits. A valid raw operation may
break playback and is not portable to browser fallback. It never grants
`invoke`, mpv init/destroy, window handles, or video margins.
