# Native runtime audit

The frontend package is `tauri-plugin-libmpv-api` 0.3.2 and the Rust plugin is
`tauri-plugin-libmpv` 0.3.2. They remain compile-time host dependencies; no
plugin can load a DLL dynamically.

On 2026-08-07 this checkout ran:

```powershell
npx tauri-plugin-libmpv-api setup-lib
```

The tool reported:

- `libmpv-wrapper-windows-x86_64.zip`, extracted to `libmpv-wrapper.dll`;
- `mpv-dev-lgpl-x86_64-20260807-git-dd5d17d328.7z`, extracted to
  `libmpv-2.dll`;
- detected target `windows (x86_64)`.

Observed local SHA-256 hashes, checked into the staging manifest at
[`scripts/native-runtime-manifest.json`](../../scripts/native-runtime-manifest.json),
for release review:

| File | SHA-256 |
|---|---|
| `libmpv-2.dll` | `2F94499979A213321C7E80E7BD597313CB4F5A381095B2C7D47DC1D27684B3E3` |
| `libmpv-wrapper.dll` | `0D5ADEAD5F175C55E0790A80924EC0A2636F72E3675C79A6D9D9568B2ED2384A` |
| `ffmpeg.exe` | `74DB6C184A03DBA2BDFE23E1A1F41CF5A8385BC1DE6A7A1B26DB1DC541ABEF93` |
| `ffprobe.exe` | `55BB6C6289367AE2383EFA86B26BF2596F8ADB72AC747360EB13DF162354161C` |

The files are ignored because of their size. The manifest pins the target,
source description, version, and SHA-256 values used by the local staging
flow. `libmpv` is LGPL in the selected mpv dev archive; the wrapper package
declares MPL-2.0. Legal review must confirm the redistribution notices for the
concrete archive. `npm run verify:native` is intentionally strict: a changed
upstream artifact stops the build preparation until the manifest is reviewed
and updated deliberately. The setup command is a developer preparation step,
not plugin installation.

Tauri bundles the `src-tauri/lib` resource directory. `src-tauri/build.rs`
copies the two DLLs to development output when present. A checkout without
staged DLLs still passes Rust unit/build validation and exercises the browser
fallback. A Windows release/smoke run with libmpv runs `npm run stage:native`
followed by `npm run verify:native` first, so a clean checkout has one
documented recovery path for all ignored native artifacts.
