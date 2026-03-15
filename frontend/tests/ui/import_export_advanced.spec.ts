import { expect, test } from '@playwright/test';
import {
    defaultProfile,
    defaultVault,
    installCommonAppMocks,
    seedActiveVault,
    seedAuthTokens,
} from './helpers/appMocks';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Install all standard app mocks, plus archive-specific route mocks. */
async function installWithArchiveMocks(
    page: Parameters<typeof installCommonAppMocks>[0],
    extraOptions: Parameters<typeof installCommonAppMocks>[1] = {},
) {
    await installCommonAppMocks(page, extraOptions);

    // Mock import-archive endpoint
    await page.route(/.*\/api\/vaults\/[^/]+\/import-archive.*/, async (route) => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                extracted: ['imported/hello.md', 'imported/sub/world.txt'],
                count: 2,
            }),
        });
    });

    // Mock download-zip endpoint – returns a minimal valid ZIP blob
    await page.route(/.*\/api\/vaults\/[^/]+\/download-zip$/, async (route) => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }
        // Return a tiny valid 22-byte empty ZIP (end-of-central-directory record)
        const emptyZip = Buffer.from(
            'PK\x05\x06\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00',
        );
        await route.fulfill({
            status: 200,
            contentType: 'application/zip',
            headers: {
                'Content-Disposition': 'attachment; filename="download.zip"',
            },
            body: emptyZip,
        });
    });

    // Mock download-tar endpoint
    await page.route(/.*\/api\/vaults\/[^/]+\/download-tar$/, async (route) => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/gzip',
            headers: {
                'Content-Disposition': 'attachment; filename="download.tar.gz"',
            },
            body: Buffer.from('\x1f\x8b\x08\x00'), // minimal gzip header
        });
    });
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('Import: conflict strategy selector', () => {
    test('shows conflict strategy dropdown in the import dialog', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installWithArchiveMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: { [defaultVault.id]: [] },
        });

        await page.goto('/');
        await page.locator('button[title="Import files or folders"]').click();

        // The conflict strategy select should be visible with its default label
        await expect(page.getByLabel('If a file already exists')).toBeVisible();

        // Default should be "Keep both (append timestamp)"
        await expect(page.getByLabel('If a file already exists')).toHaveValue('Keep both (append timestamp)');
    });
});

test.describe('Import: ZIP archive detection label', () => {
    test('shows archive count label when a zip file is queued', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installWithArchiveMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: { [defaultVault.id]: [] },
        });

        await page.goto('/');
        await page.locator('button[title="Import files or folders"]').click();

        // Queue a zip file
        await page.setInputFiles('[data-testid="import-files-input"]', [
            {
                name: 'vault-backup.zip',
                mimeType: 'application/zip',
                buffer: Buffer.from(
                    'PK\x05\x06\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00',
                ),
            },
        ]);

        // Should show "1 archive will be extracted"
        await expect(page.getByText('1 archive will be extracted')).toBeVisible();
    });

    test('imports a zip archive via the import-archive endpoint', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installWithArchiveMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: { [defaultVault.id]: [] },
        });

        await page.goto('/');
        await page.locator('button[title="Import files or folders"]').click();

        await page.setInputFiles('[data-testid="import-files-input"]', [
            {
                name: 'backup.zip',
                mimeType: 'application/zip',
                buffer: Buffer.from(
                    'PK\x05\x06\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00',
                ),
            },
        ]);

        await page.getByRole('button', { name: 'Import 1' }).click();

        // Success banner should appear
        await expect(page.getByText(/Imported .* file/)).toBeVisible();
    });
});

test.describe('Export: context menu on file tree node', () => {
    test('shows Export as ZIP and tar.gz in context menu for a folder', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installWithArchiveMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: {
                [defaultVault.id]: [
                    {
                        name: 'Notes',
                        path: 'Notes',
                        is_directory: true,
                        modified: new Date().toISOString(),
                        children: [],
                    },
                ],
            },
        });

        await page.goto('/');

        const folderNode = page.locator('.file-tree-node', { hasText: 'Notes' }).first();
        await folderNode.click({ button: 'right' });

        await expect(page.getByText('Export as ZIP')).toBeVisible();
        await expect(page.getByText('Export as tar.gz')).toBeVisible();
    });

    test('shows Export options in context menu for a file too', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installWithArchiveMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: {
                [defaultVault.id]: [
                    {
                        name: 'note.md',
                        path: 'note.md',
                        is_directory: false,
                        modified: new Date().toISOString(),
                        size: 100,
                    },
                ],
            },
        });

        await page.goto('/');

        const fileNode = page.locator('.file-tree-node', { hasText: 'note.md' }).first();
        await fileNode.click({ button: 'right' });

        await expect(page.getByText('Export as ZIP')).toBeVisible();
        await expect(page.getByText('Export as tar.gz')).toBeVisible();
    });
});

test.describe('Export: vault-level export button', () => {
    test('shows Export vault menu button in sidebar', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installWithArchiveMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: { [defaultVault.id]: [] },
        });

        await page.goto('/');

        await expect(page.locator('button[title="Export vault or folder"]')).toBeVisible();
    });

    test('Export menu contains ZIP and tar.gz options', async ({ page }) => {
        await seedAuthTokens(page);
        await seedActiveVault(page, defaultVault.id);

        await installWithArchiveMocks(page, {
            profile: defaultProfile,
            vaults: [defaultVault],
            treeByVaultId: {
                [defaultVault.id]: [
                    {
                        name: 'README.md',
                        path: 'README.md',
                        is_directory: false,
                        modified: new Date().toISOString(),
                        size: 50,
                    },
                ],
            },
        });

        await page.goto('/');
        await page.locator('button[title="Export vault or folder"]').click();

        await expect(page.getByText('Download as ZIP')).toBeVisible();
        await expect(page.getByText('Download as tar.gz')).toBeVisible();
    });
});
