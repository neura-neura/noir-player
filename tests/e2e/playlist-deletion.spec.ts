import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as unknown as Record<string, unknown>;
    let callbackId = 0;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, string>();
    host.bridgeCalls = [];
    host.emitMpv = (payload: unknown) => {
      for (const [id, event] of listeners) {
        if (event === 'mpv-event-main') callbacks.get(id)?.({ event, id, payload });
      }
    };
    const videos = ['one.mp4', 'two.mp4'].map((fileName) => ({ fileName, path: `C:\\Videos\\${fileName}` }));
    const recycled: string[] = [];
    const calls: string[] = [];
    host.recycled = recycled;
    host.nativeCalls = calls;
    host.recycleFailure = false;
    host.renameFailure = null;
    host.renamed = [];
    host.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    host.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (callback: (event: unknown) => void) => {
        callbacks.set(++callbackId, callback);
        return callbackId;
      },
      unregisterCallback: () => undefined,
      convertFileSrc: (path: string) => path,
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        calls.push(command);
        (host.bridgeCalls as unknown[]).push({ command, ...args });
        if (command === 'plugin:libmpv|init' && location.search.includes('browser')) throw new Error('browser fallback fixture');
        if (command === 'prepare_video_playback_source') return host.fixtureSource ?? '/fixture.mp4';
        if (command === 'get_launch_video') {
          return videos[0]?.path ?? null;
        }
        if (command === 'list_folder_videos') return videos.map((video) => ({ ...video }));
        if (command === 'find_matching_external_subtitle') return null;
        if (command.startsWith('list_')) return [];
        if (command === 'plugin:event|listen') {
          listeners.set(args.handler as number, args.event as string);
          return args.handler;
        }
        if (command === 'plugin:window|is_fullscreen') return false;
        if (command === 'rename_video') {
          if (host.renameFailure) throw host.renameFailure;
          const video = videos.find((video) => video.path === args.path)!;
          const extension = video.fileName.slice(video.fileName.lastIndexOf('.'));
          video.fileName = `${args.name as string}${extension}`;
          video.path = `C:\\Videos\\${video.fileName}`;
          (host.renamed as unknown[]).push({ ...args });
          return { ...video };
        }
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


test('renames from the pencil, preserves the extension and updates real paths for subsequent actions', async ({ page }) => {
  const row = page.locator('.playlist-item').nth(1);
  await expect(row.locator('.playlist-action')).toHaveCount(0);
  await row.getByRole('button', { name: 'Rename video: two.mp4', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'File name' });
  await expect(input).toBeFocused();
  expect(await input.evaluate((node: HTMLInputElement) => node.value.slice(node.selectionStart!, node.selectionEnd!))).toBe('two');
  await expect(row).toContainText('This changes the file name on your computer');
  await expect(row.locator('.playlist-rename-extension')).toHaveText('.mp4');
  await input.fill('My new video');
  await page.keyboard.press('Enter');
  await expect(row).toContainText('My new video.mp4');
  await expect(page.getByRole('textbox', { name: 'File name' })).toHaveCount(0);
  await expect(row.locator('.playlist-play-button')).toHaveAttribute('title', 'C:\\Videos\\My new video.mp4');
  await row.locator('.playlist-delete-button').click();
  await expect(page.getByRole('dialog')).toContainText('My new video.mp4');
});

test('rename supports keyboard cancellation and reports collisions without discarding edits', async ({ page }) => {
  const row = page.locator('.playlist-item').nth(1);
  const pencil = row.locator('.playlist-rename-button');
  await pencil.focus();
  await page.keyboard.press('Space');
  const input = page.getByRole('textbox', { name: 'File name' });
  await input.fill('cancel this');
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(pencil).toBeFocused();
  await expect(row).toContainText('two.mp4');
  await pencil.click();
  await input.fill('one');
  await page.evaluate(() => { (window as unknown as { renameFailure: string | null }).renameFailure = 'exists'; });
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('alert')).toContainText('already exists');
  await expect(input).toHaveValue('one');
  await page.evaluate(() => { (window as unknown as { renameFailure: string | null }).renameFailure = null; });
  await input.fill('retry');
  await page.keyboard.press('Enter');
  await expect(row).toContainText('retry.mp4');
});

