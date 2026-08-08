# playback-stats example

`@noir-player/plugin-playback-stats` is the portable first-party example. Its
manifest requests only player read/control, UI, command, storage, and local
telemetry capabilities; it does not request mpv access.

The setup registers coalesced playback listeners, a namespaced toggle command,
four nominal contributions (`stage.info`, `player.dock`, `player.overlay`, and
`settings.sections`), a validated `sampleIntervalMs` setting, and namespaced
visibility persistence. The dock button calls
`context.commands.executePlugin('noir.playback-stats.toggle')`; it never calls
the `<video>` element or libmpv.

The same code observes `PlayerSnapshot.media.engine`, so it reports `libmpv`,
`html-media`, or `hls-js` without importing backend APIs. Runtime tests cover a
forced setup failure and assert that host cleanup removes UI, listeners, timers,
and commands.
