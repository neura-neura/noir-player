import type { Disposable, PlayerFacade, PlayerSnapshot } from '@noir-player/plugin-api';

export const EMPTY_PLAYER_SNAPSHOT: PlayerSnapshot = Object.freeze({
  revision: 0,
  sessionId: null,
  status: 'empty',
  media: null,
  playback: Object.freeze({
    paused: true,
    rate: 1,
    volume: 1,
    muted: false,
    fullscreen: false,
  }),
  subtitles: Object.freeze({
    trackId: null,
    displayName: null,
    cueIndex: -1,
    cueText: null,
    offsetMs: 0,
  }),
  playlist: Object.freeze({ items: [], activeId: null }),
  ui: Object.freeze({
    panelVisible: false,
    panelTab: null,
    playbackControlsVisible: true,
  }),
});

function freezeSnapshot(snapshot: PlayerSnapshot): PlayerSnapshot {
  if (import.meta.env?.DEV) {
    Object.freeze(snapshot.playback);
    Object.freeze(snapshot.subtitles);
    Object.freeze(snapshot.playlist.items);
    Object.freeze(snapshot.playlist);
    Object.freeze(snapshot.ui);
    if (snapshot.media) {
      Object.freeze(snapshot.media.buffered);
      if (snapshot.media.videoSize) Object.freeze(snapshot.media.videoSize);
      Object.freeze(snapshot.media);
    }
    Object.freeze(snapshot);
  }
  return snapshot;
}

export class PlayerStore implements PlayerFacade {
  private snapshot: PlayerSnapshot = EMPTY_PLAYER_SNAPSHOT;
  private readonly listeners = new Set<() => void>();

  getSnapshot(): Readonly<PlayerSnapshot> {
    return this.snapshot;
  }

  subscribe(listener: () => void): Disposable {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSnapshot(next: PlayerSnapshot): void {
    this.snapshot = freezeSnapshot(next);
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  update(updater: (previous: PlayerSnapshot) => PlayerSnapshot): void {
    this.setSnapshot(updater(this.snapshot));
  }

  reset(): void {
    this.setSnapshot(EMPTY_PLAYER_SNAPSHOT);
  }
}
