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

test('refreshes repository changes and removes plugins deleted upstream', async ({ page }) => {
  let catalogRevision = 1;
  await page.route('https://api.github.com/repos/example/refreshable', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ default_branch: 'main' }),
  }));
  await page.route('https://raw.githubusercontent.com/example/refreshable/main/noir.plugins.json', (route) => {
    const plugins = catalogRevision === 3
      ? [{ descriptor: 'plugins/two/noir.plugin.json' }]
      : [
        { descriptor: 'plugins/one/noir.plugin.json' },
        ...(catalogRevision >= 2 ? [{ descriptor: 'plugins/two/noir.plugin.json' }] : []),
      ];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        name: 'Refreshable collection',
        description: 'Changes are available without reopening the panel.',
        plugins,
      }),
    });
  });
  await page.route('https://raw.githubusercontent.com/example/refreshable/main/plugins/one/noir.plugin.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      manifest: {
        id: 'example.one',
        name: catalogRevision === 1 ? 'Plugin one' : 'Plugin one updated',
        version: catalogRevision === 1 ? '1.0.0' : '1.1.0',
        apiVersion: '^1.0.0',
        description: catalogRevision === 1 ? 'First test plugin' : 'Updated test plugin metadata',
        license: 'MIT',
        requestedCapabilities: [],
      },
      entry: 'dist/index.js',
    }),
  }));
  await page.route('https://raw.githubusercontent.com/example/refreshable/main/plugins/two/noir.plugin.json', (route) => route.fulfill({
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
  await page.route('https://raw.githubusercontent.com/example/refreshable/main/plugins/one/dist/index.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: 'export default {}',
  }));

  await page.goto('/');
  await page.getByRole('button', { name: 'Plugin manager' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plugin manager' });
  await dialog.getByLabel('https://github.com/owner/plugin-repository').fill('https://github.com/example/refreshable');
  await dialog.getByRole('button', { name: 'Open repository' }).click();
  await dialog.getByRole('button', { name: 'Install selected' }).click();
  await expect(dialog.locator('.plugin-manager-installed')).toContainText('Plugin one');

  catalogRevision = 2;
  await dialog.getByRole('button', { name: 'Refresh' }).click();
  await expect(dialog.locator('.plugin-manager-repository')).toContainText('Plugin two');
  await expect(dialog.locator('.plugin-manager-installed')).toContainText('Plugin one updated');

  catalogRevision = 3;
  await dialog.getByRole('button', { name: 'Refresh' }).click();
  await expect(dialog.locator('.plugin-manager-repository')).toContainText('Plugin two');
  await expect(dialog.locator('.plugin-manager-installed')).not.toContainText('Plugin one updated');
});
