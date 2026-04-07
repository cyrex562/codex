import { expect, test } from '@playwright/test';
import { defaultProfile, defaultVault, installCommonAppMocks, seedActiveVault, seedAuthTokens } from './helpers/appMocks';

const NOTE_PATH = 'my-note.md';
const TEMPLATE_PATH = 'Templates/daily.md';
const TEMPLATE_CONTENT = '# {{date}}\n\n## Tasks\n\n- [ ] ';

async function setupWithTemplate(page: Parameters<typeof installCommonAppMocks>[0]) {
    await seedAuthTokens(page);
    await seedActiveVault(page, defaultVault.id);
    await installCommonAppMocks(page, {
        profile: defaultProfile,
        vaults: [defaultVault],
        treeByVaultId: {
            [defaultVault.id]: [
                { name: NOTE_PATH, path: NOTE_PATH, is_directory: false, modified: new Date().toISOString() },
                { name: 'Templates', path: 'Templates', is_directory: true, modified: new Date().toISOString() },
                { name: 'daily.md', path: TEMPLATE_PATH, is_directory: false, modified: new Date().toISOString() },
            ],
        },
        fileContentsByVaultId: {
            [defaultVault.id]: {
                [NOTE_PATH]: '',
                [TEMPLATE_PATH]: TEMPLATE_CONTENT,
            },
        },
    });
    await page.goto('/');
    await page.getByText(NOTE_PATH).click();
}

test.describe('Template selector', () => {
    test('opens the template dialog from sidebar action', async ({ page }) => {
        await setupWithTemplate(page);

        // The template button in the sidebar actions area
        await page.locator('button[title="Insert template"]').click();
        await expect(page.getByText('Insert Template')).toBeVisible();
    });

    test('lists available templates from the Templates folder', async ({ page }) => {
        await setupWithTemplate(page);

        await page.locator('button[title="Insert template"]').click();
        await expect(page.getByText('Insert Template')).toBeVisible();
        await expect(page.getByText('daily.md')).toBeVisible();
        await expect(page.getByText(TEMPLATE_PATH)).toBeVisible();
    });

    test('inserts template content into the active note', async ({ page }) => {
        await setupWithTemplate(page);

        await page.locator('button[title="Insert template"]').click();
        await expect(page.getByText('daily.md')).toBeVisible();

        // Click the template to insert it
        await page.locator('.v-list-item', { hasText: 'daily.md' }).click();

        // Dialog closes after insertion
        await expect(page.getByText('Insert Template')).not.toBeVisible();
        // Tab gets dirty indicator (content was updated)
        await expect(page.locator('.tab-item')).toContainText('●');
    });

    test('closes the dialog with the ✕ button', async ({ page }) => {
        await setupWithTemplate(page);

        await page.locator('button[title="Insert template"]').click();
        await expect(page.getByText('Insert Template')).toBeVisible();

        await page.locator('.v-card-title button[aria-label], .v-card-title .v-btn').last().click();
        await expect(page.getByText('Insert Template')).not.toBeVisible();
    });

    test('shows warning when no markdown tab is active', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);
        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: {
                [defaultVault.id]: [
                    { name: 'photo.png', path: 'photo.png', is_directory: false, modified: new Date().toISOString() },
                    { name: 'Templates', path: 'Templates', is_directory: true, modified: new Date().toISOString() },
                    { name: 'daily.md', path: TEMPLATE_PATH, is_directory: false, modified: new Date().toISOString() },
                ],
            },
            fileContentsByVaultId: { [defaultVault.id]: { [TEMPLATE_PATH]: TEMPLATE_CONTENT } },
        });
        await page.goto('/');
        await page.getByText('photo.png').click();

        await page.locator('button[title="Insert template"]').click();
        await expect(page.getByText('Templates can only be inserted into an active markdown tab')).toBeVisible();
    });

    test('shows empty state with Create Default Templates button when no templates exist', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);
        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: {
                [defaultVault.id]: [{ name: NOTE_PATH, path: NOTE_PATH, is_directory: false, modified: new Date().toISOString() }],
            },
            fileContentsByVaultId: { [defaultVault.id]: { [NOTE_PATH]: '' } },
        });
        await page.goto('/');
        await page.getByText(NOTE_PATH).click();

        await page.locator('button[title="Insert template"]').click();
        await expect(page.getByText('No templates found.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Create Default Templates' })).toBeVisible();
    });
});
