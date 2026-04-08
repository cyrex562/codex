import { expect, test } from '@playwright/test';
import { defaultProfile, defaultVault, installCommonAppMocks, seedActiveVault, seedAuthTokens } from './helpers/appMocks';

const characterType = {
    id: 'character',
    name: 'Character',
    plugin_id: 'worldbuilding',
    color: '#4A90D9',
    icon: 'mdi-account',
    labels: ['graphable'],
    show_on_create: ['name'],
    display_field: 'name',
    fields: [],
};

const graphData = {
    nodes: [
        { id: 'e1', label: 'Aria', entity_type: 'character', path: 'aria.md', vault_id: defaultVault.id },
        { id: 'e2', label: 'Lyra', entity_type: 'character', path: 'lyra.md', vault_id: defaultVault.id },
    ],
    edges: [
        { id: 'r1', source_id: 'e1', target_id: 'e2', relation_type: 'knows', label: 'knows' },
    ],
};

test.describe('Graph view', () => {
    test('opens Graph tab when "Graph view" button is clicked', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: { [defaultVault.id]: [] },
            entityTypes: [characterType],
            graphByVaultId: { [defaultVault.id]: graphData },
        });

        await page.goto('/');

        await page.locator('button[title="Graph view"]').click();

        // A "Graph" tab should appear in the tab bar
        await expect(page.locator('.tab-item')).toContainText('Graph');
    });

    test('graph view renders entity type filter chips', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: { [defaultVault.id]: [] },
            entityTypes: [characterType],
            graphByVaultId: { [defaultVault.id]: graphData },
        });

        await page.goto('/');
        await page.locator('button[title="Graph view"]').click();

        // Graph sidebar should show the Character type chip
        const graphSidebar = page.locator('.graph-sidebar');
        await expect(graphSidebar).toBeVisible({ timeout: 8000 });
        await expect(graphSidebar.getByText('Character')).toBeVisible();
    });

    test('graph shows node and edge counts', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: { [defaultVault.id]: [] },
            entityTypes: [characterType],
            graphByVaultId: { [defaultVault.id]: graphData },
        });

        await page.goto('/');
        await page.locator('button[title="Graph view"]').click();

        const graphSidebar = page.locator('.graph-sidebar');
        await expect(graphSidebar).toBeVisible({ timeout: 8000 });
        // Count display: "2 nodes · 1 edges"
        await expect(graphSidebar.getByText(/nodes/i)).toBeVisible();
        await expect(graphSidebar.getByText(/edges/i)).toBeVisible();
    });

    test('empty graph shows "No entities" empty state', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: { [defaultVault.id]: [] },
            entityTypes: [],
            graphByVaultId: { [defaultVault.id]: { nodes: [], edges: [] } },
        });

        await page.goto('/');
        await page.locator('button[title="Graph view"]').click();

        await expect(page.locator('.graph-view')).toBeVisible({ timeout: 8000 });
        await expect(page.locator('.graph-view').getByText('No entities')).toBeVisible();
    });

    test('filter search box is visible in graph sidebar', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: { [defaultVault.id]: [] },
            entityTypes: [characterType],
            graphByVaultId: { [defaultVault.id]: graphData },
        });

        await page.goto('/');
        await page.locator('button[title="Graph view"]').click();

        const graphSidebar = page.locator('.graph-sidebar');
        await expect(graphSidebar).toBeVisible({ timeout: 8000 });
        await expect(graphSidebar.locator('input[placeholder="Filter nodes…"]')).toBeVisible();
    });
});
