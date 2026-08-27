import { describe, expect, it, vi } from 'vitest';
import {
  createUpdaterController,
  type UpdaterResource,
  type UpdaterState,
} from '@/updater';

function fakeUpdate(): UpdaterResource {
  return {
    version: '0.2.0',
    currentVersion: '0.1.16',
    body: 'Mejoras de reproducción',
    date: '2026-08-23T00:00:00Z',
    downloadAndInstall: async (onEvent) => {
      onEvent?.({ event: 'Started', data: { contentLength: 100 } });
      onEvent?.({ event: 'Progress', data: { chunkLength: 40 } });
      onEvent?.({ event: 'Progress', data: { chunkLength: 60 } });
      onEvent?.({ event: 'Finished' });
    },
    close: vi.fn(async () => undefined),
  };
}

describe('updater controller', () => {
  it('reports an available update and download progress', async () => {
    const snapshots: UpdaterState[] = [];
    const relaunch = vi.fn(async () => undefined);
    const update = fakeUpdate();
    const controller = createUpdaterController({
      check: vi.fn(async () => update),
      relaunch,
      isWindows: () => false,
    });
    const unsubscribe = controller.subscribe((state) => snapshots.push(state));

    await expect(controller.check()).resolves.toMatchObject({ version: '0.2.0' });
    await controller.update();

    expect(snapshots.map((snapshot) => snapshot.phase)).toEqual(
      expect.arrayContaining(['checking', 'available', 'downloading', 'installing', 'relaunching']),
    );
    expect(snapshots.some((snapshot) => snapshot.progress === 100)).toBe(true);
    expect(relaunch).toHaveBeenCalledOnce();

    unsubscribe();
    controller.dispose();
  });

  it('does not call relaunch on Windows because the installer exits the app', async () => {
    const relaunch = vi.fn(async () => undefined);
    const controller = createUpdaterController({
      check: vi.fn(async () => fakeUpdate()),
      relaunch,
      isWindows: () => true,
    });

    await controller.update();

    expect(relaunch).not.toHaveBeenCalled();
    expect(controller.getState().phase).toBe('installing');
    controller.dispose();
  });

  it('reports up-to-date when the endpoint returns no update', async () => {
    const controller = createUpdaterController({
      check: vi.fn(async () => null),
      relaunch: vi.fn(async () => undefined),
    });

    await expect(controller.check()).resolves.toBeNull();
    expect(controller.getState().phase).toBe('up-to-date');
    controller.dispose();
  });

  it('keeps a user-readable error state when checking fails', async () => {
    const controller = createUpdaterController({
      check: vi.fn(async () => {
        throw new Error('endpoint unavailable');
      }),
      relaunch: vi.fn(async () => undefined),
    });

    await expect(controller.check()).rejects.toThrow('endpoint unavailable');
    expect(controller.getState()).toMatchObject({
      phase: 'error',
      error: 'endpoint unavailable',
    });
    controller.dispose();
  });
});