test('renaming the current video updates the active item and reloads on failure', async ({ page }) => {
  const row = page.locator('.playlist-item-active');
  await row.locator('.playlist-rename-button').click();
  const input = page.getByRole('textbox', { name: 'File name' });
  await input.fill('renamed current');
  await page.evaluate(() => { (window as unknown as { renameFailure: string | null }).renameFailure = 'inUse'; });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('in use');
  await expect(input).toHaveValue('renamed current');
  await expect(row).toHaveCount(1);
  await page.evaluate(() => { (window as unknown as { renameFailure: string | null }).renameFailure = null; });
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(row).toContainText('renamed current.mp4');
  await expect(row.locator('.playlist-play-button')).toHaveAttribute('title', 'C:\\Videos\\renamed current.mp4');
});


test('restores native position and paused state after renaming the playing file', async ({ page }) => {
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { nativeCalls: string[] }).nativeCalls.filter((call) => call === 'plugin:libmpv|init').length,
  )).toBeGreaterThan(0);
  await page.evaluate(() => {
    const host = window as unknown as { emitMpv: (event: unknown) => void; bridgeCalls: unknown[] };
    host.emitMpv({ event: 'file-loaded' });
    host.emitMpv({ event: 'property-change', name: 'duration', data: 300 });
    host.emitMpv({ event: 'property-change', name: 'time-pos', data: 87 });
    host.emitMpv({ event: 'property-change', name: 'pause', data: true });
  });
  await expect(page.locator('.native-time-readout')).toContainText('01:27');
  await page.locator('.panel-tab').filter({ hasText: /^Playlist$/ }).click();
  await page.locator('.playlist-item-active .playlist-rename-button').click();
  await page.getByRole('textbox', { name: 'File name' }).fill('current at 87');
  await page.evaluate(() => { (window as unknown as { bridgeCalls: unknown[] }).bridgeCalls = []; });
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.locator('.playlist-item-active')).toContainText('current at 87.mp4');
  await page.evaluate(() => (window as unknown as { emitMpv: (event: unknown) => void }).emitMpv({ event: 'file-loaded' }));
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { bridgeCalls: unknown[] }).bridgeCalls,
  )).toEqual(expect.arrayContaining([
    expect.objectContaining({ command: 'plugin:libmpv|command', name: 'seek', args: [87, 'absolute+exact'] }),
    expect.objectContaining({ command: 'plugin:libmpv|set_property', name: 'pause', value: true }),
  ]));
  await page.screenshot({ path: 'test-results/playlist-rename-updated.png' });
  await page.locator('.playlist-item-active .playlist-rename-button').click();
  await page.screenshot({ path: 'test-results/playlist-rename-editor.png' });
});


test('keeps the browser fallback at the same position when its file is renamed', async ({ page }) => {
  const fixture = await readFile('tests/fixtures/controls.mp4');
  await page.addInitScript((source) => { (window as unknown as { fixtureSource: string }).fixtureSource = source; },
    `data:video/mp4;base64,${fixture.toString('base64')}`);
  await page.goto('/?browser');
  await expect(page.locator('.plyr__controls')).toBeVisible();
  const video = page.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 7; });
  await page.locator('.panel-tab').filter({ hasText: /^Playlist$/ }).click();
  await expect(video).toHaveJSProperty('currentTime', 7);
  await page.locator('.playlist-item-active .playlist-rename-button').click();
  await page.getByRole('textbox', { name: 'File name' }).fill('fallback renamed');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.locator('.playlist-item-active')).toContainText('fallback renamed.mp4');
  await expect(video).toHaveJSProperty('readyState', 4);
  await expect(video).toHaveJSProperty('currentTime', 7);
  await expect(video).toHaveJSProperty('paused', true);
});
