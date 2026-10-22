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

test('always confirms normal clicks, ignores old preferences and refreshes the list', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('noir-player:skip-delete-confirmation', 'true'));
  const rows = page.locator('.playlist-item');
  await rows.nth(1).locator('.playlist-delete-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Confirm', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(page.getByRole('dialog').getByRole('checkbox')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await rows.nth(1).locator('.playlist-delete-button').click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: 'test-results/playlist-delete-progress.png' });
  await page.evaluate(() => (window as unknown as { finishRecycle: () => void }).finishRecycle());
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('one.mp4');
  await rows.first().locator('.playlist-delete-button').click();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { finishRecycle: () => void }).finishRecycle());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rows).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { recycled: string[] }).recycled)).toHaveLength(2);
});

test('fills the button during a one-second hold and recycles without confirmation', async ({ page }) => {
  const button = page.locator('.playlist-delete-button').nth(1);
  await button.hover();
  await page.mouse.down();
  await expect(button).toHaveClass(/playlist-delete-holding/);
  await expect.poll(async () => button.locator('.playlist-delete-fill').evaluate((fill) =>
    new DOMMatrix(getComputedStyle(fill).transform).a,
  )).toBeGreaterThan(0.2);
  await page.screenshot({ path: 'test-results/playlist-delete-hold-fill.png' });
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  await page.mouse.up();
  await page.evaluate(() => (window as unknown as { finishRecycle: () => void }).finishRecycle());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.playlist-item')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { recycled: string[] }).recycled)).toEqual(['C:\\Videos\\two.mp4']);
  // A normal click on the remaining video still opens confirmation.
  await page.locator('.playlist-delete-button').click();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
});

test('cancels holds on early release or leaving the button', async ({ page }) => {
  await page.clock.install();
  const button = page.locator('.playlist-delete-button').nth(1);
  await button.hover();
  await page.mouse.down();
  await page.clock.runFor(500);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await button.hover();
  await page.mouse.down();
  await page.clock.runFor(500);
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await page.clock.runFor(1500);
  await expect(button).not.toHaveClass(/playlist-delete-holding/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { recycled: string[] }).recycled)).toHaveLength(0);
  const commands = await page.evaluate(() => (window as unknown as { nativeCalls: string[] }).nativeCalls);
  expect(commands).not.toContain('recycle_video');
});

test('keyboard activation always opens confirmation', async ({ page }) => {
  const button = page.locator('.playlist-delete-button').nth(1);
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await button.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
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
