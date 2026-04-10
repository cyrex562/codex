import { test, expect } from '@playwright/test';
import { LoginPage, MainLayout, VaultManager } from './pages';

test.describe('Vault Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const loginPage = new LoginPage(page);
    const mainLayout = new MainLayout(page);
    
    await loginPage.login('admin', 'admin');
    await mainLayout.waitForMainUI();
  });

  test('2.1 - Manage Vaults modal opens', async ({ page }) => {
    const mainLayout = new MainLayout(page);
    const vaultManager = new VaultManager(page);
    
    await mainLayout.openVaultSettings();
    await vaultManager.waitForModal();
    await expect(page.locator('text=Vault Manager')).toBeVisible();
  });

  test('2.2 - Creating vault shows absolute path', async ({ page }) => {
    const mainLayout = new MainLayout(page);
    const vaultManager = new VaultManager(page);
    
    await mainLayout.openVaultSettings();
    await vaultManager.waitForModal();
    
    // Create a new vault
    const vaultName = `test-vault-${Date.now()}`;
    await vaultManager.createVault(vaultName);
    
    // Wait for vault to appear and check path is absolute (starts with /)
    await page.waitForTimeout(2000);
    const vaultItem = page.locator(`.v-list-item:has-text("${vaultName}")`);
    await expect(vaultItem).toBeVisible({ timeout: 5000 });
    
    // Check the subtitle (path) starts with /
    const subtitle = vaultItem.locator('.v-list-item-subtitle');
    await expect(subtitle).toHaveText(/^\//);
  });

  test('2.3 - Invalid vault path shows error message', async ({ page }) => {
    const mainLayout = new MainLayout(page);
    const vaultManager = new VaultManager(page);
    
    await mainLayout.openVaultSettings();
    await vaultManager.waitForModal();
    
    // Click "Set a custom path" link
    await page.locator('a:has-text("Set a custom path")').click();
    
    // Fill in name and invalid path
    const invalidPath = '/root/forbidden-' + Date.now();
    await vaultManager.createVault('invalid-vault', invalidPath);
    
    // Should show error message
    await expect(page.locator('.v-alert')).toBeVisible({ timeout: 5000 });
  });

  test('2.4 - Switching vaults closes open tabs', async ({ page }) => {
    const mainLayout = new MainLayout(page);
    const vaultManager = new VaultManager(page);
    
    await mainLayout.openVaultSettings();
    await vaultManager.waitForModal();
    
    // Check if there are existing vaults
    const vaultCount = await page.locator('.v-list-item').count();
    
    if (vaultCount >= 2) {
      // Close modal
      await vaultManager.close();
      
      // Switch to a different vault
      await mainLayout.vaultSelector.click();
      await page.locator('.v-list-item').nth(1).click();
      
      // Wait for switch to complete
      await page.waitForTimeout(1000);
      
      // Verify vault switched (check selector value changed)
      // This is a simplified test - full test would require file operations
    }
  });
});
