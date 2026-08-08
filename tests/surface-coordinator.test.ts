import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeSurfaceCoordinator } from '@/player/adapters/native-surface-coordinator';
import { command, setVideoMarginRatio } from 'tauri-plugin-libmpv-api';

vi.mock('tauri-plugin-libmpv-api', () => ({
  command: vi.fn(async () => undefined),
  setVideoMarginRatio: vi.fn(async () => undefined),
}));

describe('host-owned native surface coordinator', () => {
  beforeEach(() => vi.clearAllMocks());

  it('serializes margins, redraws and resets without exposing handles', async () => {
    const coordinator = new NativeSurfaceCoordinator({
      bridge: { isDesktop: true } as never,
      isMpvAvailable: () => true,
    });
    await coordinator.resize({ left: 0.1, bottom: 0.2 });
    expect(coordinator.getMargins()).toMatchObject({ left: 0.1, bottom: 0.2 });
    expect(setVideoMarginRatio).toHaveBeenCalledWith({ left: 0.1, right: 0, top: 0, bottom: 0.2 });
    expect(command).toHaveBeenCalledWith('redraw-frame');
    await coordinator.reset();
    expect(coordinator.getPhase()).toBe('hidden');
    coordinator.dispose();
    await coordinator.setMargins({ left: 1 });
    expect(setVideoMarginRatio).toHaveBeenCalledTimes(2);
  });
});
