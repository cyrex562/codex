import { Page, Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorAlert: Locator;
  readonly brandingHeading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.usernameInput = page.locator('[data-testid="login-username-input"] input');
    this.passwordInput = page.locator('[data-testid="login-password-input"] input');
    this.submitButton = page.locator('[data-testid="login-submit-btn"]');
    this.errorAlert = page.locator('[data-testid="login-error-alert"]');
    this.brandingHeading = page.locator('text=Codex').first();
  }

  async goto() {
    await this.page.goto('/');
    // App will redirect to login if not authenticated
  }

  async login(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
    // Wait for login request to complete
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      // Ignore timeout - might already be loaded
    });
  }

  async waitForError() {
    await this.errorAlert.waitFor({ state: 'visible', timeout: 15000 });
  }

  async getErrorText(): Promise<string> {
    return await this.errorAlert.textContent() || '';
  }
}
