import { expect, test } from '@playwright/test';
import { defaultProfile, defaultVault, installCommonAppMocks, seedActiveVault, seedAuthTokens } from './helpers/appMocks';

const NOTE = 'shortcut-test.md';
const INITIAL_CONTENT = '# Shortcut test\n\nSome content here.';

async function setup(page: Parameters<typeof installCommonAppMocks>[0]) {
    await seedAuthTokens(page);
    await seedActiveVault(page, defaultVault.id);
    await installCommonAppMocks(page, {
        profile: defaultProfile,
        vaults: [defaultVault],
        treeByVaultId: {
            [defaultVault.id]: [{ name: NOTE, path: NOTE, is_directory: false, modified: new Date().toISOString() }],
        },
        fileContentsByVaultId: { [defaultVault.id]: { [NOTE]: INITIAL_CONTENT } },
    });
    await page.goto('/');
    await page.getByText(NOTE).click();
}

test.describe('Keyboard shortcuts', () => {
    test('Ctrl+S saves the note and clears dirty state', async ({ page }) => {
        await setup(page);

        // Type into editor to make it dirty
        const editor = page.locator('.cm-content, .CodeJar, [contenteditable="true"]').first();
        await editor.click();
        await editor.type(' extra');
        await expect(page.locator('.tab-item')).toContainText('●');

        await page.keyboard.press('Control+s');
        // After save the dirty indicator should clear within 2s
        await expect(page.locator('.tab-item')).not.toContainText('●', { timeout: 2000 });
    });

    test('Ctrl+F opens the search modal', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+f');
        await expect(page.locator('.v-dialog:visible')).toBeVisible();
    });

    test('Ctrl+P opens the quick switcher', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+p');
        await expect(page.locator('.v-dialog:visible, [role="dialog"]')).toBeVisible();
    });

    test('Ctrl+K opens the quick switcher', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+k');
        await expect(page.locator('.v-dialog:visible, [role="dialog"]')).toBeVisible();
    });

    test('Ctrl+1 switches editor to Plain (raw) mode', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+1');
        // In plain mode the toolbar still shows Bold (mode !== fully_rendered)
        await expect(page.getByTitle('Bold')).toBeVisible();
    });

    test('Ctrl+2 switches editor to Formatted mode', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+2');
        await expect(page.getByTitle('Bold')).toBeVisible();
        await expect(page.getByTitle('Collapse all foldable sections')).not.toBeDisabled();
    });

    test('Ctrl+3 switches editor to Preview mode', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+3');
        await expect(page.getByTitle('Bold')).not.toBeVisible();
        await expect(page.getByText('Preview mode — switch to Plain or Formatted to edit')).toBeVisible();
    });

    test('Escape closes the search modal', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+f');
        await expect(page.locator('.v-dialog:visible')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.v-dialog:visible')).not.toBeVisible({ timeout: 2000 });
    });
});
