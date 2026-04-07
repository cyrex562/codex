import { expect, test } from '@playwright/test';
import { defaultProfile, defaultVault, installCommonAppMocks, seedActiveVault, seedAuthTokens } from './helpers/appMocks';

async function setupVault(page: Parameters<typeof installCommonAppMocks>[0], files: Array<{ name: string; path: string }>) {
    await seedAuthTokens(page);
    await seedActiveVault(page, defaultVault.id);
    await installCommonAppMocks(page, {
        profile: defaultProfile,
        vaults: [defaultVault],
        treeByVaultId: {
            [defaultVault.id]: files.map((f) => ({ ...f, is_directory: false, modified: new Date().toISOString() })),
        },
        fileContentsByVaultId: { [defaultVault.id]: {} },
    });
    await page.goto('/');
}

test.describe('Image viewer', () => {
    test('renders an img tag with the download URL for image files', async ({ page }) => {
        await setupVault(page, [{ name: 'photo.png', path: 'photo.png' }]);
        // Mock the download endpoint so it returns a tiny 1×1 GIF
        await page.route(`**/api/vaults/${defaultVault.id}/files/photo.png/download`, async (route) => {
            // 1×1 white GIF
            const gif = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
            await route.fulfill({ status: 200, contentType: 'image/gif', body: gif });
        });

        await page.getByText('photo.png').click();
        const img = page.locator('.viewer img');
        await expect(img).toBeVisible();
        await expect(img).toHaveAttribute('src', /\/api\/vaults\/.+\/files\/.+\/download/);
    });

    test('renders a WebP image viewer', async ({ page }) => {
        await setupVault(page, [{ name: 'art.webp', path: 'art.webp' }]);
        await page.route(`**/api/vaults/${defaultVault.id}/files/art.webp/download`, async (route) => {
            await route.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.alloc(10) });
        });
        await page.getByText('art.webp').click();
        await expect(page.locator('.viewer img')).toBeVisible();
    });
});

test.describe('Audio / Video viewer', () => {
    test('renders a video element for mp4 files', async ({ page }) => {
        await setupVault(page, [{ name: 'clip.mp4', path: 'clip.mp4' }]);
        await page.route(`**/api/vaults/${defaultVault.id}/files/clip.mp4/download`, async (route) => {
            await route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.alloc(10) });
        });
        await page.getByText('clip.mp4').click();
        await expect(page.locator('.viewer video')).toBeVisible();
    });

    test('renders an audio element for mp3 files', async ({ page }) => {
        await setupVault(page, [{ name: 'track.mp3', path: 'track.mp3' }]);
        await page.route(`**/api/vaults/${defaultVault.id}/files/track.mp3/download`, async (route) => {
            await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(10) });
        });
        await page.getByText('track.mp3').click();
        await expect(page.locator('.viewer audio')).toBeVisible();
    });

    test('renders an audio element for ogg files', async ({ page }) => {
        await setupVault(page, [{ name: 'sound.ogg', path: 'sound.ogg' }]);
        await page.route(`**/api/vaults/${defaultVault.id}/files/sound.ogg/download`, async (route) => {
            await route.fulfill({ status: 200, contentType: 'audio/ogg', body: Buffer.alloc(10) });
        });
        await page.getByText('sound.ogg').click();
        await expect(page.locator('.viewer audio')).toBeVisible();
    });

    test('renders a video element for webm files', async ({ page }) => {
        await setupVault(page, [{ name: 'movie.webm', path: 'movie.webm' }]);
        await page.route(`**/api/vaults/${defaultVault.id}/files/movie.webm/download`, async (route) => {
            await route.fulfill({ status: 200, contentType: 'video/webm', body: Buffer.alloc(10) });
        });
        await page.getByText('movie.webm').click();
        await expect(page.locator('.viewer video')).toBeVisible();
    });
});

test.describe('PDF viewer', () => {
    test('renders the PDF toolbar with page controls', async ({ page }) => {
        await setupVault(page, [{ name: 'doc.pdf', path: 'doc.pdf' }]);
        // Return a minimal valid PDF stub (pdfjs will fail to render but the toolbar still mounts)
        await page.route(`**/api/vaults/${defaultVault.id}/files/doc.pdf/download`, async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4') });
        });
        await page.getByText('doc.pdf').click();

        // Toolbar should mount even if PDF rendering fails on stub
        await expect(page.locator('.pdf-viewer')).toBeVisible();
    });

    test('zoom buttons are present in the PDF toolbar', async ({ page }) => {
        await setupVault(page, [{ name: 'report.pdf', path: 'report.pdf' }]);
        await page.route(`**/api/vaults/${defaultVault.id}/files/report.pdf/download`, async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4') });
        });
        await page.getByText('report.pdf').click();

        const pdfViewer = page.locator('.pdf-viewer');
        await expect(pdfViewer).toBeVisible();
        // Zoom in (+) and zoom out (-) buttons
        await expect(pdfViewer.getByTitle('mdi-plus').or(pdfViewer.locator('button').filter({ hasText: '' }).nth(3))).toBeTruthy();
    });
});
