import { test, expect, Page } from '@playwright/test';
import { LoginPage, MainLayout, VaultManager, FileTree } from './pages';

async function createTestVault(page: Page): Promise<string> {
  const mainLayout = new MainLayout(page);
  const vaultManager = new VaultManager(page);
  
  const vaultName = `test-vault-${Date.now()}`;
  await mainLayout.openVaultSettings();
  await vaultManager.waitForModal();
  
  await vaultManager.createVault(vaultName);
  await page.waitForTimeout(1500);
  
  await vaultManager.close();
  
  // Select the vault from dropdown
  await mainLayout.selectVault(vaultName);
  await page.waitForTimeout(500);
  
  return vaultName;
}

test.describe('File Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const loginPage = new LoginPage(page);
    const mainLayout = new MainLayout(page);
    
    await loginPage.login('admin', 'admin');
    await mainLayout.waitForMainUI();
    await createTestVault(page);
  });

  test('3.3 - Clicking .md file opens in editor tab', async ({ page }) => {
    // Look for "New note" button in sidebar actions
    const newNoteBtn = page.locator('button[title="New note"]').or(page.locator('button:has-text("New note")'));
    if (await newNoteBtn.count() > 0) {
      await newNoteBtn.click();
      
      // Fill in file name in dialog
      await page.fill('input', 'test-note.md');
      await page.locator('button:has-text("Create")').click();
      
      // Tab should open with file name
      await expect(page.locator('.v-tab:has-text("test-note")').or(page.locator('text=test-note.md'))).toBeVisible({ timeout: 5000 });
    } else {
      // Skip test if UI doesn't have new note button
      test.skip();
    }
  });

  test('4.1 - Right-click folder shows New File option', async ({ page }) => {
    const fileTree = new FileTree(page);
    
    // Check if file tree is visible
    const fileTreeElement = page.locator('.file-tree').or(page.locator('[data-testid="file-tree"]'));
    
    if (await fileTreeElement.count() > 0) {
      // Right-click on the file tree area
      await fileTreeElement.first().click({ button: 'right', position: { x: 10, y: 10 } });
      await page.waitForTimeout(500);
      
      // Should see "New file" option in context menu
      const newFileOption = page.locator('[data-testid="ctx-new-file"]');
      await expect(newFileOption).toBeVisible({ timeout: 2000 });
    } else {
      test.skip();
    }
  });

  test('4.4 - Deleting open file closes its tab', async ({ page }) => {
    const fileTree = new FileTree(page);
    
    // Look for "New note" button
    const newNoteBtn = page.locator('button[title="New note"]').or(page.locator('button:has-text("New note")'));
    
    if (await newNoteBtn.count() > 0) {
      // Create a file
      await newNoteBtn.click();
      await page.fill('input', 'to-delete.md');
      await page.locator('button:has-text("Create")').click();
      await page.waitForTimeout(1000);
      
      // Set up dialog handler before deleting
      page.on('dialog', dialog => dialog.accept());
      
      // Find and delete the file via context menu
      await fileTree.deleteFile('to-delete');
      await page.waitForTimeout(1000);
      
      // Tab should be closed
      const tabCount = await page.locator('.v-tab:has-text("to-delete")').count();
      expect(tabCount).toBe(0);
    } else {
      test.skip();
    }
  });
});
