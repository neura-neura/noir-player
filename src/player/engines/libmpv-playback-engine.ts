import {
  command as mpvCommand,
  destroy as mpvDestroy,
  getProperty as mpvGetProperty,
  init as mpvInit,
  observeProperties as mpvObserveProperties,
  listenEvents as mpvListenEvents,
  setProperty as mpvSetProperty,
  type MpvEvent as TauriMpvEvent,
  type MpvObservableProperty,
} from 'tauri-plugin-libmpv-api';
import type {
  Disposable,
  MpvPluginFacade,
  MpvPropertyFormat,
  MpvValue,
} from '@noir-player/plugin-api';
import { createMpvPluginFacade, type MpvFacadeScope } from '@/plugins/runtime/mpv-facade';
import type { MpvBackend, PlaybackEngine, PlaybackEngineEvent, PlaybackEngineSnapshot, PlaybackSource } from './playback-engine';

const OBSERVED_PROPERTIES = [
  ['pause', 'flag'],
  ['time-pos', 'double', 'none'],
  ['duration', 'double', 'none'],
  ['volume', 'double'],
  ['mute', 'flag'],
  ['speed', 'double'],
  ['video-params/w', 'int64', 'none'],
  ['video-params/h', 'int64', 'none'],
] as const satisfies readonly MpvObservableProperty[];

function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function createTauriMpvBackend(): MpvBackend {
  const available = isDesktop();
  let initialized = false;
  return {
    available,
    async init() {
      if (!available || initialized) return;
      await mpvInit({
        initialOptions: {
          vo: 'gpu-next',
          hwdec: 'auto-safe',
          'keep-open': 'yes',
          'force-window': 'yes',
        },
        observedProperties: OBSERVED_PROPERTIES,
      });
      initialized = true;
    },
    async destroy() {
      if (!initialized) return;
      await mpvDestroy();
      initialized = false;
    },
    async loadFile(path) {
      await mpvCommand('loadfile', [path, 'replace']);
    },
    async play() {
      await mpvSetProperty('pause', false);
    },
    async pause() {
      await mpvSetProperty('pause', true);
    },
    async seek(seconds) {
      await mpvCommand('seek', [seconds, 'absolute', 'exact']);
    },
    async setRate(rate) {
      await mpvSetProperty('speed', rate);
    },
    async setVolume(volume) {
      await mpvSetProperty('volume', volume * 100);
    },
    async setMuted(muted) {
      await mpvSetProperty('mute', muted);
    },
    async getProperty<T extends MpvValue>(name: string, format: MpvPropertyFormat = 'node') {
      const transportFormat = format === 'none' ? 'node' : format;
      return (await mpvGetProperty(name, transportFormat)) as T;
    },
    observeProperties(properties, listener) {
      let disposed = false;
      let unlisten: (() => void) | undefined;
      const tuples = properties.map((property) => [property.name, property.format, ...(property.optional ? ['none'] : [])]) as unknown as readonly MpvObservableProperty[];
      void mpvObserveProperties(tuples, (event) => {
        if (!disposed) listener({ name: event.name, data: (event.data ?? null) as MpvValue });
      }).then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      }).catch(() => undefined);
      return () => {
        disposed = true;
        unlisten?.();
      };
    },
    listenEvents(_events, listener) {
      let disposed = false;
      let unlisten: (() => void) | undefined;
      void mpvListenEvents((event: TauriMpvEvent) => {
        if (!disposed) {
          listener({
            name: event.event,
            data: 'data' in event ? (event as { data?: MpvValue }).data : undefined,
          });
        }
      }).then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      }).catch(() => undefined);
      return () => {
        disposed = true;
        unlisten?.();
      };
    },
    async command<T extends MpvValue>(name: string, args: readonly MpvValue[] = []) {
      await mpvCommand(name, args as unknown as (string | boolean | number)[]);
      return undefined as unknown as T;
    },
    async setProperty(name: string, value: MpvValue) {
      await mpvSetProperty(name, value as string | boolean | number);
    },
  };
}

export interface LibmpvPlaybackEngineOptions {
  readonly backend?: MpvBackend;
  readonly logger?: (message: string, error?: unknown) => void;
}

export class LibmpvPlaybackEngine implements PlaybackEngine {
  readonly id = 'libmpv' as const;
  readonly capabilities = Object.freeze({
    engine: 'libmpv' as const,
    nativeSurface: true,
    hls: false,
    externalAudio: true,
    subtitles: true,
  });
  private readonly backend: MpvBackend;
  private readonly listeners = new Set<(event: PlaybackEngineEvent) => void>();
  private readonly cleanup: Disposable[] = [];
  private snapshot: PlaybackEngineSnapshot = {
    engine: 'libmpv',
    status: 'idle',
    currentTime: 0,
    duration: null,
    rate: 1,
    volume: 1,
    muted: false,
    videoSize: null,
  };
  private initialized = false;
  private disposed = false;

  constructor(options: LibmpvPlaybackEngineOptions = {}) {
    this.backend = options.backend ?? createTauriMpvBackend();
    this.log = options.logger;
  }

  private readonly log?: (message: string, error?: unknown) => void;

