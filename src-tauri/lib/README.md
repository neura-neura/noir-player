# Native libmpv runtime

Noir Player uses `tauri-plugin-libmpv` for desktop playback so codecs such as
HEVC/H.265 are decoded by mpv instead of WebView2.

The DLLs in this directory are downloaded locally and ignored by Git because
they are large runtime artifacts. Set up and verify all native artifacts after
cloning with:

```powershell
npm run stage:native
npm run verify:native
```

The command installs the architecture-matched `libmpv-wrapper.dll` and
`libmpv-2.dll` files here, stages FFmpeg/FFprobe, and checks every file against
`scripts/native-runtime-manifest.json`. The Tauri bundle includes this
directory as a runtime resource.

The exact archive, architecture, hashes, license review, and update policy for
the current development setup are recorded in
`docs/architecture/native-runtime-audit.md`. Do not treat this command as a
runtime plugin installer. A hash mismatch stops the staging flow and requires
an intentional manifest update.
