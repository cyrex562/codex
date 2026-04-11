import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { defaultProfile, installCommonAppMocks, seedAuthTokens } from './helpers/appMocks';

async function gotoChangePw(page: Page) {
    await seedAuthTokens(page, 'tok', 'ref');
    await installCommonAppMocks(page, {
        profile: { ...defaultProfile, must_change_password: false },
        vaults: [],
    });
    await page.route('**/api/auth/change-password', async (route) => {
        const payload = route.request().postDataJSON() as { current_password?: string; new_password?: string };
        if (payload.current_password !== 'OldPass123!' || (payload.new_password?.length ?? 0) < 12) {
            await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid password' }) });
        } else {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
        }
    });
    await page.goto('/change-password');
}

test.describe('Change password page', () => {
    test('shows the change password form', async ({ page }) => {
        await gotoChangePw(page);
        await expect(page.getByLabel('Current password')).toBeVisible();
        await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Confirm new password')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Update password' })).toBeVisible();
    });

    test('shows error when passwords do not match', async ({ page }) => {
        await gotoChangePw(page);
        await page.getByLabel('Current password').fill('OldPass123!');
        await page.getByLabel('New password', { exact: true }).fill('NewSecurePass1!');
        await page.getByLabel('Confirm new password').fill('Mismatch1234!');
        await page.getByRole('button', { name: 'Update password' }).click();
        await expect(page.getByText(/do not match|mismatch/i)).toBeVisible();
    });

    test('shows error when new password is too short', async ({ page }) => {
        await gotoChangePw(page);
        await page.getByLabel('Current password').fill('OldPass123!');
        await page.getByLabel('New password', { exact: true }).fill('short');
        await page.getByLabel('Confirm new password').fill('short');
        await page.getByRole('button', { name: 'Update password' }).click();
        await expect(page.getByText('New password must be at least 12 characters.')).toBeVisible();
    });

    test('shows a sign out link', async ({ page }) => {
        await gotoChangePw(page);
        await expect(page.getByRole('link', { name: /sign out|log out/i }).or(page.getByRole('button', { name: /sign out|log out/i }))).toBeVisible();
    });
});
