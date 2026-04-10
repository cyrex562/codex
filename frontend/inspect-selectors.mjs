import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Go to login page
  await page.goto('http://localhost:8080');
  await page.waitForLoadState('networkidle');
  
  console.log('=== LOGIN PAGE ===');
  
  // Check for username input
  const usernameInput = await page.locator('input[type="text"]').first();
  console.log('Username input found:', await usernameInput.count() > 0);
  
  // Check for password input
  const passwordInput = await page.locator('input[type="password"]').first();
  console.log('Password input found:', await passwordInput.count() > 0);
  
  // Check for login button
  const loginBtn = await page.locator('button:has-text("Sign In")');
  console.log('Sign In button found:', await loginBtn.count() > 0);
  
  // Try alternative selectors
  const allButtons = await page.locator('button').all();
  console.log('\nAll buttons on login page:');
  for (const btn of allButtons) {
    const text = await btn.textContent();
    console.log(`  - "${text?.trim()}"`);
  }
  
  // Login
  await usernameInput.fill('admin');
  await passwordInput.fill('admin');
  await loginBtn.click();
  
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  
  console.log('\n=== AFTER LOGIN ===');
  console.log('Current URL:', page.url());
  
  // Check for toolbar buttons
  const toolbar = await page.locator('.v-toolbar').first();
  const toolbarButtons = await toolbar.locator('button').all();
  console.log('\nToolbar buttons:');
  for (const btn of toolbarButtons) {
    const text = await btn.textContent();
    const icons = await btn.locator('.v-icon').all();
    let iconClasses = [];
    for (const icon of icons) {
      iconClasses.push(await icon.getAttribute('class'));
    }
    console.log(`  - Text: "${text?.trim()}", Icons: ${iconClasses.join(', ')}`);
  }
  
  // Check for menu buttons
  const menuButtons = await page.locator('[role="button"]').all();
  console.log('\nAll role="button" elements:', menuButtons.length);
  
  await browser.close();
})();
