import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/utils/tauri', () => ({
    pairingSet: vi.fn(),
    pairingGet: vi.fn(),
    pairingClear: vi.fn(),
    syncStatus: vi.fn(),
    syncStart: vi.fn(),
    syncStop: vi.fn(),
    mobileFileTree: vi.fn(),
}));

import { pairingSet, pairingGet, pairingClear, syncStatus, syncStart, syncStop, mobileFileTree } from '@/utils/tauri';
import type { SyncVaultStatus } from '@/utils/tauri';
import { useSyncStore } from './sync';

function fileNode(overrides: Record<string, unknown> = {}) {
    return {
        name: 'note.md',
        path: 'note.md',
        is_directory: false,
        ...overrides,
    };
}

function status(overrides: Partial<SyncVaultStatus> = {}): SyncVaultStatus {
    return {
        remote_id: 'primary',
        local_vault_id: 'v1',
        state: 'live',
        last_synced_seq: 1,
        pending_outbox: 0,
        last_error: null,
        synced: 0,
        total: 0,
        ...overrides,
    };
}

describe('useSyncStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('loadPairing() populates pairing and marks it loaded', async () => {
        vi.mocked(pairingGet).mockResolvedValueOnce({ base_url: 'https://x', key_present: true });
        const store = useSyncStore();

        expect(store.pairingLoaded).toBe(false);
        await store.loadPairing();

        expect(store.pairingLoaded).toBe(true);
        expect(store.pairing).toEqual({ base_url: 'https://x', key_present: true });
        expect(store.isPaired).toBe(true);
    });

    it('loadPairing() with nothing paired leaves isPaired false', async () => {
        vi.mocked(pairingGet).mockResolvedValueOnce(null);
        const store = useSyncStore();

        await store.loadPairing();

        expect(store.isPaired).toBe(false);
    });

    it('pair() calls pairingSet then reloads pairing info', async () => {
        vi.mocked(pairingGet).mockResolvedValueOnce({ base_url: 'https://x', key_present: true });
        const store = useSyncStore();

        await store.pair('https://x', 'key');

        expect(pairingSet).toHaveBeenCalledWith('https://x', 'key');
        expect(store.isPaired).toBe(true);
    });

    it('pair() surfaces the validation error for an invalid key and leaves state unpaired', async () => {
        vi.mocked(pairingSet).mockRejectedValueOnce(new Error('could not validate the remote URL / API key'));
        const store = useSyncStore();

        await expect(store.pair('https://x', 'bad-key')).rejects.toThrow(/could not validate/);

        expect(store.isPaired).toBe(false);
        expect(store.error).toMatch(/could not validate/);
    });

    it('unpair() clears pairing and status state', async () => {
        vi.mocked(pairingGet).mockResolvedValueOnce({ base_url: 'https://x', key_present: true });
        const store = useSyncStore();
        await store.loadPairing();
        store.statuses = [status()];
        store.lastSyncedAt['v1'] = '2026-07-30T00:00:00.000Z';

        await store.unpair();

        expect(pairingClear).toHaveBeenCalled();
        expect(store.isPaired).toBe(false);
        expect(store.statuses).toEqual([]);
        expect(store.lastSyncedAt).toEqual({});
    });

    it('refreshStatus() stamps lastSyncedAt for vaults observed as live', async () => {
        vi.mocked(syncStatus).mockResolvedValueOnce([status({ state: 'live' }), status({ local_vault_id: 'v2', state: 'syncing' })]);
        const store = useSyncStore();

        expect(store.hasAnyMapping).toBe(false);
        await store.refreshStatus();

        expect(store.statusLoaded).toBe(true);
        expect(store.statuses).toHaveLength(2);
        expect(store.hasAnyMapping).toBe(true);
        expect(store.lastSyncedAt['v1']).toBeTruthy();
        expect(store.lastSyncedAt['v2']).toBeUndefined();
    });

    it('startSync()/stopSync() call through and refresh status', async () => {
        vi.mocked(syncStatus).mockResolvedValue([status()]);
        const store = useSyncStore();

        await store.startSync();
        expect(syncStart).toHaveBeenCalled();
        expect(store.statuses).toHaveLength(1);

        await store.stopSync();
        expect(syncStop).toHaveBeenCalled();
    });

    it('startPolling() polls on an interval and stopPolling() stops it', async () => {
        vi.useFakeTimers();
        vi.mocked(syncStatus).mockResolvedValue([status()]);
        const store = useSyncStore();

        store.startPolling();
        await vi.advanceTimersByTimeAsync(0);
        expect(syncStatus).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(3000);
        expect(syncStatus).toHaveBeenCalledTimes(2);

        store.stopPolling();
        await vi.advanceTimersByTimeAsync(6000);
        expect(syncStatus).toHaveBeenCalledTimes(2);
    });

    it('scanConflicts() finds conflict_* files nested in the tree and derives their original path', async () => {
        vi.mocked(syncStatus).mockResolvedValueOnce([status()]);
        const store = useSyncStore();
        await store.refreshStatus();

        vi.mocked(mobileFileTree).mockResolvedValueOnce([
            fileNode({
                name: 'folder',
                path: 'folder',
                is_directory: true,
                children: [
                    fileNode({ name: 'conflict_todo_20260730_120000.md', path: 'folder/conflict_todo_20260730_120000.md' }),
                    fileNode({ name: 'todo.md', path: 'folder/todo.md' }),
                ],
            }),
            fileNode({ name: 'conflict_README_20260730_120000', path: 'conflict_README_20260730_120000' }),
        ]);

        await store.scanConflicts();

        expect(store.conflictCount).toBe(2);
        expect(store.conflictFiles).toEqual([
            {
                vaultId: 'v1',
                path: 'folder/conflict_todo_20260730_120000.md',
                name: 'conflict_todo_20260730_120000.md',
                originalPath: 'folder/todo.md',
            },
            {
                vaultId: 'v1',
                path: 'conflict_README_20260730_120000',
                name: 'conflict_README_20260730_120000',
                originalPath: 'README',
            },
        ]);
    });

    it('scanConflicts() skips a vault whose tree can\'t currently be read', async () => {
        vi.mocked(syncStatus).mockResolvedValueOnce([status(), status({ local_vault_id: 'v2' })]);
        const store = useSyncStore();
        await store.refreshStatus();

        vi.mocked(mobileFileTree).mockRejectedValueOnce(new Error('unavailable'));
        vi.mocked(mobileFileTree).mockResolvedValueOnce([
            fileNode({ name: 'conflict_a_20260730_120000.md', path: 'conflict_a_20260730_120000.md' }),
        ]);

        await store.scanConflicts();

        expect(store.conflictCount).toBe(1);
    });

    it('unpair() also clears conflictFiles', async () => {
        vi.mocked(pairingGet).mockResolvedValueOnce({ base_url: 'https://x', key_present: true });
        const store = useSyncStore();
        await store.loadPairing();
        store.conflictFiles = [{ vaultId: 'v1', path: 'conflict_a.md', name: 'conflict_a.md', originalPath: 'a.md' }];

        await store.unpair();

        expect(store.conflictFiles).toEqual([]);
    });

    it('startPolling() is idempotent when called twice', async () => {
        vi.useFakeTimers();
        vi.mocked(syncStatus).mockResolvedValue([status()]);
        const store = useSyncStore();

        store.startPolling();
        store.startPolling();
        await vi.advanceTimersByTimeAsync(0);

        expect(syncStatus).toHaveBeenCalledTimes(1);
        store.stopPolling();
    });
});
