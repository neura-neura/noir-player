# `@noir-player/plugin-playback-stats`

The first-party plugin validates the public Noir Player plugin contract. It
uses player snapshots, coalesced playback events, the core command bus,
namespaced storage, settings, telemetry, and React slots. It deliberately does
not request native mpv access, so it behaves identically on browser preview,
libmpv, and fallback engines.
