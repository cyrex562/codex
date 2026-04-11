import { expect, test, type Locator } from '@playwright/test';
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
    await expect(page.getByText('alpha.md')).toBeVisible();
}

async function openQuickSwitcher(page: Parameters<typeof installCommonAppMocks>[0], shortcut: 'Control+p' | 'Control+k' = 'Control+p') {
    await page.keyboard.press(shortcut);
    const search = page.getByPlaceholder('Search files…');
    await expect(search).toBeVisible();
    return search;
}

function resultTitle(dialog: Locator, name: string) {
    return dialog.locator('.v-list-item-title', { hasText: name }).first();
}

test.describe('Quick switcher — navigation', () => {
    test('opens with Ctrl+P and shows all vault files', async ({ page }) => {
        await setup(page);
        const search = await openQuickSwitcher(page);

        const dialog = search.locator('xpath=ancestor::div[contains(@class,"v-overlay")]').first();
        await expect(resultTitle(dialog, 'alpha.md')).toBeVisible();
        await expect(resultTitle(dialog, 'beta.md')).toBeVisible();
        await expect(resultTitle(dialog, 'gamma.md')).toBeVisible();
    });

    test('filters results by typed query', async ({ page }) => {
        await setup(page);
        const search = await openQuickSwitcher(page);

        await search.fill('beta');
        const dialog = search.locator('xpath=ancestor::div[contains(@class,"v-overlay")]').first();
        await expect(resultTitle(dialog, 'beta.md')).toBeVisible();
        await expect(resultTitle(dialog, 'alpha.md')).not.toBeVisible({ timeout: 1000 });
    });

    test('ArrowDown moves selection and Enter opens the file', async ({ page }) => {
        await setup(page);
        const search = await openQuickSwitcher(page);

        await search.press('ArrowDown');
        await search.press('Enter');

        await expect(page.locator('.tab-item.tab-active')).toContainText('beta.md');
    });

    test('Escape closes the quick switcher', async ({ page }) => {
        await setup(page);
        const search = await openQuickSwitcher(page);

        await search.press('Escape');
        await expect(search).not.toBeVisible({ timeout: 2000 });
    });

    test('opens with Ctrl+K as well', async ({ page }) => {
        await setup(page);
        await openQuickSwitcher(page, 'Control+k');
    });

    test('clicking a result opens the file', async ({ page }) => {
        await setup(page);
        const search = await openQuickSwitcher(page);

        const dialog = search.locator('xpath=ancestor::div[contains(@class,"v-overlay")]').first();
        await resultTitle(dialog, 'gamma.md').click();
        await expect(page.locator('.tab-item.tab-active')).toContainText('gamma.md');
    });

    test('shows no results message for unknown query', async ({ page }) => {
        await setup(page);
        const search = await openQuickSwitcher(page);

        await search.fill('zzznomatch');
        const dialog = search.locator('xpath=ancestor::div[contains(@class,"v-overlay")]').first();
        await expect(dialog.locator('.v-list-item')).toHaveCount(0);
    });
});
