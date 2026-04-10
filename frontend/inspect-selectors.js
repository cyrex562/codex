const { chromium } = require('@playwright/test');

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
    console.log(`  - "${text}"`);
  }
  
  // Login
  await usernameInput.fill('admin');
  await passwordInput.fill('admin');
  await loginBtn.click();
  
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  
  console.log('\n=== AFTER LOGIN ===');
  console.log('Current URL:', page.url());
  
  // Check for settings/cog button
  const cogButton = await page.locator('[aria-label="Settings"]').or(page.locator('button:has-text("Settings")')).or(page.locator('.v-icon.mdi-cog'));
  console.log('Settings/cog button found:', await cogButton.count() > 0);
  
  // Check for all icons
  const allIcons = await page.locator('.v-icon').all();
  console.log('\nAll v-icons on main page:');
  for (const icon of allIcons.slice(0, 10)) {
    const classes = await icon.getAttribute('class');
    console.log(`  - ${classes}`);
  }
  
  // Check for sign out button
  const signOutBtn = await page.locator('button:has-text("Sign out")').or(page.locator('button:has-text("Sign Out")').or(page.locator('button:has-text("Logout")')));
  console.log('\nSign out button found:', await signOutBtn.count() > 0);
  
  await browser.close();
})();
