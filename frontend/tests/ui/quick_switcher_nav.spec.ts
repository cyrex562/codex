import { expect, test } from '@playwright/test';
import { defaultProfile, defaultVault, installCommonAppMocks, seedActiveVault, seedAuthTokens } from './helpers/appMocks';

const tree = [
    { name: 'alpha.md', path: 'alpha.md', is_directory: false, modified: new Date().toISOString() },
    { name: 'beta.md', path: 'beta.md', is_directory: false, modified: new Date().toISOString() },
    { name: 'gamma.md', path: 'gamma.md', is_directory: false, modified: new Date().toISOString() },
];

async function setup(page: Parameters<typeof installCommonAppMocks>[0]) {
    await seedAuthTokens(page);
    await seedActiveVault(page, defaultVault.id);
    await installCommonAppMocks(page, {
        profile: defaultProfile,
        vaults: [defaultVault],
        treeByVaultId: { [defaultVault.id]: tree },
        fileContentsByVaultId: {
            [defaultVault.id]: {
                'alpha.md': '# Alpha',
                'beta.md': '# Beta',
                'gamma.md': '# Gamma',
            },
        },
    });
    await page.goto('/');
}

test.describe('Quick switcher — navigation', () => {
    test('opens with Ctrl+P and shows all vault files', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+p');

        const dialog = page.locator('.v-dialog:visible, [role="dialog"]');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('alpha.md')).toBeVisible();
        await expect(dialog.getByText('beta.md')).toBeVisible();
        await expect(dialog.getByText('gamma.md')).toBeVisible();
    });

    test('filters results by typed query', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+p');

        await page.keyboard.type('beta');
        const dialog = page.locator('.v-dialog:visible, [role="dialog"]');
        await expect(dialog.getByText('beta.md')).toBeVisible();
        await expect(dialog.getByText('alpha.md')).not.toBeVisible({ timeout: 1000 });
    });

    test('ArrowDown moves selection and Enter opens the file', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+p');

        // Move down to first item and select
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');

        // A tab should open
        await expect(page.locator('.tab-item')).not.toHaveCount(0);
    });

    test('Escape closes the quick switcher', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+p');

        const dialog = page.locator('.v-dialog:visible, [role="dialog"]');
        await expect(dialog).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('.v-dialog:visible')).not.toBeVisible({ timeout: 2000 });
    });

    test('opens with Ctrl+K as well', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+k');

        const dialog = page.locator('.v-dialog:visible, [role="dialog"]');
        await expect(dialog).toBeVisible();
    });

    test('clicking a result opens the file', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+p');

        const dialog = page.locator('.v-dialog:visible, [role="dialog"]');
        await dialog.getByText('gamma.md').click();
        await expect(page.locator('.tab-item')).toContainText('gamma.md');
    });

    test('shows no results message for unknown query', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+p');

        await page.keyboard.type('zzznomatch');
        await expect(page.locator('.v-dialog:visible, [role="dialog"]').getByText(/no (files|results)/i)).toBeVisible({ timeout: 2000 });
    });
});
