import { expect, test } from '@playwright/test';
import { defaultProfile, defaultVault, installCommonAppMocks, seedActiveVault, seedAuthTokens } from './helpers/appMocks';

test.describe('Vault import uploads', () => {
    test('queues multiple files and imports them through the dialog', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: {
                [defaultVault.id]: [],
            },
        });

        await page.goto('/');
        await page.locator('button[title="Import files or folders"]').click();

        await page.setInputFiles('[data-testid="import-files-input"]', [
            {
                name: 'alpha.md',
                mimeType: 'text/markdown',
                buffer: Buffer.from('# Alpha'),
            },
            {
                name: 'beta.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('Beta'),
            },
        ]);

        await expect(page.getByText('2 queued')).toBeVisible();
        await expect(page.getByText('alpha.md')).toBeVisible();
        await expect(page.getByText('beta.txt')).toBeVisible();

        await page.getByRole('button', { name: 'Import 2' }).click();

        await expect(page.getByText('Imported 2 files successfully.')).toBeVisible();
        await expect(page.locator('.file-tree-node', { hasText: 'alpha.md' })).toBeVisible();
        await expect(page.locator('.file-tree-node', { hasText: 'beta.txt' })).toBeVisible();
    });

    test('opens import dialog with folder target when dropping files on a tree folder', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installCommonAppMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: {
                [defaultVault.id]: [
                    {
                        name: 'Inbox',
                        path: 'Inbox',
                        is_directory: true,
                        modified: new Date().toISOString(),
                        children: [],
                    },
                ],
            },
        });

        await page.goto('/');
        const folderNode = page.locator('.file-tree-node', { hasText: 'Inbox' }).first();

        await folderNode.dispatchEvent('drop', {
            dataTransfer: await page.evaluateHandle(() => {
                const data = new DataTransfer();
                data.items.add(new File(['hello'], 'dropped.md', { type: 'text/markdown' }));
                return data;
            }),
        });

        await expect(page.getByText('Import files and folders')).toBeVisible();
        await expect(page.getByLabel('Target folder inside vault')).toHaveValue('Inbox');
        await expect(page.getByText('dropped.md')).toBeVisible();
    });
});
