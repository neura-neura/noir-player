import { expect, test } from '@playwright/test';

test('opens the plugin manager and toggles the first-party plugin', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('heading', { name: 'Noir Player' }).waitFor();
  await page.getByRole('button', { name: 'Plugin manager' }).click();

  const dialog = page.getByRole('dialog', { name: 'Plugin manager' });
  await expect(dialog).toBeVisible();
  const pluginCard = dialog.locator('.plugin-manager-card').filter({ hasText: 'Playback statistics' });
  await expect(pluginCard).toContainText('Active');

  await pluginCard.getByRole('button', { name: 'Disable' }).click();
  await expect(pluginCard).toContainText('Inactive');
  await pluginCard.getByRole('button', { name: 'Enable' }).click();
  await expect(pluginCard).toContainText('Active');
});
