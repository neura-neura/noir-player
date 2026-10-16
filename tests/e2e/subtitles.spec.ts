import { expect, test } from '@playwright/test';

test('VTT words reveal without moving the caption box and follow seeks while paused', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles('tests/fixtures/controls.mp4');
  const video = page.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await page.locator('input[type=file]').nth(1).setInputFiles('tests/fixtures/words.vtt');
  await page.locator('.panel-close').click();
  const seek = (time: number) => video.evaluate((element: HTMLVideoElement, nextTime) => { element.currentTime = nextTime; }, time);
  const visible = page.locator('.caption-visible');
  await seek(0.5);
  await expect(visible).toHaveText('Hola');
  const initialBox = await page.locator('.caption-text').boundingBox();
  await seek(2.5);
  await expect(visible).toHaveText('Hola mundo otra');
  const laterBox = await page.locator('.caption-text').boundingBox();
  expect(laterBox).toEqual(initialBox);
  await seek(1.2);
  await expect(visible).toHaveText('Hola mundo');
  await page.screenshot({ path: 'test-results/vtt-word-reveal.png', fullPage: true });
  await seek(4.2);
  await expect(visible).toHaveText('Una frase sin tiempos por palabra.');
  await expect(page.locator('.caption-measure')).toHaveCount(0);
  await seek(6.2);
  await expect(visible).toHaveCount(0);
});

test('embedded captions extracted from the supplied video preserve real rolling line times', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles('tests/fixtures/controls.mp4');
  const video = page.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await page.locator('input[type=file]').nth(1).setInputFiles('tests/fixtures/embedded-rolling.vtt');
  await page.locator('.panel-close').click();
  const visible = page.locator('.caption-visible');
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 0.5; });
  await expect(visible).toHaveText('Cuando una población se ve distraída por');
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 2.5; });
  await expect(visible).toHaveText('Cuando una población se ve distraída portrivialidades, cuando la vida cultural');
  await expect(page.locator('.caption-measure')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/vtt-embedded-rolling.png', fullPage: true });
});
