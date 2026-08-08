# Plugin API catalog

The public exports live in `@noir-player/plugin-api`.

## Contract

- `NOIR_PLUGIN_API_VERSION = '1.0.0'`.
- `definePlugin`, `defineNoirPlugins`, and `createServiceToken` are pure helpers.
- `NoirPluginManifest`, `PluginSelection`, `NoirPluginContext`, and
  `NoirPluginInstance` define module, trust, grants, config, lifecycle, and
  cleanup.
- Stable errors include manifest, compatibility, dependency, config, permission,
  lifecycle, command, hook-timeout, mpv-unavailable, and mpv-operation codes.

## Events

Core event names are typed and read-only: `host:ready`, `host:disposing`,
`plugin:state-changed`, `media:opening`, `media:engine-changed`,
`media:source-changed`, `media:loaded-metadata`, `media:ready`,
`media:play`, `media:pause`, `media:time-update`, `media:seeking`,
`media:seeked`, `media:rate-change`, `media:volume-change`, `media:ended`,
`media:error`, subtitle/playlist events, panel/fullscreen/control visibility,
and locale changes. Playback time is coalesced to at most 4 Hz by default.

## Hooks

The implemented seams are `media:before-open`, `media:resolve-source`,
`media:before-play`, `media:before-seek`, `subtitle:before-load`,
`subtitle:after-parse`, `player:select-engine`, and
`player:configure-engine`. Hooks are ordered, abortable, bounded by a host
deadline, and do not masquerade as events. Security-validation hooks fail
closed; decoration/selection hooks fail open.

## Commands

Core commands include `media.open/play/pause/toggle/seekTo/seekBy/setRate/`
`setVolume/setMuted/retryWithFallback`, fullscreen, subtitle, playlist, panel,
and notice operations. Plugin commands must be namespaced
`plugin-id.command-name`, have `commands.contribute`, and return a cleanup.

## Slots

`app.header.actions`, `app.hero.actions`, `stage.info`, `stage.actions`,
`player.before-media`, `player.overlay`, `player.controls.left`,
`player.controls.right`, `player.dock`, `panel.tabs`, `panel.content`,
`settings.sections`, and `notifications` are host-owned React containers.
Order is numeric, then plugin ID, then contribution ID. A contribution failure
renders a compact status inside its slot and does not cover the player.

## Services

Use nominal `ServiceToken<T>` values with a SemVer version. Base services include
player diagnostics, logger, storage, i18n, telemetry, engine diagnostics, and
the brokered mpv facade. Services are removed with their provider's resource
scope.
