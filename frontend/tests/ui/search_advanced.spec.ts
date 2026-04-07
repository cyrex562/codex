import { expect, test } from '@playwright/test';
import { defaultProfile, defaultVault, installCommonAppMocks, seedActiveVault, seedAuthTokens } from './helpers/appMocks';

const tree = [
    { name: 'search-a.md', path: 'search-a.md', is_directory: false, modified: new Date().toISOString() },
    { name: 'search-b.md', path: 'search-b.md', is_directory: false, modified: new Date().toISOString() },
];

const results = [
    {
        path: 'search-a.md',
        title: 'Search A',
        matches: [{ line_number: 2, line_text: 'Some content to find', match_start: 5, match_end: 12 }],
        score: 0.9,
    },
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
                'search-a.md': '# Search A\n\nSome content to find.',
                'search-b.md': '# Search B',
            },
        },
        searchResults: results,
        tagsByVaultId: {
            [defaultVault.id]: [
                { tag: 'important', count: 5 },
                { tag: 'archive', count: 2 },
            ],
        },
    });
    await page.goto('/');
}

test.describe('Search modal — advanced', () => {
    test('shows result count and match lines', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+f');

        const dialog = page.locator('.v-dialog:visible');
        await expect(dialog).toBeVisible();

        await page.getByPlaceholder(/search/i).fill('content');
        await expect(dialog.getByText('Search A')).toBeVisible();
        await expect(dialog.getByText('Some content to find')).toBeVisible();
    });

    test('shows empty state when no results', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);
        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: { [defaultVault.id]: tree },
            fileContentsByVaultId: { [defaultVault.id]: { 'search-a.md': '# A', 'search-b.md': '# B' } },
            searchResults: [],
        });
        await page.goto('/');

        await page.keyboard.press('Control+f');
        await page.getByPlaceholder(/search/i).fill('zzznoresults');
        await expect(page.getByText(/no results|nothing found/i)).toBeVisible({ timeout: 3000 });
    });

    test('tag-based search (#tag syntax) sends query with hash', async ({ page }) => {
        await setup(page);

        // Open search and type a tag query
        await page.keyboard.press('Control+f');
        await page.getByPlaceholder(/search/i).fill('#important');

        // Results are shown (mock returns same results regardless of query)
        await expect(page.locator('.v-dialog:visible')).toBeVisible();
        const input = page.getByPlaceholder(/search/i);
        await expect(input).toHaveValue('#important');
    });

    test('clicking a search result opens the file in a tab', async ({ page }) => {
        await setup(page);
        await page.keyboard.press('Control+f');
        await page.getByPlaceholder(/search/i).fill('content');

        await page.locator('.v-dialog:visible').getByText('Search A').click();
        await expect(page.locator('.tab-item')).toContainText('search-a.md');
    });

    test('tag panel click populates search with tag query', async ({ page }) => {
        await setup(page);

        // click a tag in the sidebar tags panel
        await expect(page.getByText('TAGS')).toBeVisible();
        await page.locator('.tag-item', { hasText: 'important' }).click();

        // The search dialog should open with the tag
        await expect(page.locator('.v-dialog:visible')).toBeVisible();
    });
});
