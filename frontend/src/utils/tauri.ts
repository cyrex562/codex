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

import type { Vault } from '@/api/types';

// ── Sync API types ──────────────────────────────────────────────────────────
export interface SyncRemoteDto {
  id: string;
  base_url: string;
  enabled: boolean;
}

export type SyncVaultState = 'offline' | 'connecting' | 'syncing' | 'catching_up' | 'live';

export interface SyncVaultStatus {
  remote_id: string;
  local_vault_id: string;
  state: SyncVaultState;
  last_synced_seq: number;
  pending_outbox: number;
  last_error: string | null;
  /** Files processed so far in the current reconcile pass. */
  synced: number;
  /** Total files to process in the current reconcile pass (0 when idle). */
  total: number;
}

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

// ── Desktop sync API wrappers ───────────────────────────────────────────────

/**
 * Add a new sync remote.
 *
 * @param baseUrl - The base URL of the sync server
 * @param apiKey - The API key for authentication
 * @returns The ID of the created remote
 * @throws Error in browser context
 */
export const syncAddRemote = async (
  baseUrl: string,
  apiKey: string,
): Promise<string> => {
  if (!isTauri()) throw new Error('sync is only available in the desktop app');
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke('sync_add_remote', { baseUrl, apiKey });
};

/**
 * Map a remote vault to a local vault.
 *
 * @param remoteId - The ID of the remote
 * @param localVaultId - The ID of the local vault
 * @param remoteVaultId - The ID of the remote vault
 * @throws Error in browser context
 */
export const syncMapVault = async (
  remoteId: string,
  localVaultId: string,
  remoteVaultId: string,
): Promise<void> => {
  if (!isTauri()) throw new Error('sync is only available in the desktop app');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('sync_map_vault', { remoteId, localVaultId, remoteVaultId });
};

/**
 * List all configured sync remotes.
 *
 * @returns Array of remote DTOs
 * @throws Error in browser context
 */
export const syncListRemotes = async (): Promise<SyncRemoteDto[]> => {
  if (!isTauri()) throw new Error('sync is only available in the desktop app');
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke('sync_list_remotes');
};

/**
 * List vaults available on a remote.
 *
 * @param remoteId - The ID of the remote
 * @returns Array of vaults from the remote
 * @throws Error in browser context
 */
export const syncListRemoteVaults = async (
  remoteId: string,
): Promise<Vault[]> => {
  if (!isTauri()) throw new Error('sync is only available in the desktop app');
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke('sync_list_remote_vaults', { remoteId });
};

/**
 * Create a new vault on a remote.
 *
 * @param remoteId - The ID of the remote
 * @param name - The name for the new vault
 * @returns The created vault
 * @throws Error in browser context
 */
export const syncCreateRemoteVault = async (
  remoteId: string,
  name: string,
): Promise<Vault> => {
  if (!isTauri()) throw new Error('sync is only available in the desktop app');
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke('sync_create_remote_vault', { remoteId, name });
};

/**
 * Remove a sync remote.
 *
 * @param remoteId - The ID of the remote to remove
 * @throws Error in browser context
 */
export const syncRemoveRemote = async (remoteId: string): Promise<void> => {
  if (!isTauri()) throw new Error('sync is only available in the desktop app');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('sync_remove_remote', { remoteId });
};

/**
 * Unmap a vault from a remote.
 *
 * @param remoteId - The ID of the remote
 * @param localVaultId - The ID of the local vault
 * @throws Error in browser context
 */
export const syncUnmapVault = async (
  remoteId: string,
  localVaultId: string,
): Promise<void> => {
  if (!isTauri()) throw new Error('sync is only available in the desktop app');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('sync_unmap_vault', { remoteId, localVaultId });
};

/**
 * Get the current sync status of all vaults.
 *
 * @returns Array of vault sync statuses, or empty array in browser context
 */
export const syncStatus = async (): Promise<SyncVaultStatus[]> => {
  if (!isTauri()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke('sync_status');
};

/**
 * Start the sync service.
 *
 * @throws Error in browser context
 */
export const syncStart = async (): Promise<void> => {
  if (!isTauri()) throw new Error('sync is only available in the desktop app');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('sync_start');
};

/**
 * Stop the sync service.
 *
 * No-op in browser context.
 */
export const syncStop = async (): Promise<void> => {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('sync_stop');
};
