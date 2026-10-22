import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as unknown as Record<string, unknown>;
    let callbackId = 0;
    const videos = ['one.mp4', 'two.mp4'].map((fileName) => ({ fileName, path: `C:\\Videos\\${fileName}` }));
    const recycled: string[] = [];
    const calls: string[] = [];
    host.recycled = recycled;
    host.nativeCalls = calls;
    host.recycleFailure = false;
    host.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    host.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => ++callbackId,
      unregisterCallback: () => undefined,
      convertFileSrc: (path: string) => path,
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        calls.push(command);
        if (command === 'get_launch_video') {
          return videos[0]?.path ?? null;
        }
        if (command === 'list_folder_videos') return videos.map((video) => ({ ...video }));
        if (command === 'find_matching_external_subtitle') return null;
        if (command.startsWith('list_')) return [];
        if (command === 'plugin:event|listen') return ++callbackId;
        if (command === 'plugin:window|is_fullscreen') return false;
        if (command === 'recycle_video') {
          await new Promise<void>((resolve) => { host.finishRecycle = resolve; });
          if (host.recycleFailure) throw new Error('fixture file locked');
          const path = args.path as string;
          recycled.push(path);
          const index = videos.findIndex((video) => video.path === path);
          if (index >= 0) videos.splice(index, 1);
        }
        return null;
      },
    };
  });
  await page.goto('/');
  await page.locator('.panel-tab').filter({ hasText: /^Playlist$/ }).click();
  await expect(page.locator('.playlist-item')).toHaveCount(2);
});

test('cancels, confirms, shows progress, refreshes the list and remembers the opt-out', async ({ page }) => {
  const rows = page.locator('.playlist-item');
  await rows.nth(1).locator('.playlist-delete-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Confirm', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'Do not ask again' })).toBeFocused();
  await page.getByRole('checkbox', { name: 'Do not ask again' }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('noir-player:skip-delete-confirmation'))).toBeNull();
  await rows.nth(1).locator('.playlist-delete-button').click();
  await page.getByRole('checkbox', { name: 'Do not ask again' }).check();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: 'test-results/playlist-delete-progress.png' });
  await page.evaluate(() => (window as unknown as { finishRecycle: () => void }).finishRecycle());
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('one.mp4');
  expect(await page.evaluate(() => localStorage.getItem('noir-player:skip-delete-confirmation'))).toBe('true');
  await rows.first().locator('.playlist-delete-button').click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { finishRecycle: () => void }).finishRecycle());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rows).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { recycled: string[] }).recycled)).toHaveLength(2);
});

test('preserves the list on recycling errors and permits retry', async ({ page }) => {
  await page.evaluate(() => { (window as unknown as { recycleFailure: boolean }).recycleFailure = true; });
  await page.locator('.playlist-delete-button').first().click();
  await page.screenshot({ path: 'test-results/playlist-delete-confirmation.png' });
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.evaluate(() => (window as unknown as { finishRecycle: () => void }).finishRecycle());
  await expect(page.getByRole('alert')).toContainText('Could not move');
  await expect(page.locator('.playlist-item')).toHaveCount(2);
  await page.evaluate(() => { (window as unknown as { recycleFailure: boolean }).recycleFailure = false; });
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.evaluate(() => (window as unknown as { finishRecycle: () => void }).finishRecycle());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.playlist-item')).toHaveCount(1);
  await expect(page.locator('.playlist-item-active')).toContainText('two.mp4');
});
