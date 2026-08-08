import { useEffect, useRef } from 'react';
import type { PlayerSnapshot } from '@noir-player/plugin-api';
import type { PluginRuntime } from '@/plugins/runtime';
import { createPublicPlayerSnapshot } from './public-snapshot';

export interface AppPluginSource {
  readonly src: string;
  readonly fileName: string;
  readonly kind: 'object' | 'path' | 'hls' | 'mpv';
  readonly path?: string;
}

export interface AppPluginActions {
  open(path: string): Promise<void>;
  retryWithFallback(): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  toggle(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  seekBy(seconds: number): Promise<void>;
  setRate(rate: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  toggleFullscreen(): Promise<void>;
  openSubtitle(path: string): Promise<void>;
  selectEmbeddedSubtitle(id: string): Promise<void>;
  clearSubtitle(): void;
  setSubtitleOffset(offsetMs: number): void;
  exportSubtitle(): Promise<void>;
  refreshPlaylist(): void;
  playPlaylist(id: string): Promise<void>;
  playlistNext(): Promise<void>;
  playlistPrevious(): Promise<void>;
  openPanel(tab?: string): void;
  closePanel(): void;
  showNotice(message: string): void;
}

export interface AppPluginBridgeInput {
  readonly runtime: PluginRuntime;
  readonly source: AppPluginSource | null;
  readonly nativeStatus: 'disabled' | 'loading' | 'ready' | 'failed';
  readonly nativePaused: boolean;
  readonly nativeTime: number;
  readonly nativeDuration: number;
  readonly nativeVolume: number;
  readonly nativeMuted: boolean;
  readonly nativeRate: number;
  readonly nativeWidth: number;
  readonly nativeHeight: number;
  readonly nativeSurfaceReady: boolean;
  readonly nativeFullscreen: boolean;
  readonly isNative: boolean;
  readonly subtitleTrack: { readonly fileName: string } | null;
  readonly activeCueIndex: number;
  readonly activeCueText: string | null;
  readonly syncOffsetMs: number;
  readonly playlist: readonly { readonly path: string; readonly fileName: string }[];
  readonly activePlaylistIndex: number;
  readonly panelVisible: boolean;
  readonly panelTab: string;
  readonly controlsVisible: boolean;
  readonly videoElement: HTMLVideoElement | null;
  readonly actions: AppPluginActions;
}

export function useAppPluginBridge(input: AppPluginBridgeInput): void {
  const actionsRef = useRef(input.actions);
  actionsRef.current = input.actions;
  const runtime = input.runtime;
  const nativeFullscreen = input.nativeFullscreen;
  const {
    activeCueIndex,
    activeCueText,
    activePlaylistIndex,
    controlsVisible,
    isNative,
    nativeDuration,
    nativeHeight,
    nativeMuted,
    nativePaused,
    nativeRate,
    nativeStatus,
    nativeSurfaceReady,
    nativeTime,
    nativeVolume,
    nativeWidth,
    panelTab,
    panelVisible,
    playlist,
    source,
    subtitleTrack,
    syncOffsetMs,
    videoElement,
  } = input;
  const sourceKeyRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const readySessionRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const previousEngineRef = useRef<PlayerSnapshot['media'] extends infer T ? T extends { engine: infer E } ? E | null : never : null>(null);
  const previousPlaybackRef = useRef({ paused: true, rate: 1, volume: 1, muted: false });
  const previousUiRef = useRef({ panelVisible: false, panelTab: null as string | null, fullscreen: false });

  useEffect(() => {
    const sourceKey = source ? source.path ?? source.src : null;
    if (sourceKey !== sourceKeyRef.current) {
      sourceKeyRef.current = sourceKey;
      sessionIdRef.current = sourceKey ? `session-${Date.now()}-${revisionRef.current + 1}` : null;
      readySessionRef.current = null;
    }

    const sourceKind = source
      ? source.kind === 'object'
        ? 'object-url'
        : source.kind === 'hls'
          ? 'hls'
          : 'local-file'
      : null;
    const engine = source
      ? isNative
        ? 'libmpv'
        : source.kind === 'hls'
          ? 'hls-js'
          : 'html-media'
      : null;
    const browserReady = Boolean(videoElement && videoElement.readyState >= HTMLMediaElement.HAVE_METADATA);
    const engineStatus = !source
      ? 'loading'
      : isNative
        ? nativeStatus === 'failed'
          ? 'failed'
          : nativeSurfaceReady
            ? 'ready'
            : 'loading'
        : browserReady
          ? 'ready'
          : 'loading';
    const snapshot = createPublicPlayerSnapshot({
      sessionId: sessionIdRef.current,
      revision: revisionRef.current + 1,
      displayName: source?.fileName ?? null,
      sourceKind,
      engine,
      engineStatus,
      duration: isNative ? nativeDuration : videoElement && Number.isFinite(videoElement.duration) ? videoElement.duration : null,
      currentTime: isNative ? nativeTime : videoElement?.currentTime ?? 0,
      videoSize: isNative
        ? nativeWidth > 0 && nativeHeight > 0 ? { width: nativeWidth, height: nativeHeight } : null
        : videoElement && videoElement.videoWidth > 0 && videoElement.videoHeight > 0 ? { width: videoElement.videoWidth, height: videoElement.videoHeight } : null,
      paused: isNative ? nativePaused : videoElement?.paused ?? true,
      rate: isNative ? nativeRate : videoElement?.playbackRate ?? 1,
      volume: isNative ? nativeVolume : videoElement?.volume ?? nativeVolume,
      muted: isNative ? nativeMuted : videoElement?.muted ?? false,
      fullscreen: nativeFullscreen,
      subtitleTrackId: subtitleTrack?.fileName ?? null,
      subtitleDisplayName: subtitleTrack?.fileName ?? null,
      cueIndex: activeCueIndex,
      cueText: activeCueText,
      offsetMs: syncOffsetMs,
      playlist: {
        items: playlist.map((item, index) => ({
          id: `playlist-${index}-${item.fileName}`,
          displayName: item.fileName,
          active: item.path === source?.path,
        })),
        activeId: playlist[activePlaylistIndex]
          ? `playlist-${activePlaylistIndex}-${playlist[activePlaylistIndex].fileName}`
          : null,
      },
      panelVisible,
      panelTab,
      playbackControlsVisible: controlsVisible,
    });
    revisionRef.current += 1;
    runtime.player.setSnapshot(snapshot);

    if (engine && engine !== previousEngineRef.current) {
      runtime.events.emit('media:engine-changed', {
        previous: previousEngineRef.current,
        next: engine,
        reason: previousEngineRef.current ? 'engine-transition' : 'initial-engine-selection',
      }, { revision: snapshot.revision, sessionId: snapshot.sessionId });
      previousEngineRef.current = engine;
    }
    if (sourceKey && snapshot.sessionId) {
      if (readySessionRef.current === null) {
        runtime.events.emit('media:opening', { sessionId: snapshot.sessionId, displayName: source?.fileName ?? '', kind: sourceKind ?? 'local-file' }, { revision: snapshot.revision, sessionId: snapshot.sessionId });
        runtime.events.emit('media:source-changed', { media: snapshot.media }, { revision: snapshot.revision, sessionId: snapshot.sessionId });
      }
      runtime.events.emit('media:time-update', { currentTime: snapshot.media?.currentTime ?? 0, duration: snapshot.media?.duration ?? null }, { revision: snapshot.revision, sessionId: snapshot.sessionId });
      if (engineStatus === 'ready' && readySessionRef.current !== snapshot.sessionId) {
        readySessionRef.current = snapshot.sessionId;
        runtime.events.emit('media:loaded-metadata', { duration: snapshot.media?.duration ?? null, dimensions: snapshot.media?.videoSize ?? null }, { revision: snapshot.revision, sessionId: snapshot.sessionId });
        runtime.events.emit('media:ready', { media: snapshot.media }, { revision: snapshot.revision, sessionId: snapshot.sessionId });
      }
    }

    const previousPlayback = previousPlaybackRef.current;
    if (snapshot.playback.paused !== previousPlayback.paused) {
      runtime.events.emit(snapshot.playback.paused ? 'media:pause' : 'media:play', { currentTime: snapshot.media?.currentTime ?? 0 }, { revision: snapshot.revision, sessionId: snapshot.sessionId });
    }
    if (snapshot.playback.rate !== previousPlayback.rate) runtime.events.emit('media:rate-change', { rate: snapshot.playback.rate }, { revision: snapshot.revision, sessionId: snapshot.sessionId });
    if (snapshot.playback.volume !== previousPlayback.volume || snapshot.playback.muted !== previousPlayback.muted) runtime.events.emit('media:volume-change', { volume: snapshot.playback.volume, muted: snapshot.playback.muted }, { revision: snapshot.revision, sessionId: snapshot.sessionId });
    const previousUi = previousUiRef.current;
    if (snapshot.ui.panelVisible !== previousUi.panelVisible || snapshot.ui.panelTab !== previousUi.panelTab) runtime.events.emit('ui:panel-changed', { visible: snapshot.ui.panelVisible, tab: snapshot.ui.panelTab }, { revision: snapshot.revision, sessionId: snapshot.sessionId });
    if (snapshot.playback.fullscreen !== previousUi.fullscreen) runtime.events.emit('ui:fullscreen-changed', { fullscreen: snapshot.playback.fullscreen }, { revision: snapshot.revision, sessionId: snapshot.sessionId });
    previousPlaybackRef.current = { paused: snapshot.playback.paused, rate: snapshot.playback.rate, volume: snapshot.playback.volume, muted: snapshot.playback.muted };
    previousUiRef.current = { panelVisible: snapshot.ui.panelVisible, panelTab: snapshot.ui.panelTab, fullscreen: snapshot.playback.fullscreen };
  }, [
    activeCueIndex,
    activeCueText,
    activePlaylistIndex,
    controlsVisible,
    isNative,
    nativeDuration,
    nativeFullscreen,
    nativeHeight,
    nativeMuted,
    nativePaused,
    nativeRate,
    nativeStatus,
    nativeSurfaceReady,
    nativeTime,
    nativeVolume,
    nativeWidth,
    panelTab,
    panelVisible,
    playlist,
    runtime,
    source,
    subtitleTrack,
    syncOffsetMs,
    videoElement,
  ]);

  useEffect(() => {
    const disposables = [
      runtime.commands.registerCore('media.open', ({ path }) => actionsRef.current.open(path)),
      runtime.commands.registerCore('media.retryWithFallback', () => actionsRef.current.retryWithFallback()),
      runtime.commands.registerCore('media.play', () => actionsRef.current.play()),
      runtime.commands.registerCore('media.pause', () => actionsRef.current.pause()),
      runtime.commands.registerCore('media.toggle', () => actionsRef.current.toggle()),
      runtime.commands.registerCore('media.seekTo', ({ seconds }) => actionsRef.current.seekTo(seconds)),
      runtime.commands.registerCore('media.seekBy', ({ seconds }) => actionsRef.current.seekBy(seconds)),
      runtime.commands.registerCore('media.setRate', ({ rate }) => actionsRef.current.setRate(rate)),
      runtime.commands.registerCore('media.setVolume', ({ volume }) => actionsRef.current.setVolume(volume)),
      runtime.commands.registerCore('media.setMuted', ({ muted }) => actionsRef.current.setMuted(muted)),
      runtime.commands.registerCore('fullscreen.toggle', () => actionsRef.current.toggleFullscreen()),
      runtime.commands.registerCore('fullscreen.enter', () => nativeFullscreen ? Promise.resolve() : actionsRef.current.toggleFullscreen()),
      runtime.commands.registerCore('fullscreen.exit', () => nativeFullscreen ? actionsRef.current.toggleFullscreen() : Promise.resolve()),
      runtime.commands.registerCore('panel.open', ({ tab }) => {
        actionsRef.current.openPanel(tab);
      }),
      runtime.commands.registerCore('panel.close', () => actionsRef.current.closePanel()),
      runtime.commands.registerCore('subtitle.open', ({ path }) => actionsRef.current.openSubtitle(path)),
      runtime.commands.registerCore('subtitle.selectEmbedded', ({ id }) => actionsRef.current.selectEmbeddedSubtitle(id)),
      runtime.commands.registerCore('subtitle.clear', () => actionsRef.current.clearSubtitle()),
      runtime.commands.registerCore('subtitle.setOffset', ({ offsetMs }) => actionsRef.current.setSubtitleOffset(offsetMs)),
      runtime.commands.registerCore('subtitle.export', () => actionsRef.current.exportSubtitle()),
      runtime.commands.registerCore('playlist.refresh', () => actionsRef.current.refreshPlaylist()),
      runtime.commands.registerCore('playlist.play', ({ id }) => actionsRef.current.playPlaylist(id)),
      runtime.commands.registerCore('playlist.next', () => actionsRef.current.playlistNext()),
      runtime.commands.registerCore('playlist.previous', () => actionsRef.current.playlistPrevious()),
      runtime.commands.registerCore('notice.show', ({ message }) => actionsRef.current.showNotice(message)),
    ];
    return () => disposables.forEach((dispose) => dispose());
  }, [nativeFullscreen, runtime]);
}
