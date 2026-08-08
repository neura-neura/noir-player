/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MpvPropertyFormat, MpvValue } from '@noir-player/plugin-api';
import { createPublicPlayerSnapshot } from '@/player/core/public-snapshot';
import { BrowserPlaybackEngine } from '@/player/engines/browser-playback-engine';
import { LibmpvPlaybackEngine } from '@/player/engines/libmpv-playback-engine';
import { PlaybackResolver } from '@/player/engines/playback-resolver';
import type { MpvBackend } from '@/player/engines/playback-engine';

describe('player seams and characterization', () => {
  beforeEach(() => vi.useRealTimers());

  it('keeps sourceKind and engine separate and does not expose local paths', () => {
    const snapshot = createPublicPlayerSnapshot({
      revision: 3,
      sessionId: 'session-1',
      displayName: 'movie.mkv',
      sourceKind: 'local-file',
      engine: 'libmpv',
      engineStatus: 'ready',
      duration: 12,
      currentTime: 4,
      videoSize: { width: 1920, height: 1080 },
      paused: false,
      rate: 1,
      volume: 0.8,
      muted: false,
      fullscreen: false,
    });
    expect(snapshot.media?.sourceKind).toBe('local-file');
    expect(snapshot.media?.engine).toBe('libmpv');
    expect(JSON.stringify(snapshot)).not.toContain('C:\\Users');
  });

  it('normalizes HTML media events and disposes every listener', async () => {
    document.body.innerHTML = '<video></video>';
    const video = document.querySelector('video')!;
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const engine = new BrowserPlaybackEngine(video);
    const events: string[] = [];
    engine.subscribe((event) => events.push(event.type));
    await engine.load({ displayName: 'fixture.mp4', kind: 'object-url', url: 'blob:fixture' });
    video.dispatchEvent(new Event('loadedmetadata'));
    video.dispatchEvent(new Event('timeupdate'));
    expect(engine.getSnapshot().engine).toBe('html-media');
    expect(events).toContain('loaded-metadata');
    expect(events).toContain('time-update');
    await engine.dispose();
    video.dispatchEvent(new Event('play'));
    expect(events.filter((event) => event === 'play')).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('routes loopback HLS through the browser controller and cleans it on dispose', async () => {
    document.body.innerHTML = '<video></video>';
    const video = document.querySelector('video')!;
    const hls = {
      loadSource: vi.fn(),
      destroy: vi.fn(),
    };
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const engine = new BrowserPlaybackEngine(video, { id: 'hls-js', hls });

    await engine.load({
      displayName: 'stream.ts',
      kind: 'hls',
      url: 'http://127.0.0.1:32124/session/playlist.m3u8',
      path: 'C:\\Videos\\stream.ts',
    });

    expect(hls.loadSource).toHaveBeenCalledWith(
      'http://127.0.0.1:32124/session/playlist.m3u8',
    );
    expect(engine.capabilities.hls).toBe(true);
    await engine.dispose();
    await engine.dispose();
    expect(hls.destroy).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('normalizes libmpv lifecycle, properties, events, and teardown', async () => {
    const propertyListeners = new Set<(event: { name: string; data: MpvValue }) => void>();
    const eventListeners = new Set<(event: { name: string; data?: MpvValue }) => void>();
    const backend: MpvBackend = {
      available: true,
      init: vi.fn(async () => undefined),
      destroy: vi.fn(async () => undefined),
      loadFile: vi.fn(async () => undefined),
      play: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      seek: vi.fn(async () => undefined),
      setRate: vi.fn(async () => undefined),
      setVolume: vi.fn(async () => undefined),
      setMuted: vi.fn(async () => undefined),
      getProperty: vi.fn(async (_name: string, _format?: MpvPropertyFormat): Promise<MpvValue> => null) as unknown as MpvBackend['getProperty'],
      observeProperties: vi.fn((_properties, listener) => {
        propertyListeners.add(listener as (event: { name: string; data: MpvValue }) => void);
        return () => propertyListeners.delete(listener as (event: { name: string; data: MpvValue }) => void);
      }),
      listenEvents: vi.fn((_events, listener) => {
        eventListeners.add(listener as (event: { name: string; data?: MpvValue }) => void);
        return () => eventListeners.delete(listener as (event: { name: string; data?: MpvValue }) => void);
      }),
      command: vi.fn(async (_name: string, _args?: readonly MpvValue[]): Promise<MpvValue> => null) as unknown as MpvBackend['command'],
      setProperty: vi.fn(async () => undefined),
    };
    const engine = new LibmpvPlaybackEngine({ backend });
    const events: string[] = [];
    engine.subscribe((event) => events.push(event.type));

    await engine.load({
      displayName: 'movie.mkv',
      kind: 'local-file',
      url: 'file:///movie.mkv',
      path: 'C:\\Videos\\movie.mkv',
    });

    for (const listener of propertyListeners) {
      listener({ name: 'duration', data: 42 });
      listener({ name: 'video-params/w', data: 1920 });
      listener({ name: 'video-params/h', data: 1080 });
      listener({ name: 'time-pos', data: 7 });
      listener({ name: 'pause', data: false });
    }
    for (const listener of eventListeners) listener({ name: 'file-loaded' });

    expect(backend.init).toHaveBeenCalledTimes(1);
    expect(backend.loadFile).toHaveBeenCalledWith('C:\\Videos\\movie.mkv');
    expect(engine.getSnapshot()).toMatchObject({
      status: 'playing',
      currentTime: 7,
      duration: 42,
      videoSize: { width: 1920, height: 1080 },
    });
    expect(events).toEqual(expect.arrayContaining(['time-update', 'play', 'loaded-metadata']));

    await engine.dispose();
    await engine.dispose();
    expect(backend.destroy).toHaveBeenCalledTimes(1);
    expect(propertyListeners).toHaveLength(0);
    expect(eventListeners).toHaveLength(0);
    await expect(engine.play()).rejects.toThrow('disposed');
  });

  it('degrades from native to a single browser authority and can be forced to fallback', async () => {
    const native = {
      id: 'libmpv' as const,
      capabilities: { engine: 'libmpv' as const, nativeSurface: true, hls: false, externalAudio: true, subtitles: true },
      load: vi.fn(async () => { throw new Error('native unavailable'); }),
      play: vi.fn(async () => undefined), pause: vi.fn(async () => undefined), seek: vi.fn(async () => undefined), setRate: vi.fn(async () => undefined), setVolume: vi.fn(async () => undefined), setMuted: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
      getSnapshot: () => ({ engine: 'libmpv' as const, status: 'failed' as const, currentTime: 0, duration: null, rate: 1, volume: 1, muted: false, videoSize: null }),
      subscribe: () => () => undefined,
      dispose: vi.fn(async () => undefined),
    };
    const browser = {
      ...native,
      id: 'ffmpeg-fallback' as const,
      capabilities: { engine: 'ffmpeg-fallback' as const, nativeSurface: false, hls: false, externalAudio: true, subtitles: true },
      load: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const reasons: string[] = [];
    const resolver = new PlaybackResolver({
      preferNative: true,
      createNative: () => native,
      createBrowser: () => browser,
      onEngineChanged: (_previous, next, reason) => reasons.push(`${next}:${reason}`),
    });
    const result = await resolver.load({ displayName: 'fixture.mkv', kind: 'local-file', url: 'file:///fixture' });
    expect(result.engine.id).toBe('ffmpeg-fallback');
    expect(reasons).toEqual(['ffmpeg-fallback:native-init-or-load-failed']);
    await resolver.load({ displayName: 'fixture.mkv', kind: 'local-file', url: 'file:///fixture' }, true);
    expect(reasons.at(-1)).toBe('ffmpeg-fallback:forced-fallback');
  });

  it('keeps HLS on the browser authority even when native playback is preferred', async () => {
    const nativeFactory = vi.fn(() => {
      throw new Error('native should not be constructed for HLS');
    });
    const browser = {
      id: 'hls-js' as const,
      capabilities: { engine: 'hls-js' as const, nativeSurface: false, hls: true, externalAudio: true, subtitles: true },
      load: vi.fn(async () => undefined),
      play: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      seek: vi.fn(async () => undefined),
      setRate: vi.fn(async () => undefined),
      setVolume: vi.fn(async () => undefined),
      setMuted: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getSnapshot: () => ({ engine: 'hls-js' as const, status: 'ready' as const, currentTime: 0, duration: null, rate: 1, volume: 1, muted: false, videoSize: null }),
      subscribe: () => () => undefined,
      dispose: vi.fn(async () => undefined),
    };
    const resolver = new PlaybackResolver({
      preferNative: true,
      createNative: nativeFactory,
      createBrowser: () => browser,
    });

    const result = await resolver.load({
      displayName: 'stream.ts',
      kind: 'hls',
      url: 'http://127.0.0.1:32124/session/playlist.m3u8',
    });

    expect(result.engine.id).toBe('hls-js');
    expect(nativeFactory).not.toHaveBeenCalled();
    expect(browser.load).toHaveBeenCalledTimes(1);
  });
});
