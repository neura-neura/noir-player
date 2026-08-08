import type { Disposable } from '@noir-player/plugin-api';
import type {
  PlaybackEngine,
  PlaybackEngineEvent,
  PlaybackEngineId,
  PlaybackEngineSnapshot,
  PlaybackSource,
} from './playback-engine';

export interface BrowserMediaController {
  loadSource?(source: string): void;
  destroy?(): void;
}

export class BrowserPlaybackEngine implements PlaybackEngine {
  readonly id: PlaybackEngineId;
  readonly capabilities;
  private readonly listeners = new Set<(event: PlaybackEngineEvent) => void>();
  private readonly cleanup: Disposable[] = [];
  private readonly hlsController?: BrowserMediaController;
  private snapshot: PlaybackEngineSnapshot;
  private disposed = false;
  private source: PlaybackSource | null = null;

  constructor(
    private readonly element: HTMLMediaElement,
    options: { readonly id?: PlaybackEngineId; readonly hls?: BrowserMediaController } = {},
  ) {
    const videoElement = element as HTMLVideoElement;
    this.id = options.id ?? 'html-media';
    this.hlsController = options.hls;
    this.capabilities = Object.freeze({
      engine: this.id,
      nativeSurface: false,
      hls: this.id === 'hls-js',
      externalAudio: true,
      subtitles: true,
    });
    this.snapshot = {
      engine: this.id,
      status: 'idle',
      currentTime: 0,
      duration: null,
      rate: element.playbackRate || 1,
      volume: element.volume,
      muted: element.muted,
      videoSize: null,
    };
    this.bind('loadedmetadata', () => {
      this.snapshot = {
        ...this.snapshot,
        status: 'ready',
        duration: Number.isFinite(element.duration) ? element.duration : null,
        videoSize: videoElement.videoWidth > 0 && videoElement.videoHeight > 0
          ? { width: videoElement.videoWidth, height: videoElement.videoHeight }
          : null,
      };
      this.emit({ type: 'loaded-metadata', duration: this.snapshot.duration, width: videoElement.videoWidth, height: videoElement.videoHeight });
    });
    this.bind('play', () => {
      this.snapshot = { ...this.snapshot, status: 'playing' };
      this.emit({ type: 'play' });
    });
    this.bind('pause', () => {
      this.snapshot = { ...this.snapshot, status: element.ended ? 'ended' : 'paused' };
      this.emit({ type: 'pause' });
    });
    this.bind('timeupdate', () => {
      this.snapshot = { ...this.snapshot, currentTime: element.currentTime, duration: Number.isFinite(element.duration) ? element.duration : this.snapshot.duration };
      this.emit({ type: 'time-update', currentTime: element.currentTime, duration: this.snapshot.duration });
    });
    this.bind('seeking', () => this.emit({ type: 'seeking', from: this.snapshot.currentTime, to: element.currentTime }));
    this.bind('seeked', () => this.emit({ type: 'seeked', from: this.snapshot.currentTime, to: element.currentTime }));
    this.bind('ratechange', () => {
      this.snapshot = { ...this.snapshot, rate: element.playbackRate };
      this.emit({ type: 'rate-change', rate: element.playbackRate });
    });
    this.bind('volumechange', () => {
      this.snapshot = { ...this.snapshot, volume: element.volume, muted: element.muted };
      this.emit({ type: 'volume-change', volume: element.volume, muted: element.muted });
    });
    this.bind('ended', () => {
      this.snapshot = { ...this.snapshot, status: 'ended' };
      this.emit({ type: 'ended' });
    });
    this.bind('error', () => {
      this.snapshot = { ...this.snapshot, status: 'failed' };
      this.emit({ type: 'error', code: 'MEDIA_ERROR', message: 'The browser media element could not play this source.', recoverable: true });
    });
  }

  async load(source: PlaybackSource): Promise<void> {
    this.ensureUsable();
    this.source = source;
    this.snapshot = { ...this.snapshot, status: 'loading', currentTime: 0 };
    if (source.kind === 'hls' && this.optionsHls()) {
      this.optionsHls()?.loadSource?.(source.url);
    } else {
      this.element.src = source.url;
      this.element.load();
    }
  }

  async play(): Promise<void> {
    this.ensureUsable();
    await this.element.play();
  }

  async pause(): Promise<void> { this.ensureUsable(); this.element.pause(); }

  async seek(seconds: number): Promise<void> {
    this.ensureUsable();
    this.element.currentTime = Math.max(0, seconds);
  }

  async setRate(rate: number): Promise<void> { this.ensureUsable(); this.element.playbackRate = rate; }
  async setVolume(volume: number): Promise<void> { this.ensureUsable(); this.element.volume = Math.min(1, Math.max(0, volume)); }
  async setMuted(muted: boolean): Promise<void> { this.ensureUsable(); this.element.muted = muted; }

  async stop(): Promise<void> {
    if (this.disposed) return;
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
    this.snapshot = { ...this.snapshot, status: 'idle', currentTime: 0, duration: null };
  }

  getSnapshot(): Readonly<PlaybackEngineSnapshot> { return this.snapshot; }

  subscribe(listener: (event: PlaybackEngineEvent) => void): Disposable {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.cleanup.splice(0).reverse()) dispose();
    this.optionsHls()?.destroy?.();
    this.listeners.clear();
    this.source = null;
  }

  private bind(name: keyof HTMLElementEventMap, callback: () => void): void {
    const listener = callback as EventListener;
    this.element.addEventListener(name, listener);
    this.cleanup.push(() => this.element.removeEventListener(name, listener));
  }

  private emit(event: PlaybackEngineEvent): void {
    for (const listener of [...this.listeners]) {
      try { listener(event); } catch { /* observer isolation */ }
    }
  }

  private optionsHls(): BrowserMediaController | undefined {
    return this.hlsController;
  }

  private ensureUsable(): void {
    if (this.disposed) throw new Error('browser playback engine is disposed.');
  }
}
