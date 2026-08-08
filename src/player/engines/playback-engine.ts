import type { Disposable, MpvPluginFacade, MpvPropertyFormat, MpvValue } from '@noir-player/plugin-api';

export type PlaybackEngineId = 'libmpv' | 'html-media' | 'hls-js' | 'ffmpeg-fallback';
export type PlaybackSourceKind = 'local-file' | 'object-url' | 'hls';

export interface PlaybackSource {
  readonly displayName: string;
  readonly kind: PlaybackSourceKind;
  readonly url: string;
  readonly path?: string;
}

export interface PlaybackEngineCapabilities {
  readonly engine: PlaybackEngineId;
  readonly nativeSurface: boolean;
  readonly hls: boolean;
  readonly externalAudio: boolean;
  readonly subtitles: boolean;
}

export interface PlaybackEngineSnapshot {
  readonly engine: PlaybackEngineId;
  readonly status: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'failed';
  readonly currentTime: number;
  readonly duration: number | null;
  readonly rate: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly videoSize: { readonly width: number; readonly height: number } | null;
}

export type PlaybackEngineEvent =
  | { readonly type: 'loaded-metadata'; readonly duration: number | null; readonly width: number; readonly height: number }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'time-update'; readonly currentTime: number; readonly duration: number | null }
  | { readonly type: 'seeking'; readonly from: number; readonly to: number }
  | { readonly type: 'seeked'; readonly from: number; readonly to: number }
  | { readonly type: 'rate-change'; readonly rate: number }
  | { readonly type: 'volume-change'; readonly volume: number; readonly muted: boolean }
  | { readonly type: 'ended' }
  | { readonly type: 'error'; readonly code: string; readonly message: string; readonly recoverable: boolean };

export interface PlaybackEngine {
  readonly id: PlaybackEngineId;
  readonly capabilities: PlaybackEngineCapabilities;
  load(source: PlaybackSource): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  setRate(rate: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  stop(): Promise<void>;
  getSnapshot(): Readonly<PlaybackEngineSnapshot>;
  subscribe(listener: (event: PlaybackEngineEvent) => void): Disposable;
  getMpvFacade?(scope: {
    canRead: boolean;
    canRaw: boolean;
    pluginId: string;
    registerDisposable(disposable: Disposable): Disposable;
    audit(operation: string, name: string, durationMs: number, outcome: 'ok' | 'error'): void;
  }): MpvPluginFacade;
  dispose(): Promise<void>;
}

export interface MpvBackend {
  readonly available: boolean;
  init(): Promise<void>;
  destroy(): Promise<void>;
  loadFile(path: string): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  setRate(rate: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  getProperty<T extends MpvValue>(name: string, format?: MpvPropertyFormat): Promise<T>;
  observeProperties(properties: readonly { readonly name: string; readonly format: MpvPropertyFormat; readonly optional?: boolean }[], listener: (event: { name: string; data: MpvValue }) => void): Disposable;
  listenEvents(events: readonly string[], listener: (event: { name: string; data?: MpvValue }) => void): Disposable;
  command<T extends MpvValue>(name: string, args?: readonly MpvValue[]): Promise<T>;
  setProperty(name: string, value: MpvValue): Promise<void>;
}
