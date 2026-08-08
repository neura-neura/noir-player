import type { PlaybackEngine, PlaybackSource } from './playback-engine';

export interface PlaybackResolverOptions {
  readonly preferNative: boolean;
  readonly createNative: () => PlaybackEngine;
  readonly createBrowser: (engine: 'html-media' | 'hls-js' | 'ffmpeg-fallback') => PlaybackEngine;
  readonly onEngineChanged?: (previous: PlaybackEngine['id'] | null, next: PlaybackEngine['id'], reason: string) => void;
}

export interface ResolvedPlayback {
  readonly engine: PlaybackEngine;
  readonly fallbackReason: string | null;
}

/** Selects one authority for a session and degrades in place when native playback fails. */
export class PlaybackResolver {
  private active: PlaybackEngine | null = null;

  constructor(private readonly options: PlaybackResolverOptions) {}

  async load(source: PlaybackSource, forceFallback = false): Promise<ResolvedPlayback> {
    const previous = this.active?.id ?? null;
    const previousEngine = this.active;
    this.active = null;
    await previousEngine?.dispose().catch(() => undefined);
    const canTryNative =
      this.options.preferNative && !forceFallback && source.kind !== 'hls';
    if (canTryNative) {
      const native = this.options.createNative();
      try {
        await native.load(source);
        this.active = native;
        this.options.onEngineChanged?.(previous, native.id, 'native-selected');
        return { engine: native, fallbackReason: null };
      } catch (error) {
        await native.dispose().catch(() => undefined);
        const fallback = this.options.createBrowser('ffmpeg-fallback');
        await fallback.load(source);
        this.active = fallback;
        this.options.onEngineChanged?.(previous, fallback.id, 'native-init-or-load-failed');
        return { engine: fallback, fallbackReason: error instanceof Error ? error.message : 'native playback failed' };
      }
    }

    const browser = this.options.createBrowser(source.kind === 'hls' ? 'hls-js' : 'html-media');
    await browser.load(source);
    this.active = browser;
    this.options.onEngineChanged?.(previous, browser.id, forceFallback ? 'forced-fallback' : 'browser-selected');
    return { engine: browser, fallbackReason: forceFallback ? 'forced-fallback' : null };
  }

  getActive(): PlaybackEngine | null { return this.active; }

  async dispose(): Promise<void> {
    const active = this.active;
    this.active = null;
    await active?.dispose();
  }
}
