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

test('opens a repository catalog and shows independently selectable plugins', async ({ page }) => {
  await page.route('https://api.github.com/repos/example/collection', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ default_branch: 'main' }),
  }));
  await page.route('https://raw.githubusercontent.com/example/collection/main/noir.plugins.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 1,
      name: 'Example collection',
      description: 'Plugins from one repository',
      plugins: [
        { descriptor: 'plugins/one/noir.plugin.json' },
        { descriptor: 'plugins/two/noir.plugin.json' },
      ],
    }),
  }));
  await page.route('https://raw.githubusercontent.com/example/collection/main/plugins/one/noir.plugin.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      manifest: {
        id: 'example.one',
        name: 'Plugin one',
        version: '1.0.0',
        apiVersion: '^1.0.0',
        description: 'First test plugin',
        license: 'MIT',
        requestedCapabilities: [],
      },
      entry: 'dist/index.js',
    }),
  }));
  await page.route('https://raw.githubusercontent.com/example/collection/main/plugins/two/noir.plugin.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      manifest: {
        id: 'example.two',
        name: 'Plugin two',
        version: '1.0.0',
        apiVersion: '^1.0.0',
        description: 'Second test plugin',
        license: 'MIT',
        requestedCapabilities: [],
      },
      entry: 'dist/index.js',
    }),
  }));
  await page.route('https://raw.githubusercontent.com/example/collection/main/plugins/one/dist/index.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: 'export default {}',
  }));

  await page.goto('/');
  await page.getByRole('button', { name: 'Plugin manager' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plugin manager' });
  await dialog.getByLabel('https://github.com/owner/plugin-repository').fill('https://github.com/example/collection');
  await dialog.getByRole('button', { name: 'Open repository' }).click();

  const repository = dialog.locator('.plugin-manager-repository');
  await expect(repository).toContainText('Example collection');
  await expect(repository).toContainText('2 plugins found');
  await expect(repository.locator('.plugin-manager-discovered-card')).toHaveCount(2);
  await repository.locator('.plugin-manager-discovered-card').nth(1).getByRole('checkbox').uncheck();
  await repository.getByRole('button', { name: 'Install selected' }).click();
  await expect(dialog).toContainText('1 plugin added');
  await expect(dialog.locator('.plugin-manager-installed')).toContainText('Plugin one');
  await expect(dialog.locator('.plugin-manager-installed')).toContainText('Installed plugins');
});
