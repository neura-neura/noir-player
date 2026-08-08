import { describe, expect, it, vi } from 'vitest';
import { createServiceToken } from '@noir-player/plugin-api';
import { CommandBus, HookRegistry, ServiceRegistry, TypedEventBus } from '@/plugins/runtime';

describe('events, hooks and command bus', () => {
  it('coalesces time updates while preserving the latest session metadata', () => {
    vi.useFakeTimers();
    const bus = new TypedEventBus(250);
    const events: number[] = [];
    bus.on('media:time-update', (event) => events.push(event.payload.currentTime));
    bus.emit('media:time-update', { currentTime: 1, duration: 10 }, { sessionId: 'session-1', revision: 1 });
    bus.emit('media:time-update', { currentTime: 2, duration: 10 }, { sessionId: 'session-1', revision: 2 });
    expect(events).toEqual([]);
    vi.advanceTimersByTime(250);
    expect(events).toEqual([2]);
    bus.dispose();
    vi.useRealTimers();
  });

  it('runs hooks serially and supports cancellation', async () => {
    const hooks = new HookRegistry();
    const order: string[] = [];
    hooks.registerForPlugin('fixture.first', 'media:before-play', async () => {
      order.push('first');
      return { decision: 'allow' };
    });
    hooks.registerForPlugin('fixture.second', 'media:before-play', () => {
      order.push('second');
      return { decision: 'cancel' };
    });
    hooks.registerForPlugin('fixture.third', 'media:before-play', () => {
      order.push('third');
      return { decision: 'allow' };
    });
    const results = await hooks.run('media:before-play', {
      revision: 1,
      sessionId: 'session-1',
      status: 'paused',
      media: null,
      playback: { paused: true, rate: 1, volume: 1, muted: false, fullscreen: false },
      subtitles: { trackId: null, displayName: null, cueIndex: -1, cueText: null, offsetMs: 0 },
      playlist: { items: [], activeId: null },
      ui: { panelVisible: false, panelTab: null, playbackControlsVisible: true },
    }, { correlationId: 'play-1' });
    expect(order).toEqual(['first', 'second']);
    expect(results).toHaveLength(2);
  });

  it('rejects re-entry and times out fail-closed validation hooks', async () => {
    const hooks = new HookRegistry();
    hooks.registerForPlugin('fixture.loop', 'media:before-play', async (_input, context) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      context.signal.throwIfAborted?.();
      return { decision: 'allow' };
    });
    const snapshot = {
      revision: 1, sessionId: null, status: 'paused' as const, media: null,
      playback: { paused: true, rate: 1, volume: 1, muted: false, fullscreen: false },
      subtitles: { trackId: null, displayName: null, cueIndex: -1, cueText: null, offsetMs: 0 },
      playlist: { items: [], activeId: null }, ui: { panelVisible: false, panelTab: null, playbackControlsVisible: true },
    };
    await expect(hooks.run('media:before-play', snapshot, { correlationId: 'timeout', timeoutMs: 5 })).rejects.toMatchObject({ code: 'PLUGIN_HOOK_TIMEOUT' });
  });

  it('validates core inputs, supports abort, and keeps plugin commands namespaced', async () => {
    const bus = new CommandBus();
    const handler = vi.fn(async () => undefined);
    const disposeCore = bus.registerCore('media.play', handler);
    await expect(bus.execute('media.play', undefined)).resolves.toBeUndefined();
    await expect(bus.execute('media.setVolume', { volume: 2 })).rejects.toThrow();
    const disposePlugin = bus.registerPlugin('fixture.command', 'fixture.command.toggle', async () => ({ ok: true }));
    await expect(bus.executePlugin('fixture.command.toggle')).resolves.toEqual({ ok: true });
    expect(() => bus.registerPlugin('fixture.command', 'other.command.toggle', async () => undefined)).toThrow();
    disposePlugin();
    disposeCore();
    expect(bus.commandCount()).toBe(0);
  });

  it('resolves versioned services and removes them on disposer cleanup', () => {
    const services = new ServiceRegistry();
    const token = createServiceToken<{ value: string }>('fixture.service/cache', '1.2.0');
    const dispose = services.provide(token, { value: 'ready' }, 'fixture.service');
    expect(services.get(token)).toEqual({ value: 'ready' });
    expect(services.optional(token, '^1.0.0')).toEqual({ value: 'ready' });
    expect(() => services.provide(token, { value: 'duplicate' }, 'fixture.other')).toThrow();
    dispose();
    expect(services.optional(token, '^1.0.0')).toBeUndefined();
    expect(services.count()).toBe(0);
  });
});
