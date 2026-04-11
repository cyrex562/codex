import { expect, test } from '@playwright/test';
import { defaultProfile, defaultVault, installCommonAppMocks, seedActiveVault, seedAuthTokens } from './helpers/appMocks';

const NOTE_PATH = 'conflict-note.md';
const BASE_VERSION = '# Draft\n\nInitial content.';
const LOCAL_APPEND = '\n\nLocal conflicting edit.';
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
        fileContentsByVaultId: { [defaultVault.id]: { [NOTE_PATH]: BASE_VERSION } },
    });

    let conflictTriggered = false;
    let writeAttempts = 0;
    await page.route(/.*\/api\/vaults\/[^/]+\/files\/.+/, async (route) => {
        const method = route.request().method();

        if (method === 'PUT') {
            writeAttempts += 1;
            if (writeAttempts === 1) {
                conflictTriggered = true;
                await route.fulfill({
                    status: 409,
                    contentType: 'application/json',
                    body: JSON.stringify({ message: 'Conflict detected' }),
                });
                return;
            }

            const payload = route.request().postDataJSON() as { content?: string; frontmatter?: Record<string, unknown> };
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    path: NOTE_PATH,
                    content: payload.content ?? '',
                    modified: new Date().toISOString(),
                    frontmatter: payload.frontmatter ?? {},
                }),
            });
            return;
        }

        if (method === 'GET' && conflictTriggered) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    path: NOTE_PATH,
                    content: SERVER_VERSION,
                    modified: new Date().toISOString(),
                    frontmatter: {},
                }),
            });
            return;
        }

        await route.fallback();
    });

    await page.goto('/');
    await page.getByText(NOTE_PATH).click();
    await page.locator('.markdown-editor').click();
    await page.keyboard.type(LOCAL_APPEND);
    await page.keyboard.press('Control+s');
    await expect(page.getByText('Resolve Conflict')).toBeVisible();
}

test.describe('Conflict resolver', () => {
    test('opens the conflict dialog with both versions visible', async ({ page }) => {
        await setupWithConflict(page);

        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('Resolve Conflict')).toBeVisible();
        await expect(dialog.getByText('Your version')).toBeVisible();
        await expect(dialog.getByText('Server version', { exact: true })).toBeVisible();
        // The conflict file path chip is shown
        await expect(dialog.getByText(NOTE_PATH, { exact: true })).toBeVisible();
    });

    test('shows warning alert about the conflict', async ({ page }) => {
        await setupWithConflict(page);
        await expect(page.getByText(/The file changed on disk/)).toBeVisible();
    });

    test('shows both text versions in readonly textareas', async ({ page }) => {
        await setupWithConflict(page);

        const textareas = page.locator('.conflict-textarea textarea:not([aria-hidden="true"])');
        await expect(textareas.first()).toHaveValue(/Local conflicting edit\./);
        await expect(textareas.nth(1)).toHaveValue(/Server version/);
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
