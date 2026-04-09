/**
 * Tauri capability wrapper.
 *
 * All Tauri-specific API calls are centralised here so they can be:
 *  - Guarded behind an `isTauri()` check (no-ops in the browser)
 *  - Mocked in Vitest via `vi.mock('@/utils/tauri')`
 *
 * NEVER import from `@tauri-apps/*` directly in Vue components or stores.
 * Import from this module instead.
 */

/**
 * Returns `true` when the app is running inside a Tauri WebView.
 *
 * In a normal browser the `__TAURI_INTERNALS__` object injected by Tauri's
 * IPC bridge is absent, so this reliably distinguishes the two environments.
 */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

/**
 * Open a native directory picker dialog.
 *
 * Returns the selected directory path, or `null` when:
 *  - The user cancels the dialog
 *  - The app is running in a browser (not Tauri)
 */
export const openDirectoryDialog = async (): Promise<string | null> => {
  if (!isTauri()) return null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({ directory: true, multiple: false });
    return typeof result === 'string' ? result : null;
  } catch {
    return null;
  }
};

/**
 * Open a native file open dialog filtered by the given extensions.
 *
 * Returns the selected file path, or `null` when cancelled / browser context.
 *
 * @param extensions - Array of extensions without leading dot, e.g. `['md', 'txt']`
 */
export const openFileDialog = async (extensions?: string[]): Promise<string | null> => {
  if (!isTauri()) return null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const filters = extensions?.length
      ? [{ name: 'Files', extensions }]
      : undefined;
    const result = await open({ directory: false, multiple: false, filters });
    return typeof result === 'string' ? result : null;
  } catch {
    return null;
  }
};

/**
 * Open a native save dialog.
 *
 * Returns the chosen save path or `null` when cancelled / browser context.
 */
export const saveFileDialog = async (
  defaultName?: string,
  extensions?: string[],
): Promise<string | null> => {
  if (!isTauri()) return null;
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const filters = extensions?.length
      ? [{ name: 'Files', extensions }]
      : undefined;
    const result = await save({ defaultPath: defaultName, filters });
    return typeof result === 'string' ? result : null;
  } catch {
    return null;
  }
};
