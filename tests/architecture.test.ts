import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('plugin architecture boundaries', () => {
  it('keeps first-party plugins on public SDK imports', async () => {
    const source = await readFile('packages/plugin-playback-stats/src/index.tsx', 'utf8');
    expect(source).not.toMatch(/from\s+['"].*\/src\//);
    expect(source).not.toContain('tauri-plugin-libmpv-api');
    expect(source).not.toContain('@tauri-apps');
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toMatch(/new\s+Function\s*\(/);
  });

  it('keeps plugin API free of runtime/browser imports', async () => {
    const source = await readFile('packages/plugin-api/src/index.ts', 'utf8');
    expect(source).not.toContain('@tauri-apps');
    expect(source).not.toContain('tauri-plugin-libmpv-api');
    expect(source).not.toContain('window.');
    expect(source).not.toContain('document.');
  });

  it('keeps native resource staging and desktop HLS routing explicit', async () => {
    const staging = await readFile('scripts/stage-ffmpeg.ps1', 'utf8');
    const nativeStaging = await readFile('scripts/stage-native-runtime.ps1', 'utf8');
    const nativeManifest = await readFile('scripts/native-runtime-manifest.json', 'utf8');
    const buildScript = await readFile('src-tauri/build.rs', 'utf8');
    const tauriConfig = await readFile('src-tauri/tauri.conf.json', 'utf8');
    const appSource = await readFile('src/App.tsx', 'utf8');
    const mainSource = await readFile('src/main.tsx', 'utf8');
    const viteConfig = await readFile('vite.config.ts', 'utf8');
    const bundleCheck = await readFile('scripts/check-bundle-size.mjs', 'utf8');
    expect(staging).toContain('shims');
    expect(staging).toContain('current\\bin');
    expect(staging).toContain('SourceDirectory');
    expect(nativeStaging).toContain('tauri-plugin-libmpv-api setup-lib');
    expect(nativeStaging).toContain('[System.Security.Cryptography.SHA256]::Create()');
    expect(nativeManifest).toContain('libmpv-2.dll');
    expect(nativeManifest).toContain('ffmpeg.exe');
    expect(buildScript).toContain('resources/bin/ffmpeg.exe');
    expect(buildScript).toContain('resources/bin/ffprobe.exe');
    expect(tauriConfig).toContain('http://127.0.0.1:*');
    expect(mainSource).toContain("lazy(() => import('./App'))");
    expect(mainSource).toContain("import('./app/plugin-system')");
    expect(viteConfig).toContain('codeSplitting');
    expect(bundleCheck).toContain('500 * 1024');
    expect(appSource.indexOf('shouldUseStreamingPlayback(fileName)')).toBeLessThan(
      appSource.indexOf('if (isDesktopApp())', appSource.indexOf('async function openVideoFromPath')),
    );
  });

  it('lets native playback controls hide even when a control keeps focus', async () => {
    const styles = await readFile('src/styles.css', 'utf8');
    expect(styles).toContain('.player-frame.playback-controls-visible .native-control-bar');
    expect(styles).not.toContain('.native-control-bar:focus-within');
  });
});
