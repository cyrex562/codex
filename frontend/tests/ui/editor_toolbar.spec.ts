import { expect, test } from '@playwright/test';
import { defaultProfile, defaultVault, installCommonAppMocks, seedActiveVault, seedAuthTokens } from './helpers/appMocks';

const NOTE_PATH = 'toolbar-test.md';
const NOTE_CONTENT = '# Hello\n\nThis is a test note.';

async function setup(page: Parameters<typeof installCommonAppMocks>[0]) {
    await seedAuthTokens(page);
    await seedActiveVault(page, defaultVault.id);
    await installCommonAppMocks(page, {
        profile: defaultProfile,
        vaults: [defaultVault],
        treeByVaultId: {
            [defaultVault.id]: [{ name: NOTE_PATH, path: NOTE_PATH, is_directory: false, modified: new Date().toISOString() }],
        },
        fileContentsByVaultId: { [defaultVault.id]: { [NOTE_PATH]: NOTE_CONTENT } },
    });
    await page.goto('/');
    await page.getByText(NOTE_PATH).click();
}

test.describe('Editor toolbar', () => {
    test('shows all formatting buttons in Plain and Formatted modes', async ({ page }) => {
        await setup(page);

        // default mode (formatted_raw) — toolbar buttons should be visible
        await expect(page.getByTitle('Bold')).toBeVisible();
        await expect(page.getByTitle('Italic')).toBeVisible();
        await expect(page.getByTitle('Strikethrough')).toBeVisible();
        await expect(page.getByTitle('Highlight')).toBeVisible();
        await expect(page.getByTitle('Inline code')).toBeVisible();
        await expect(page.getByTitle('Heading 1')).toBeVisible();
        await expect(page.getByTitle('Heading 2')).toBeVisible();
        await expect(page.getByTitle('Heading 3')).toBeVisible();
        await expect(page.getByTitle('Blockquote')).toBeVisible();
        await expect(page.getByTitle('Bulleted list')).toBeVisible();
        await expect(page.getByTitle('Numbered list')).toBeVisible();
        await expect(page.getByTitle('Task list')).toBeVisible();
        await expect(page.getByTitle('Insert link')).toBeVisible();
        await expect(page.getByTitle('Insert image')).toBeVisible();
        await expect(page.getByTitle('Insert table')).toBeVisible();
        await expect(page.getByTitle('Code block')).toBeVisible();
        await expect(page.getByTitle('Horizontal rule')).toBeVisible();
        await expect(page.getByTitle('Undo (Ctrl+Z)')).toBeVisible();
        await expect(page.getByTitle('Redo (Ctrl+Y)')).toBeVisible();
    });

    test('hides formatting buttons in Preview mode and shows mode label', async ({ page }) => {
        await setup(page);
        await page.getByRole('button', { name: 'Preview' }).click();

        await expect(page.getByTitle('Bold')).not.toBeVisible();
        await expect(page.getByText('Preview mode — switch to Plain or Formatted to edit')).toBeVisible();
    });

    test('mode toggle switches between Plain, Formatted, Preview', async ({ page }) => {
        await setup(page);

        // Start in Formatted
        await expect(page.getByRole('button', { name: 'Formatted' })).toBeVisible();

        // Switch to Plain
        await page.getByRole('button', { name: 'Plain' }).click();
        await expect(page.getByTitle('Bold')).toBeVisible();

        // Switch to Preview
        await page.getByRole('button', { name: 'Preview' }).click();
        await expect(page.getByTitle('Bold')).not.toBeVisible();

        // Switch back to Formatted
        await page.getByRole('button', { name: 'Formatted' }).click();
        await expect(page.getByTitle('Bold')).toBeVisible();
    });

    test('fold/unfold buttons are enabled only in Formatted mode', async ({ page }) => {
        await setup(page);

        // In Formatted mode — enabled
        await expect(page.getByTitle('Collapse all foldable sections')).not.toBeDisabled();
        await expect(page.getByTitle('Expand all folded sections')).not.toBeDisabled();

        // In Plain mode — disabled
        await page.getByRole('button', { name: 'Plain' }).click();
        await expect(page.getByTitle('Collapse all foldable sections')).toBeDisabled();
        await expect(page.getByTitle('Expand all folded sections')).toBeDisabled();
    });

    test('More options menu shows alternate list styles', async ({ page }) => {
        await setup(page);

        await page.getByTitle('More options').click();
        await expect(page.getByText('Extract selection to note')).toBeVisible();
        await expect(page.getByText('a, b, c \u2026')).toBeVisible();
        await expect(page.getByText('A, B, C \u2026')).toBeVisible();
        await expect(page.getByText('i, ii, iii \u2026')).toBeVisible();
        await expect(page.getByText('I, II, III \u2026')).toBeVisible();
    });

    test('clicking Bold button triggers save-debounce (tab remains or goes dirty)', async ({ page }) => {
        await setup(page);

        // Bold button click should not crash the app
        await page.getByTitle('Bold').click();
        // Tab is still present after clicking a toolbar button
        await expect(page.locator('.tab-item')).toContainText(NOTE_PATH);
    });
});
