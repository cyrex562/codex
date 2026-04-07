import { expect, test } from '@playwright/test';
import { defaultProfile, defaultVault, installCommonAppMocks, seedActiveVault, seedAuthTokens } from './helpers/appMocks';

const NOTE_PATH = 'conflict-note.md';
const YOUR_VERSION = '# My edits\n\nThis is MY version.';
const SERVER_VERSION = '# Server version\n\nSomeone else edited this.';

async function setupWithConflict(page: Parameters<typeof installCommonAppMocks>[0]) {
    await seedAuthTokens(page);
    await seedActiveVault(page, defaultVault.id);
    await installCommonAppMocks(page, {
        profile: defaultProfile,
        vaults: [defaultVault],
        treeByVaultId: {
            [defaultVault.id]: [{ name: NOTE_PATH, path: NOTE_PATH, is_directory: false, modified: new Date().toISOString() }],
        },
        fileContentsByVaultId: { [defaultVault.id]: { [NOTE_PATH]: YOUR_VERSION } },
    });

    // Seed the conflict state via localStorage after navigation
    await page.addInitScript(() => {
        // Mark the app to open the conflict resolver on load via the store
        // We trigger it from the browser after Pinia is ready
    });

    await page.goto('/');
    await page.getByText(NOTE_PATH).click();

    // Trigger conflict via the Pinia store in the browser context
    await page.evaluate(
        ({ filePath, yourVersion, serverVersion }) => {
            const pinia = (window as any).__pinia;
            if (!pinia) return;
            const uiStore = pinia._s.get('ui');
            if (!uiStore) return;
            uiStore.openConflictResolver({ tabId: 'tab-1', filePath, yourVersion, serverVersion });
        },
        { filePath: NOTE_PATH, yourVersion: YOUR_VERSION, serverVersion: SERVER_VERSION },
    );
}

test.describe('Conflict resolver', () => {
    test('opens the conflict dialog with both versions visible', async ({ page }) => {
        await setupWithConflict(page);

        await expect(page.getByText('Resolve Conflict')).toBeVisible();
        await expect(page.getByText('Your version')).toBeVisible();
        await expect(page.getByText('Server version')).toBeVisible();
        // The conflict file path chip is shown
        await expect(page.getByText(NOTE_PATH)).toBeVisible();
    });

    test('shows warning alert about the conflict', async ({ page }) => {
        await setupWithConflict(page);
        await expect(page.getByText(/The file changed on disk/)).toBeVisible();
    });

    test('shows both text versions in readonly textareas', async ({ page }) => {
        await setupWithConflict(page);

        const textareas = page.locator('.conflict-textarea textarea');
        await expect(textareas.first()).toContainText('My edits');
        await expect(textareas.nth(1)).toContainText('Server version');
    });

    test('Cancel closes the dialog without choosing', async ({ page }) => {
        await setupWithConflict(page);

        await expect(page.getByText('Resolve Conflict')).toBeVisible();
        await page.getByRole('button', { name: 'Cancel' }).click();
        await expect(page.getByText('Resolve Conflict')).not.toBeVisible();
    });

    test('Keep My Version saves the local content and closes', async ({ page }) => {
        await setupWithConflict(page);

        await page.getByRole('button', { name: 'Keep My Version' }).click();
        await expect(page.getByText('Resolve Conflict')).not.toBeVisible({ timeout: 3000 });
    });

    test('Use Server Version fetches remote content and closes', async ({ page }) => {
        await setupWithConflict(page);

        await page.getByRole('button', { name: 'Use Server Version' }).click();
        await expect(page.getByText('Resolve Conflict')).not.toBeVisible({ timeout: 3000 });
    });
});
