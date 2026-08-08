import type { PlayerSnapshot } from '@noir-player/plugin-api';

export interface PublicSnapshotInput {
  readonly sessionId: string | null;
  readonly revision: number;
  readonly displayName: string | null;
  readonly sourceKind: 'local-file' | 'object-url' | 'hls' | null;
  readonly engine: 'libmpv' | 'html-media' | 'hls-js' | 'ffmpeg-fallback' | null;
  readonly engineStatus: 'loading' | 'ready' | 'failed' | 'switching';
  readonly duration: number | null;
  readonly currentTime: number;
  readonly videoSize: { readonly width: number; readonly height: number } | null;
  readonly paused: boolean;
  readonly rate: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly fullscreen: boolean;
  readonly subtitleTrackId?: string | null;
  readonly subtitleDisplayName?: string | null;
  readonly cueIndex?: number;
  readonly cueText?: string | null;
  readonly offsetMs?: number;
  readonly playlist?: PlayerSnapshot['playlist'];
  readonly panelVisible?: boolean;
  readonly panelTab?: string | null;
  readonly playbackControlsVisible?: boolean;
}

export function createPublicPlayerSnapshot(input: PublicSnapshotInput): PlayerSnapshot {
  const media = input.displayName && input.sourceKind && input.engine
    ? {
        displayName: input.displayName,
        sourceKind: input.sourceKind,
        engine: input.engine,
        engineStatus: input.engineStatus,
        duration: input.duration,
        currentTime: Math.max(0, Number.isFinite(input.currentTime) ? input.currentTime : 0),
        videoSize: input.videoSize,
        buffered: [],
      }
    : null;
  return Object.freeze({
    revision: input.revision,
    sessionId: input.sessionId,
    status: !media
      ? 'empty'
      : input.engineStatus === 'failed'
        ? 'error'
        : input.paused
          ? 'paused'
          : 'playing',
    media,
    playback: Object.freeze({
      paused: input.paused,
      rate: input.rate,
      volume: input.volume,
      muted: input.muted,
      fullscreen: input.fullscreen,
    }),
    subtitles: Object.freeze({
      trackId: input.subtitleTrackId ?? null,
      displayName: input.subtitleDisplayName ?? null,
      cueIndex: input.cueIndex ?? -1,
      cueText: input.cueText ?? null,
      offsetMs: input.offsetMs ?? 0,
    }),
    playlist: input.playlist ?? { items: [], activeId: null },
    ui: Object.freeze({
      panelVisible: input.panelVisible ?? false,
      panelTab: input.panelTab ?? null,
      playbackControlsVisible: input.playbackControlsVisible ?? true,
    }),
  });
}