  async load(source: PlaybackSource): Promise<void> {
    this.ensureUsable();
    if (source.kind === 'hls') throw new Error('libmpv is not the HLS engine.');
    if (!this.backend.available) throw new Error('libmpv is not available.');
    await this.ensureInitialized();
    this.snapshot = { ...this.snapshot, status: 'loading' };
    await this.backend.loadFile(source.path ?? source.url);
  }

  async play(): Promise<void> { this.ensureUsable(); await this.backend.play(); }
  async pause(): Promise<void> { this.ensureUsable(); await this.backend.pause(); }
  async seek(seconds: number): Promise<void> { this.ensureUsable(); await this.backend.seek(Math.max(0, seconds)); }
  async setRate(rate: number): Promise<void> { this.ensureUsable(); await this.backend.setRate(rate); }
  async setVolume(volume: number): Promise<void> { this.ensureUsable(); await this.backend.setVolume(volume); }
  async setMuted(muted: boolean): Promise<void> { this.ensureUsable(); await this.backend.setMuted(muted); }

  async stop(): Promise<void> {
    if (!this.initialized || this.disposed) return;
    try {
      await this.backend.command('stop');
    } catch (error) {
      this.log?.('libmpv stop failed.', error);
    }
    this.snapshot = { ...this.snapshot, status: 'idle', currentTime: 0 };
  }

  getSnapshot(): Readonly<PlaybackEngineSnapshot> { return this.snapshot; }

  subscribe(listener: (event: PlaybackEngineEvent) => void): Disposable {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getMpvFacade(scope: MpvFacadeScope): MpvPluginFacade {
    return createMpvPluginFacade(this.backend, scope);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.cleanup.splice(0).reverse()) dispose();
    await this.backend.destroy().catch((error) => this.log?.('libmpv destroy failed.', error));
    this.initialized = false;
    this.listeners.clear();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.backend.init();
    this.initialized = true;
    this.cleanup.push(this.backend.observeProperties([
      { name: 'pause', format: 'flag' },
      { name: 'time-pos', format: 'double', optional: true },
      { name: 'duration', format: 'double', optional: true },
      { name: 'volume', format: 'double' },
      { name: 'mute', format: 'flag' },
      { name: 'speed', format: 'double' },
      { name: 'video-params/w', format: 'int64', optional: true },
      { name: 'video-params/h', format: 'int64', optional: true },
    ], (event) => this.handleProperty(event.name, event.data)));
    this.cleanup.push(this.backend.listenEvents(['file-loaded', 'end-file', 'start-file'], (event) => {
      if (event.name === 'file-loaded') {
        this.snapshot = { ...this.snapshot, status: this.snapshot.status === 'playing' ? 'playing' : 'ready' };
        this.emit({ type: 'loaded-metadata', duration: this.snapshot.duration, width: this.snapshot.videoSize?.width ?? 0, height: this.snapshot.videoSize?.height ?? 0 });
      } else if (event.name === 'end-file') {
        this.snapshot = { ...this.snapshot, status: 'ended' };
        this.emit({ type: 'ended' });
      }
    }));
  }

  private handleProperty(name: string, data: MpvValue): void {
    if (name === 'pause') {
      const paused = Boolean(data);
      this.snapshot = { ...this.snapshot, status: paused ? 'paused' : 'playing' };
      this.emit({ type: paused ? 'pause' : 'play' });
    } else if (name === 'time-pos') {
      const currentTime = typeof data === 'number' ? Math.max(0, data) : 0;
      this.snapshot = { ...this.snapshot, currentTime };
      this.emit({ type: 'time-update', currentTime, duration: this.snapshot.duration });
    } else if (name === 'duration') {
      const duration = typeof data === 'number' && Number.isFinite(data) ? data : null;
      this.snapshot = { ...this.snapshot, duration };
    } else if (name === 'volume') {
      const volume = typeof data === 'number' ? Math.min(1, Math.max(0, data / 100)) : this.snapshot.volume;
      this.snapshot = { ...this.snapshot, volume };
      this.emit({ type: 'volume-change', volume, muted: this.snapshot.muted });
    } else if (name === 'mute') {
      const muted = Boolean(data);
      this.snapshot = { ...this.snapshot, muted };
      this.emit({ type: 'volume-change', volume: this.snapshot.volume, muted });
    } else if (name === 'speed' && typeof data === 'number') {
      this.snapshot = { ...this.snapshot, rate: data };
      this.emit({ type: 'rate-change', rate: data });
    } else if ((name === 'video-params/w' || name === 'video-params/h') && typeof data === 'number') {
      const current = this.snapshot.videoSize ?? { width: 0, height: 0 };
      const videoSize = name.endsWith('/w') ? { ...current, width: data } : { ...current, height: data };
      this.snapshot = { ...this.snapshot, videoSize };
    }
  }

  private emit(event: PlaybackEngineEvent): void {
    for (const listener of [...this.listeners]) {
      try { listener(event); } catch { /* observer isolation */ }
    }
  }

  private ensureUsable(): void {
    if (this.disposed) throw new Error('libmpv engine is disposed.');
  }
}
