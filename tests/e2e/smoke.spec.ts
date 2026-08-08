import { expect, test } from '@playwright/test';

test('browser preview starts without a selected media or plugin error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Noir Player' })).toBeVisible();
  await expect(page.getByRole('button', { name: /choose video/i })).toBeVisible();
  await expect.poll(() => errors).toEqual([]);
});
