import { expect, test } from '@playwright/test';
import { defaultProfile, defaultVault, installCommonAppMocks, seedActiveVault, seedAuthTokens } from './helpers/appMocks';

const entityFile = 'aria.md';
const entityFileContent = `---
codex_type: character
codex_plugin: worldbuilding
codex_labels:
  - graphable
name: Aria
---
A skilled ranger.
`;

const entityResponse = {
    entity: {
        id: 'e1',
        vault_id: defaultVault.id,
        path: entityFile,
        entity_type: 'character',
        labels: ['graphable'],
        fields: JSON.stringify({ name: 'Aria' }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    },
    relations: [
        {
            id: 'r1',
            source_id: 'e1',
            source_path: entityFile,
            target_id: 'e2',
            target_path: 'lyra.md',
            relation_type: 'knows',
            is_inverse: false,
        },
        {
            id: 'r2',
            source_id: 'e3',
            source_path: 'elder.md',
            target_id: 'e1',
            target_path: entityFile,
            relation_type: 'mentors',
            is_inverse: true,
        },
    ],
};

test.describe('Entity relations panel', () => {
    test('relations panel appears when an entity file is opened', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: {
                [defaultVault.id]: [
                    { name: 'aria.md', path: entityFile, is_directory: false, modified: new Date().toISOString() },
                ],
            },
            fileContentsByVaultId: {
                [defaultVault.id]: { [entityFile]: entityFileContent },
            },
            entityByPathByVaultId: {
                [defaultVault.id]: { [entityFile]: entityResponse },
            },
        });

        await page.goto('/');

        // Open entity file
        await page.getByText('aria.md').click();
        await expect(page.locator('.tab-item')).toContainText('aria.md', { timeout: 8000 });

        // The relations panel should appear in the sidebar
        const relationsPanel = page.locator('.v-expansion-panel', { hasText: 'Relations' });
        await expect(relationsPanel).toBeVisible({ timeout: 8000 });
    });

    test('relations panel lists outgoing and incoming relations', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: {
                [defaultVault.id]: [
                    { name: 'aria.md', path: entityFile, is_directory: false, modified: new Date().toISOString() },
                ],
            },
            fileContentsByVaultId: {
                [defaultVault.id]: { [entityFile]: entityFileContent },
            },
            entityByPathByVaultId: {
                [defaultVault.id]: { [entityFile]: entityResponse },
            },
        });

        await page.goto('/');
        await page.getByText('aria.md').click();
        await expect(page.locator('.tab-item')).toContainText('aria.md', { timeout: 8000 });

        const relationsPanel = page.locator('.v-expansion-panel', { hasText: 'Relations' });
        await expect(relationsPanel).toBeVisible({ timeout: 8000 });

        // Expand the panel
        await relationsPanel.locator('.v-expansion-panel-title').click();

        // Should show both relations (outgoing: lyra.md, incoming: elder.md)
        await expect(relationsPanel.getByText('lyra')).toBeVisible();
        await expect(relationsPanel.getByText('elder')).toBeVisible();
    });

    test('relations panel shows relation count badge', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: {
                [defaultVault.id]: [
                    { name: 'aria.md', path: entityFile, is_directory: false, modified: new Date().toISOString() },
                ],
            },
            fileContentsByVaultId: {
                [defaultVault.id]: { [entityFile]: entityFileContent },
            },
            entityByPathByVaultId: {
                [defaultVault.id]: { [entityFile]: entityResponse },
            },
        });

        await page.goto('/');
        await page.getByText('aria.md').click();
        await expect(page.locator('.tab-item')).toContainText('aria.md', { timeout: 8000 });

        const relationsPanel = page.locator('.v-expansion-panel', { hasText: 'Relations' });
        await expect(relationsPanel).toBeVisible({ timeout: 8000 });

        // Badge should show "2" (two relations)
        await expect(relationsPanel.locator('.v-badge')).toContainText('2');
    });

    test('non-entity file does not show relations panel', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: {
                [defaultVault.id]: [
                    { name: 'notes.md', path: 'notes.md', is_directory: false, modified: new Date().toISOString() },
                ],
            },
            fileContentsByVaultId: {
                [defaultVault.id]: { 'notes.md': '# Just notes\n\nPlain file.\n' },
            },
            // No entityByPathByVaultId — triggers 404, panel should hide
        });

        await page.goto('/');
        await page.getByText('notes.md').click();
        await expect(page.locator('.tab-item')).toContainText('notes.md', { timeout: 8000 });

        // Wait briefly then assert panel is hidden
        await page.waitForTimeout(1000);
        const relationsPanel = page.locator('.v-expansion-panel', { hasText: 'Relations' });
        await expect(relationsPanel).not.toBeVisible();
    });

    test('clicking a relation opens a new tab for the target file', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: {
                [defaultVault.id]: [
                    { name: 'aria.md', path: entityFile, is_directory: false, modified: new Date().toISOString() },
                ],
            },
            fileContentsByVaultId: {
                [defaultVault.id]: {
                    [entityFile]: entityFileContent,
                    'World/Characters/lyra.md': '---\ncodex_type: character\nname: Lyra\n---\n',
                },
            },
            entityByPathByVaultId: {
                [defaultVault.id]: { [entityFile]: entityResponse },
            },
        });

        await page.goto('/');
        await page.getByText('aria.md').click();
        await expect(page.locator('.tab-item')).toContainText('aria.md', { timeout: 8000 });

        const relationsPanel = page.locator('.v-expansion-panel', { hasText: 'Relations' });
        await expect(relationsPanel).toBeVisible({ timeout: 8000 });
        await relationsPanel.locator('.v-expansion-panel-title').click();

        // Click the lyra relation to navigate
        await relationsPanel.getByText('lyra').click();

        // A new tab for lyra.md should open
        await expect(page.locator('.tab-item')).toContainText('lyra');
    });
});
