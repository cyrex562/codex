import { expect, test } from '@playwright/test';
import { defaultProfile, defaultVault, installCommonAppMocks, seedActiveVault, seedAuthTokens } from './helpers/appMocks';

const NOTE = 'insight-note.md';
const CONTENT = '# Intro\n\nSome text.\n\n## Details\n\nMore text.';

async function setup(page: Parameters<typeof installCommonAppMocks>[0]) {
    await seedAuthTokens(page);
    await seedActiveVault(page, defaultVault.id);
    await installCommonAppMocks(page, {
        profile: defaultProfile,
        vaults: [defaultVault],
        treeByVaultId: {
            [defaultVault.id]: [{ name: NOTE, path: NOTE, is_directory: false, modified: new Date().toISOString() }],
        },
        fileContentsByVaultId: { [defaultVault.id]: { [NOTE]: CONTENT } },
        outlineResult: {
            summary: 'This note introduces a concept and provides details.',
            sections: [
                { line_number: 1, level: 1, title: 'Intro', summary: 'Introductory section' },
                { line_number: 5, level: 2, title: 'Details', summary: 'Detailed section' },
            ],
        },
    });
    await page.goto('/');
    await page.getByText(NOTE).click();
}

test.describe('AI Insights panel', () => {
    test('shows the AI INSIGHTS panel with Generate outline button', async ({ page }) => {
        await setup(page);
        await expect(page.getByText('AI INSIGHTS')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Generate outline' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Suggest organization' })).toBeVisible();
    });

    test('clicking Generate outline shows summary and sections', async ({ page }) => {
        await setup(page);
        await page.getByRole('button', { name: 'Generate outline' }).click();

        await expect(page.getByText('This note introduces a concept and provides details.')).toBeVisible();
        await expect(page.getByText('Intro')).toBeVisible();
        await expect(page.getByText('Details')).toBeVisible();
    });

    test('clicking Suggest organization shows suggestions', async ({ page }) => {
        await setup(page);
        await page.getByRole('button', { name: 'Suggest organization' }).click();

        await expect(page.getByText('Move to subfolder').or(page.getByText('Add tags'))).toBeVisible();
    });
});
