# Native libmpv runtime

Noir Player uses `tauri-plugin-libmpv` for desktop playback so codecs such as
HEVC/H.265 are decoded by mpv instead of WebView2.

The DLLs in this directory are downloaded locally and ignored by Git because
they are large runtime artifacts. Set them up after cloning with:

```powershell
npx tauri-plugin-libmpv-api setup-lib
```

The command installs the architecture-matched `libmpv-wrapper.dll` and
`libmpv-2.dll` files here. The Tauri bundle includes this directory as a
runtime resource.
