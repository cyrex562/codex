import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isTauri,
  openDirectoryDialog,
  openExternalUrl,
  openFileDialog,
  saveFileDialog,
  syncAddRemote,
  syncMapVault,
  syncListRemotes,
  syncListRemoteVaults,
  syncCreateRemoteVault,
  syncRemoveRemote,
  syncUnmapVault,
  syncStatus,
  syncStart,
  syncStop,
} from './tauri';

// Mock the Tauri dialog plugin (dynamic import inside tauri.ts).
// vi.mock is hoisted by Vitest, so it runs before any imports.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

// Mock the Tauri core `invoke` (dynamic import inside tauri.ts).
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

async function getTauriDialogMock() {
  return await import('@tauri-apps/plugin-dialog') as unknown as {
    open: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
}

async function getInvokeMock() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke as unknown as ReturnType<typeof vi.fn>;
}

function setTauriContext(active: boolean) {
  if (active) {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      writable: true,
      configurable: true,
    });
  } else {
    try { delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__']; } catch { /* noop */ }
    try { delete (window as unknown as Record<string, unknown>)['__TAURI__']; } catch { /* noop */ }
  }
}

beforeEach(() => {
  setTauriContext(false);
  vi.clearAllMocks();
});
afterEach(() => setTauriContext(false));

// ── isTauri ───────────────────────────────────────────────────────────────

describe('isTauri', () => {
  it('returns false in a plain browser environment', () => {
    expect(isTauri()).toBe(false);
  });

  it('returns true when __TAURI_INTERNALS__ is injected', () => {
    setTauriContext(true);
    expect(isTauri()).toBe(true);
  });

  it('returns true when __TAURI__ is present (Tauri v1 compatibility)', () => {
    Object.defineProperty(window, '__TAURI__', {
      value: {},
      writable: true,
      configurable: true,
    });
    expect(isTauri()).toBe(true);
  });
});

// ── openDirectoryDialog ───────────────────────────────────────────────────

describe('openDirectoryDialog', () => {
  it('returns null in a browser context (not Tauri)', async () => {
    expect(await openDirectoryDialog()).toBeNull();
  });

  it('returns the selected path in a Tauri context', async () => {
    setTauriContext(true);
    const { open } = await getTauriDialogMock();
    open.mockResolvedValue('/home/user/my-vault');

    expect(await openDirectoryDialog()).toBe('/home/user/my-vault');
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true }),
    );
  });

  it('returns null when the user cancels the dialog', async () => {
    setTauriContext(true);
    const { open } = await getTauriDialogMock();
    open.mockResolvedValue(null);

    expect(await openDirectoryDialog()).toBeNull();
  });

  it('returns null when the plugin throws (graceful error handling)', async () => {
    setTauriContext(true);
    const { open } = await getTauriDialogMock();
    open.mockRejectedValue(new Error('permission denied'));

    expect(await openDirectoryDialog()).toBeNull();
  });
});

// ── openFileDialog ────────────────────────────────────────────────────────

describe('openFileDialog', () => {
  it('returns null in browser context', async () => {
    expect(await openFileDialog(['md'])).toBeNull();
  });

  it('returns the selected file path in Tauri context', async () => {
    setTauriContext(true);
    const { open } = await getTauriDialogMock();
    open.mockResolvedValue('/docs/note.md');

    const result = await openFileDialog(['md', 'txt']);
    expect(result).toBe('/docs/note.md');
  });

  it('passes extension filters to the Tauri open() call', async () => {
    setTauriContext(true);
    const { open } = await getTauriDialogMock();
    open.mockResolvedValue('/docs/note.md');

    await openFileDialog(['md', 'txt']);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ name: 'Files', extensions: ['md', 'txt'] }],
        directory: false,
        multiple: false,
      }),
    );
  });

  it('omits filters when no extensions are provided', async () => {
    setTauriContext(true);
    const { open } = await getTauriDialogMock();
    open.mockResolvedValue('/docs/file.txt');

    await openFileDialog();
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ filters: undefined }),
    );
  });
});

// ── saveFileDialog ────────────────────────────────────────────────────────

describe('saveFileDialog', () => {
  it('returns null in browser context', async () => {
    expect(await saveFileDialog('output.md')).toBeNull();
  });

  it('returns the chosen save path in Tauri context', async () => {
    setTauriContext(true);
    const { save } = await getTauriDialogMock();
    save.mockResolvedValue('/home/user/export.md');

    const result = await saveFileDialog('export.md', ['md']);
    expect(result).toBe('/home/user/export.md');
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: 'export.md',
        filters: [{ name: 'Files', extensions: ['md'] }],
      }),
    );
  });

  it('returns null when the save dialog is cancelled', async () => {
    setTauriContext(true);
    const { save } = await getTauriDialogMock();
    save.mockResolvedValue(null);

    expect(await saveFileDialog('note.md')).toBeNull();
  });
});

// ── sync wrappers ────────────────────────────────────────────────────────────

