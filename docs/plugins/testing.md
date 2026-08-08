# Plugin testing

Run the reproducible frontend checks from the repository root:

```powershell
npm ci
npm run typecheck
npm run check:boundaries
npm run lint
npm test
npm run test:coverage
npm run test:e2e
npm run build
npm run check:rust
```

`@noir-player/plugin-test-utils` provides a public-contract fake player,
event bus, storage, logger, mpv facade, and cleanup assertion. It does not
import the production runtime, so a plugin test cannot pass merely by sharing
runtime internals.

Test at least:

- manifest/ID/config validation and SemVer compatibility;
- selected, disabled, absent, lazy, incompatible, dependent, optional, and
  cyclic modules;
- setup/start/stop/dispose order, abort, idempotence, thrown callbacks, and
  resource counts;
- event payload/session ordering, coalesced time, hook allow/cancel/replace,
  timeout, reentry, command validation, and service versioning;
- slot order, keyboard/ARIA behavior, contribution error isolation, and focus;
- missing grants, raw mpv acknowledgement, redaction, fallback unavailable
  errors, and cleanup;
- browser preview plus a Windows Tauri smoke test with libmpv DLLs staged when
  the environment provides WebView2/FFmpeg/libmpv.

For `mpv-lab`, first activate it with no grants and assert a typed permission
failure. Then grant `native.mpv.read` and `native.mpv.raw` plus the risk
acknowledgement, assert arbitrary `getProperty`, observer, event, command, and
`setProperty`, dispose, and assert no listeners remain. Force browser fallback
and assert `MpvUnavailableError` rather than silent HTML redirection.