describe('sync wrappers', () => {
  describe('in Tauri context (invoke arg mapping)', () => {
    beforeEach(() => setTauriContext(true));

    it('syncAddRemote calls invoke with snake_case command and camelCase args', async () => {
      const invoke = await getInvokeMock();
      invoke.mockResolvedValue('remote-id');

      const result = await syncAddRemote('http://x', 'obh_k');

      expect(invoke).toHaveBeenCalledWith('sync_add_remote', {
        baseUrl: 'http://x',
        apiKey: 'obh_k',
      });
      expect(result).toBe('remote-id');
    });

    it('syncMapVault calls invoke with snake_case command and camelCase args', async () => {
      const invoke = await getInvokeMock();
      invoke.mockResolvedValue(undefined);

      await syncMapVault('r', 'l', 'rv');

      expect(invoke).toHaveBeenCalledWith('sync_map_vault', {
        remoteId: 'r',
        localVaultId: 'l',
        remoteVaultId: 'rv',
      });
    });

    it('syncListRemoteVaults calls invoke with snake_case command and camelCase args', async () => {
      const invoke = await getInvokeMock();
      invoke.mockResolvedValue([]);

      await syncListRemoteVaults('r');

      expect(invoke).toHaveBeenCalledWith('sync_list_remote_vaults', {
        remoteId: 'r',
      });
    });

    it('syncCreateRemoteVault calls invoke with snake_case command and camelCase args', async () => {
      const invoke = await getInvokeMock();
      invoke.mockResolvedValue({ id: 'v1', name: 'n' });

      await syncCreateRemoteVault('r', 'n');

      expect(invoke).toHaveBeenCalledWith('sync_create_remote_vault', {
        remoteId: 'r',
        name: 'n',
      });
    });

    it('syncRemoveRemote calls invoke with snake_case command and camelCase args', async () => {
      const invoke = await getInvokeMock();
      invoke.mockResolvedValue(undefined);

      await syncRemoveRemote('r');

      expect(invoke).toHaveBeenCalledWith('sync_remove_remote', {
        remoteId: 'r',
      });
    });

    it('syncUnmapVault calls invoke with snake_case command and camelCase args', async () => {
      const invoke = await getInvokeMock();
      invoke.mockResolvedValue(undefined);

      await syncUnmapVault('r', 'l');

      expect(invoke).toHaveBeenCalledWith('sync_unmap_vault', {
        remoteId: 'r',
        localVaultId: 'l',
      });
    });

    it('syncListRemotes calls invoke with no args', async () => {
      const invoke = await getInvokeMock();
      invoke.mockResolvedValue([]);

      await syncListRemotes();

      expect(invoke).toHaveBeenCalledWith('sync_list_remotes');
    });

    it('syncStatus calls invoke with no args', async () => {
      const invoke = await getInvokeMock();
      invoke.mockResolvedValue([]);

      await syncStatus();

      expect(invoke).toHaveBeenCalledWith('sync_status');
    });

    it('syncStart calls invoke with no args', async () => {
      const invoke = await getInvokeMock();
      invoke.mockResolvedValue(undefined);

      await syncStart();

      expect(invoke).toHaveBeenCalledWith('sync_start');
    });

    it('syncStop calls invoke with no args', async () => {
      const invoke = await getInvokeMock();
      invoke.mockResolvedValue(undefined);

      await syncStop();

      expect(invoke).toHaveBeenCalledWith('sync_stop');
    });
  });

  describe('in browser context (no Tauri)', () => {
    it('syncStatus resolves to an empty array', async () => {
      expect(await syncStatus()).toEqual([]);
    });

    it('syncStop resolves as a no-op', async () => {
      await expect(syncStop()).resolves.toBeUndefined();
    });

    it('syncAddRemote rejects', async () => {
      await expect(syncAddRemote('http://x', 'k')).rejects.toThrow();
    });

    it('syncMapVault rejects', async () => {
      await expect(syncMapVault('r', 'l', 'rv')).rejects.toThrow();
    });

    it('syncListRemotes rejects', async () => {
      await expect(syncListRemotes()).rejects.toThrow();
    });

    it('syncStart rejects', async () => {
      await expect(syncStart()).rejects.toThrow();
    });
  });
});

// ── openExternalUrl (issue #31) ──────────────────────────────────────────────

describe('openExternalUrl', () => {
  it('invokes the open_external_url Tauri command with the given url', async () => {
    setTauriContext(true);
    const invoke = await getInvokeMock();
    invoke.mockResolvedValueOnce(undefined);

    const ok = await openExternalUrl('https://example.com');

    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('open_external_url', {
      url: 'https://example.com',
    });
  });

  it('returns false when the Tauri command rejects (unsupported scheme)', async () => {
    setTauriContext(true);
    const invoke = await getInvokeMock();
    invoke.mockRejectedValueOnce(new Error('refusing: file://'));

    const ok = await openExternalUrl('file:///etc/passwd');

    expect(ok).toBe(false);
  });

  it('falls back to window.open with noopener,noreferrer in a browser context', async () => {
    // No Tauri context — use the DOM path.
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);

    const ok = await openExternalUrl('https://example.com');

    expect(ok).toBe(true);
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
  });

  it('returns false when a popup blocker or exception blocks window.open', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const ok = await openExternalUrl('https://blocked.example');
    expect(ok).toBe(false);
    openSpy.mockRestore();
  });
});
